// Agente da assistente de planejamento: ferramentas que alteram o planejamento de verdade,
// verificação do que foi gravado e laço de conversa com a IA que não deixa falhas passarem em silêncio.
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

/* ---------- tipos e utilidades ---------- */

export type ActionStep = { text: string; completed: boolean };
export type Action = {
  type: "created" | "updated";
  id: string;
  title: string;
  date: string;
  time_label: string;
  subject: string | null;
  notes_chars: number;
  notes_preview: string;
  steps: ActionStep[];
  steps_total: number;
};

export type Logger = (step: string, data?: Record<string, unknown>) => void;
export type ToolContext = { db: SupabaseClient; today: string; changed: boolean; actions: Action[]; log: Logger };

export const NOTES_MAX = 50_000;
export const MAX_STEPS = 50;
export const STEP_MAX = 300;
const MIGRATION_HINT = "Execute o arquivo schema12.sql no SQL Editor do Supabase para liberar notas e etapas.";

export const norm = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
export const isDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const isUuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);

export function addDays(dateKey: string, days: number) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
export function weekdayOf(dateKey: string) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
export const mondayOf = (dateKey: string) => addDays(dateKey, -((weekdayOf(dateKey) + 6) % 7));

type DbError = { code?: string; message?: string } | null | undefined;
const dbDetail = (error: DbError) => ({ code: error?.code ?? null, message: String(error?.message ?? "").slice(0, 160) });
const missingColumn = (error: DbError) => !!error && (error.code === "42703" || error.code === "PGRST204" || /column/i.test(error.message ?? "") && /notes/i.test(error.message ?? ""));
const missingTable = (error: DbError) => !!error && (error.code === "42P01" || error.code === "PGRST205" || /study_task_steps/i.test(error.message ?? ""));

function findByName<T>(items: T[], getName: (item: T) => string, wanted: string): { item?: T; candidates: T[] } {
  const target = norm(wanted);
  const exact = items.filter((item) => norm(getName(item)) === target);
  if (exact.length === 1) return { item: exact[0], candidates: exact };
  const partial = exact.length ? exact : items.filter((item) => norm(getName(item)).includes(target) || target.includes(norm(getName(item))));
  if (partial.length === 1) return { item: partial[0], candidates: partial };
  return { candidates: partial };
}

const cleanText = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
/** Notas mantêm parágrafos e quebras de linha; só normaliza o fim de linha e corta nas pontas. */
const cleanNotes = (value: unknown) => (typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim().slice(0, NOTES_MAX) : "");
function cleanSteps(value: unknown): ActionStep[] {
  if (!Array.isArray(value)) return [];
  const out: ActionStep[] = [];
  for (const item of value) {
    const raw = typeof item === "string" ? { text: item } : ((item ?? {}) as { text?: unknown; completed?: unknown });
    const text = cleanText(raw.text, STEP_MAX).replace(/^(?:[-*•]|\d+[.)]|\[[ xX]?\])\s*/, "");
    if (text) out.push({ text, completed: raw.completed === true });
    if (out.length >= MAX_STEPS) break;
  }
  return out;
}

/* ---------- ferramentas ---------- */

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "get_overview",
    description:
      "Lê as disciplinas, os cadernos e as atividades do planejamento (com id, se há notas e o progresso das etapas). Use ANTES de criar ou alterar atividades, para conhecer os nomes exatos e evitar duplicatas. Sem datas, devolve a semana atual.",
    input_schema: { type: "object", properties: { from: { type: "string", description: "Data inicial YYYY-MM-DD (opcional)" }, to: { type: "string", description: "Data final YYYY-MM-DD (opcional)" } } },
  },
  {
    name: "get_task",
    description: "Lê uma atividade completa (notas inteiras e todas as etapas) pelo id que veio de get_overview.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "add_study_tasks",
    description:
      "Cria atividades no planejamento semanal, cada uma com notas longas e etapas (checklist) opcionais. Cria no máximo 10 atividades por chamada; para mais, chame de novo. O resultado traz o que foi REALMENTE gravado e verificado no banco.",
    input_schema: {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          maxItems: 10,
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "Título curto (até 140 caracteres)" },
              date: { type: "string", description: "Dia no formato YYYY-MM-DD" },
              time_label: { type: "string", description: "Horário (08:00 ou 08:00–10:00) ou período (Manhã, Tarde, Noite)" },
              subject_name: { type: "string", description: "Nome da disciplina, igual ao de get_overview (opcional)" },
              topic: { type: "string", description: "Assunto curto, até 100 caracteres (opcional)" },
              notes: { type: "string", description: "Notas e planejamento em Markdown simples, com parágrafos e listas. Pode ser longo (opcional)" },
              steps: { type: "array", maxItems: 50, items: { type: "string" }, description: "Etapas executáveis do checklist, uma por item, cada uma independente (opcional)" },
            },
            required: ["title", "date", "time_label"],
          },
        },
      },
      required: ["tasks"],
    },
  },
  {
    name: "update_study_task",
    description:
      "Altera uma atividade existente (id de get_overview). Para mudar notas ou etapas, envie o texto completo novo: 'notes' substitui as notas; 'steps' substitui a lista de etapas (etapas com o mesmo texto mantêm o estado de concluída). Campos não enviados não mudam.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD" },
        time_label: { type: "string" },
        topic: { type: "string" },
        subject_name: { type: "string" },
        completed: { type: "boolean" },
        notes: { type: "string" },
        steps: { type: "array", maxItems: 50, items: { type: "string" } },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_study_tasks",
    description: "Exclui atividades pelo id. Só use quando o usuário pedir claramente para excluir/remover.",
    input_schema: { type: "object", properties: { ids: { type: "array", items: { type: "string" }, maxItems: 40 } }, required: ["ids"] },
  },
  {
    name: "move_notebook_to_subject",
    description: "Coloca um caderno dentro de uma disciplina, tornando-o o caderno dessa disciplina. O caderno que estava antes na disciplina NÃO é apagado: continua em Cadernos.",
    input_schema: {
      type: "object",
      properties: { notebook_title: { type: "string", description: "Título do caderno, como em get_overview" }, subject_name: { type: "string", description: "Nome da disciplina, como em get_overview" } },
      required: ["notebook_title", "subject_name"],
    },
  },
];

type TaskRow = { id: string; title: string; scheduled_date: string; time_label: string; subject_id: string | null; topic?: string | null; completed?: boolean; notes?: string | null };
type StepRow = { id?: string; task_id: string; text: string; completed: boolean; position: number };

/** Lê tarefas tentando incluir as notas; se a coluna ainda não existir, lê sem ela. */
async function selectTasks(ctx: ToolContext, columns: string, apply: (q: any) => any): Promise<{ rows: TaskRow[]; notesSupported: boolean; error: DbError }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  let result = await apply(ctx.db.from("study_tasks").select(`${columns},notes`));
  if (result.error && missingColumn(result.error)) {
    const retry = await apply(ctx.db.from("study_tasks").select(columns));
    return { rows: (retry.data ?? []) as TaskRow[], notesSupported: false, error: retry.error };
  }
  return { rows: (result.data ?? []) as TaskRow[], notesSupported: !result.error, error: result.error };
}
async function selectSteps(ctx: ToolContext, taskIds: string[]): Promise<{ rows: StepRow[]; error: DbError }> {
  if (!taskIds.length) return { rows: [], error: null };
  const { data, error } = await ctx.db.from("study_task_steps").select("id,task_id,text,completed,position").in("task_id", taskIds).order("position");
  return { rows: (data ?? []) as StepRow[], error };
}

/** Relê do banco o que foi gravado e monta o resumo verificado (é isso que a interface mostra como confirmação). */
async function readBack(ctx: ToolContext, ids: string[], type: Action["type"]) {
  const { rows, error } = await selectTasks(ctx, "id,title,scheduled_date,time_label,subject_id", (q) => q.in("id", ids));
  if (error) { ctx.log("verify_failed", { ...dbDetail(error) }); return { actions: [] as Action[], stepsError: false }; }
  const steps = await selectSteps(ctx, ids);
  const { data: subjects } = await ctx.db.from("subjects").select("id,name");
  const subjectName = new Map(((subjects ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]));
  const actions = rows.map((row): Action => {
    const own = steps.rows.filter((s) => s.task_id === row.id).sort((a, b) => a.position - b.position);
    const notes = row.notes ?? "";
    return {
      type, id: row.id, title: row.title, date: row.scheduled_date, time_label: row.time_label,
      subject: row.subject_id ? subjectName.get(row.subject_id) ?? null : null,
      notes_chars: notes.length, notes_preview: notes.slice(0, 280),
      steps: own.map((s) => ({ text: s.text, completed: s.completed })), steps_total: own.length,
    };
  });
  return { actions, stepsError: !!steps.error };
}

async function replaceSteps(ctx: ToolContext, taskId: string, desired: ActionStep[]): Promise<{ ok: boolean; error?: DbError }> {
  const existing = await selectSteps(ctx, [taskId]);
  if (existing.error) return { ok: false, error: existing.error };
  const used = new Set<string>();
  const keepDone = new Map<string, boolean>();
  const wanted = desired.map((step, position) => {
    const match = existing.rows.find((row) => !used.has(row.id!) && norm(row.text) === norm(step.text));
    if (match) { used.add(match.id!); keepDone.set(match.id!, step.completed || match.completed); }
    return { step, position, matchId: match?.id };
  });
  const removed = existing.rows.filter((row) => !used.has(row.id!)).map((row) => row.id!);
  if (removed.length) {
    const { error } = await ctx.db.from("study_task_steps").delete().in("id", removed);
    if (error) return { ok: false, error };
  }
  for (const item of wanted) {
    if (!item.matchId) continue;
    const { error } = await ctx.db.from("study_task_steps").update({ position: item.position, completed: keepDone.get(item.matchId) ?? false }).eq("id", item.matchId);
    if (error) return { ok: false, error };
  }
  const fresh = wanted.filter((item) => !item.matchId).map((item) => ({ task_id: taskId, text: item.step.text, completed: item.step.completed, position: item.position }));
  if (fresh.length) {
    const { error } = await ctx.db.from("study_task_steps").insert(fresh);
    if (error) return { ok: false, error };
  }
  return { ok: true };
}

export async function runTool(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const { db } = ctx;
  const fail = (message: string, extra?: unknown) => JSON.stringify({ erro: message, ...(extra ? { detalhe: extra } : {}) });
  try {
    if (name === "get_overview") {
      const monday = mondayOf(ctx.today);
      const from = isDate(input.from) ? input.from : monday;
      const to = isDate(input.to) ? input.to : addDays(monday, 6);
      const [subjects, notebooks, tasks] = await Promise.all([
        db.from("subjects").select("id,name,notebook_page_id").order("position"),
        db.from("pages").select("id,title").eq("type", "notebook").is("parent_id", null).order("created_at"),
        selectTasks(ctx, "id,title,topic,time_label,scheduled_date,completed,subject_id", (q) => q.gte("scheduled_date", from).lte("scheduled_date", to).order("scheduled_date").order("time_label")),
      ]);
      if (subjects.error || notebooks.error || tasks.error) {
        const error = subjects.error ?? notebooks.error ?? tasks.error;
        ctx.log("tool_db_error", { tool: name, ...dbDetail(error) });
        return fail("Não consegui ler os dados do planejamento.", dbDetail(error));
      }
      const steps = await selectSteps(ctx, tasks.rows.map((t) => t.id));
      const subjectName = new Map((subjects.data ?? []).map((s) => [s.id, s.name]));
      const notebookTitle = new Map((notebooks.data ?? []).map((n) => [n.id, n.title]));
      return JSON.stringify({
        periodo: { from, to },
        disciplinas: (subjects.data ?? []).map((s) => ({ nome: s.name, caderno_atual: s.notebook_page_id ? notebookTitle.get(s.notebook_page_id) ?? null : null })),
        cadernos: (notebooks.data ?? []).map((n) => n.title),
        atividades: tasks.rows.map((t) => {
          const own = steps.rows.filter((s) => s.task_id === t.id);
          return {
            id: t.id, titulo: t.title, data: t.scheduled_date, horario: t.time_label,
            disciplina: t.subject_id ? subjectName.get(t.subject_id) ?? null : null, assunto: t.topic, concluida: t.completed,
            tem_notas: !!t.notes?.trim(), etapas: own.length ? { feitas: own.filter((s) => s.completed).length, total: own.length } : null,
          };
        }),
        recursos: { notas: tasks.notesSupported, etapas: !steps.error },
      });
    }

    if (name === "get_task") {
      if (!isUuid(input.id)) return fail("id inválido.");
      const { rows, error } = await selectTasks(ctx, "id,title,topic,time_label,scheduled_date,completed,subject_id", (q) => q.eq("id", input.id));
      if (error) return fail("Não consegui ler a atividade.", dbDetail(error));
      if (!rows[0]) return fail("Atividade não encontrada.");
      const steps = await selectSteps(ctx, [rows[0].id]);
      return JSON.stringify({ id: rows[0].id, titulo: rows[0].title, data: rows[0].scheduled_date, horario: rows[0].time_label, assunto: rows[0].topic, concluida: rows[0].completed, notas: (rows[0].notes ?? "").slice(0, 20_000), etapas: steps.rows.map((s) => ({ texto: s.text, concluida: s.completed })) });
    }

    if (name === "add_study_tasks") {
      const raw = Array.isArray(input.tasks) ? input.tasks.slice(0, 10) : [];
      if (!raw.length) return fail("Nenhuma atividade enviada em 'tasks'.");
      const { data: subjectData } = await db.from("subjects").select("id,name");
      const subjects = (subjectData ?? []) as { id: string; name: string }[];
      const entries: { row: Record<string, unknown>; steps: ActionStep[] }[] = [];
      const rejected: string[] = [];
      const semDisciplina: string[] = [];
      for (const item of raw) {
        const t = (item ?? {}) as Record<string, unknown>;
        const title = cleanText(t.title, 140);
        const timeLabel = cleanText(t.time_label, 40);
        if (!title) { rejected.push("atividade sem título"); continue; }
        if (!isDate(t.date)) { rejected.push(`"${title}": data inválida (use YYYY-MM-DD)`); continue; }
        if (!timeLabel) { rejected.push(`"${title}": falta horário ou período`); continue; }
        let subjectId: string | null = null;
        if (cleanText(t.subject_name, 120)) {
          const match = findByName(subjects, (s) => s.name, cleanText(t.subject_name, 120));
          if (match.item) subjectId = match.item.id;
          else semDisciplina.push(`${title} (disciplina "${cleanText(t.subject_name, 80)}" não encontrada; ficou sem disciplina)`);
        }
        const notes = cleanNotes(t.notes);
        entries.push({ row: { title, scheduled_date: t.date, time_label: timeLabel, subject_id: subjectId, topic: cleanText(t.topic, 100) || null, ...(notes ? { notes } : {}) }, steps: cleanSteps(t.steps) });
      }
      if (!entries.length) return fail("Nenhuma atividade válida para criar.", rejected);

      // evita duplicatas: mesma data e mesmo título já existentes (ou repetidos no próprio pedido)
      const dates = [...new Set(entries.map((e) => e.row.scheduled_date as string))];
      const existing = await db.from("study_tasks").select("id,title,scheduled_date").in("scheduled_date", dates);
      if (existing.error) { ctx.log("tool_db_error", { tool: name, stage: "dedupe", ...dbDetail(existing.error) }); return fail("Não consegui conferir as atividades existentes.", dbDetail(existing.error)); }
      const seen = new Map<string, string>(((existing.data ?? []) as TaskRow[]).map((t) => [`${t.scheduled_date}|${norm(t.title)}`, t.id]));
      const toCreate: typeof entries = [];
      const jaExistiam: { id: string | null; titulo: string; data: string }[] = [];
      for (const entry of entries) {
        const key = `${entry.row.scheduled_date}|${norm(entry.row.title as string)}`;
        if (seen.has(key)) { jaExistiam.push({ id: seen.get(key) ?? null, titulo: entry.row.title as string, data: entry.row.scheduled_date as string }); continue; }
        seen.set(key, "");
        toCreate.push(entry);
      }
      if (!toCreate.length) return JSON.stringify({ criadas: 0, ja_existiam: jaExistiam, aviso: "Todas já existiam. Use update_study_task (com o id) para alterar, em vez de criar de novo." });

      const avisos: string[] = [];
      let rows = toCreate.map((e) => e.row);
      let inserted = await db.from("study_tasks").insert(rows).select("id,title,scheduled_date");
      if (inserted.error && missingColumn(inserted.error) && rows.some((r) => "notes" in r)) {
        ctx.log("notes_column_missing", {});
        avisos.push(`As notas NÃO foram salvas porque o banco ainda não tem esse campo. ${MIGRATION_HINT}`);
        rows = rows.map(({ notes: _notes, ...rest }) => rest);
        inserted = await db.from("study_tasks").insert(rows).select("id,title,scheduled_date");
      }
      if (inserted.error || !inserted.data?.length) {
        ctx.log("tool_db_error", { tool: name, stage: "insert_tasks", ...dbDetail(inserted.error) });
        return fail("Não consegui salvar as atividades no banco.", dbDetail(inserted.error));
      }
      const created = inserted.data as { id: string }[];
      const stepRows: Omit<StepRow, "id">[] = [];
      created.forEach((task, index) => (toCreate[index]?.steps ?? []).forEach((step, position) => stepRows.push({ task_id: task.id, text: step.text, completed: step.completed, position })));
      let stepsFailed = false;
      if (stepRows.length) {
        const result = await db.from("study_task_steps").insert(stepRows);
        if (result.error) {
          stepsFailed = true;
          ctx.log("tool_db_error", { tool: name, stage: "insert_steps", ...dbDetail(result.error) });
          avisos.push(missingTable(result.error) ? `As etapas NÃO foram salvas porque o banco ainda não tem a tabela de etapas. ${MIGRATION_HINT}` : "As atividades foram criadas, mas houve erro ao salvar as etapas.");
        }
      }

      const back = await readBack(ctx, created.map((c) => c.id), "created");
      if (!back.actions.length) return fail("As atividades podem ter sido criadas, mas não consegui conferir. Peça para ler o planejamento antes de tentar de novo.");
      const verified = back.actions.map((action) => {
        const index = created.findIndex((c) => c.id === action.id);
        const wantedSteps = toCreate[index]?.steps.length ?? 0;
        const wantedNotes = typeof toCreate[index]?.row.notes === "string" ? (toCreate[index].row.notes as string).length : 0;
        const notesOk = wantedNotes === 0 || action.notes_chars === wantedNotes;
        const stepsOk = !stepsFailed && action.steps_total === wantedSteps;
        if (!notesOk) avisos.push(`"${action.title}": as notas não foram salvas por completo.`);
        if (!stepsOk && !stepsFailed) avisos.push(`"${action.title}": esperava ${wantedSteps} etapas e há ${action.steps_total}.`);
        return { id: action.id, titulo: action.title, data: action.date, horario: action.time_label, disciplina: action.subject, notas_caracteres_salvos: action.notes_chars, etapas_pedidas: wantedSteps, etapas_salvas: action.steps_total, ok: notesOk && stepsOk };
      });
      ctx.actions.push(...back.actions);
      ctx.changed = true;
      ctx.log("tasks_created", { count: back.actions.length, steps: back.actions.reduce((n, a) => n + a.steps_total, 0), duplicates: jaExistiam.length, warnings: avisos.length });
      return JSON.stringify({ criadas: back.actions.length, verificado: verified, ja_existiam: jaExistiam, recusadas: rejected, sem_disciplina_vinculada: semDisciplina, avisos });
    }

    if (name === "update_study_task") {
      if (!isUuid(input.id)) return fail("id inválido.");
      const patch: Record<string, unknown> = {};
      if (cleanText(input.title, 140)) patch.title = cleanText(input.title, 140);
      if (isDate(input.date)) patch.scheduled_date = input.date;
      if (cleanText(input.time_label, 40)) patch.time_label = cleanText(input.time_label, 40);
      if (typeof input.topic === "string") patch.topic = cleanText(input.topic, 100) || null;
      if (typeof input.completed === "boolean") patch.completed = input.completed;
      if (typeof input.notes === "string") patch.notes = cleanNotes(input.notes) || null;
      if (cleanText(input.subject_name, 120)) {
        const { data: subjects } = await db.from("subjects").select("id,name");
        const match = findByName((subjects ?? []) as { id: string; name: string }[], (s) => s.name, cleanText(input.subject_name, 120));
        if (!match.item) return fail(`Disciplina "${cleanText(input.subject_name, 80)}" não encontrada.`);
        patch.subject_id = match.item.id;
      }
      const newSteps = Array.isArray(input.steps) ? cleanSteps(input.steps) : null;
      if (!Object.keys(patch).length && newSteps === null) return fail("Nada para alterar.");
      const avisos: string[] = [];
      if (Object.keys(patch).length) {
        let result: { data: { id: string }[] | null; error: DbError } = await db.from("study_tasks").update(patch).eq("id", input.id).select("id");
        if (result.error && missingColumn(result.error) && "notes" in patch) {
          avisos.push(`As notas NÃO foram salvas porque o banco ainda não tem esse campo. ${MIGRATION_HINT}`);
          delete patch.notes;
          result = Object.keys(patch).length ? await db.from("study_tasks").update(patch).eq("id", input.id).select("id") : { data: [{ id: input.id }], error: null };
        }
        if (result.error) { ctx.log("tool_db_error", { tool: name, stage: "update", ...dbDetail(result.error) }); return fail("Não consegui alterar a atividade.", dbDetail(result.error)); }
        if (!result.data?.length) return fail("Atividade não encontrada.");
      }
      if (newSteps !== null) {
        const done = await replaceSteps(ctx, input.id, newSteps);
        if (!done.ok) {
          ctx.log("tool_db_error", { tool: name, stage: "steps", ...dbDetail(done.error) });
          avisos.push(missingTable(done.error) ? `As etapas NÃO foram salvas porque o banco ainda não tem a tabela de etapas. ${MIGRATION_HINT}` : "Houve erro ao salvar as etapas.");
        }
      }
      const back = await readBack(ctx, [input.id], "updated");
      if (!back.actions.length) return fail("Não consegui conferir a atividade depois de alterar.");
      ctx.actions.push(...back.actions);
      ctx.changed = true;
      ctx.log("task_updated", { fields: Object.keys(patch), steps: newSteps?.length ?? null });
      const a = back.actions[0];
      return JSON.stringify({ alterada: true, verificado: { id: a.id, titulo: a.title, data: a.date, horario: a.time_label, notas_caracteres_salvos: a.notes_chars, etapas_salvas: a.steps_total }, avisos });
    }

    if (name === "delete_study_tasks") {
      const ids = Array.isArray(input.ids) ? input.ids.filter(isUuid).slice(0, 40) : [];
      if (!ids.length) return fail("Nenhum id válido informado.");
      const { data, error } = await db.from("study_tasks").delete().in("id", ids).select("id");
      if (error) { ctx.log("tool_db_error", { tool: name, ...dbDetail(error) }); return fail("Não consegui excluir.", dbDetail(error)); }
      if (data?.length) ctx.changed = true;
      return JSON.stringify({ excluidas: data?.length ?? 0 });
    }

    if (name === "move_notebook_to_subject") {
      if (typeof input.notebook_title !== "string" || typeof input.subject_name !== "string") return fail("Parâmetros inválidos.");
      const [notebooks, subjects] = await Promise.all([
        db.from("pages").select("id,title").eq("type", "notebook").is("parent_id", null),
        db.from("subjects").select("id,name,notebook_page_id"),
      ]);
      if (notebooks.error || subjects.error) return fail("Erro ao ler os dados.", dbDetail(notebooks.error ?? subjects.error));
      const nb = findByName((notebooks.data ?? []) as { id: string; title: string }[], (n) => n.title, input.notebook_title);
      if (!nb.item) return fail(nb.candidates.length ? `Mais de um caderno combina: ${nb.candidates.map((c) => c.title).join("; ")}. Peça para o usuário escolher.` : `Caderno "${input.notebook_title}" não encontrado.`);
      const sj = findByName((subjects.data ?? []) as { id: string; name: string; notebook_page_id: string | null }[], (s) => s.name, input.subject_name);
      if (!sj.item) return fail(sj.candidates.length ? `Mais de uma disciplina combina: ${sj.candidates.map((c) => c.name).join("; ")}. Peça para o usuário escolher.` : `Disciplina "${input.subject_name}" não encontrada. Ela precisa ser criada em Disciplinas.`);
      if (sj.item.notebook_page_id === nb.item.id) return JSON.stringify({ ok: true, aviso: "Esse caderno já é o caderno dessa disciplina." });
      const previous = sj.item.notebook_page_id ? (notebooks.data ?? []).find((n) => n.id === sj.item!.notebook_page_id)?.title ?? null : null;
      const { error } = await db.from("subjects").update({ notebook_page_id: nb.item.id }).eq("id", sj.item.id);
      if (error) return fail("Não consegui mover o caderno.", dbDetail(error));
      ctx.changed = true;
      return JSON.stringify({ ok: true, caderno: nb.item.title, disciplina: sj.item.name, caderno_anterior_continua_em_Cadernos: previous });
    }

    return fail("Ferramenta desconhecida.");
  } catch (err) {
    ctx.log("tool_exception", { tool: name, type: err instanceof Error ? err.name : typeof err, message: err instanceof Error ? err.message.slice(0, 160) : "" });
    return fail("Erro inesperado ao executar a ação.");
  }
}

/* ---------- laço da conversa com a IA ---------- */

const textOf = (response: Anthropic.Message) => response.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();

function appendUserNote(convo: Anthropic.MessageParam[], text: string) {
  const last = convo[convo.length - 1];
  if (last && last.role === "user") {
    const blocks: Anthropic.ContentBlockParam[] = typeof last.content === "string" ? [{ type: "text", text: last.content }] : [...last.content];
    blocks.push({ type: "text", text });
    convo[convo.length - 1] = { role: "user", content: blocks };
  } else convo.push({ role: "user", content: text });
}

/** Resumo montado por nós, só com o que foi verificado no banco (usado se a IA terminar sem texto). */
export function localSummary(actions: Action[]) {
  if (!actions.length) return "";
  const unique = [...new Map(actions.map((a) => [a.id, a])).values()];
  const created = unique.filter((a) => a.type === "created").length;
  const lines = unique.map((a) => `- **${a.title}** (${a.date}, ${a.time_label})${a.steps_total ? ` — ${a.steps_total} etapa${a.steps_total === 1 ? "" : "s"}` : ""}${a.notes_chars ? " — com notas" : ""}`);
  return `Salvei no planejamento${created ? ` ${created} atividade${created === 1 ? "" : "s"}` : ""}${unique.length - created ? ` (${unique.length - created} alterada${unique.length - created === 1 ? "" : "s"})` : ""}:\n\n${lines.join("\n")}`;
}

export type AgentResult = { text: string; rounds: number; truncatedRetries: number };

export async function runAgent(args: { anthropic: Anthropic; model: string; system: string; convo: Anthropic.MessageParam[]; ctx: ToolContext; signal: AbortSignal; maxRounds?: number; maxTokens?: number }): Promise<AgentResult> {
  const { anthropic, model, system, convo, ctx, signal } = args;
  const maxRounds = args.maxRounds ?? 8;
  const maxTokens = args.maxTokens ?? 12_000;
  let truncatedRetries = 0;
  let rounds = 0;
  let finalText = "";

  for (; rounds < maxRounds; rounds++) {
    const started = Date.now();
    const response = await anthropic.messages.create({ model, max_tokens: maxTokens, system, tools: TOOLS, messages: convo }, { signal });
    const text = textOf(response);
    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    ctx.log("anthropic_response", { round: rounds, ms: Date.now() - started, stop_reason: response.stop_reason, tools: toolUses.map((t) => t.name), text_chars: text.length, in_tokens: response.usage?.input_tokens, out_tokens: response.usage?.output_tokens });

    if (response.stop_reason === "tool_use" && toolUses.length) {
      convo.push({ role: "assistant", content: response.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const use of toolUses) {
        const t0 = Date.now();
        const output = await runTool(use.name, (use.input ?? {}) as Record<string, unknown>, ctx);
        const failed = output.startsWith('{"erro"');
        ctx.log("tool_result", { tool: use.name, ms: Date.now() - t0, ok: !failed, output_chars: output.length, ...(failed ? { error: output.slice(0, 200) } : {}) });
        results.push({ type: "tool_result", tool_use_id: use.id, content: output, ...(failed ? { is_error: true } : {}) });
      }
      convo.push({ role: "user", content: results });
      continue;
    }

    if (response.stop_reason === "max_tokens" && (toolUses.length || !text)) {
      // a IA foi cortada no meio de uma chamada: descartamos o pedaço e pedimos lotes menores
      if (truncatedRetries >= 2) throw Object.assign(new Error("resposta_cortada"), { step: "resposta_cortada" });
      truncatedRetries += 1;
      ctx.log("truncated_retry", { attempt: truncatedRetries });
      appendUserNote(convo, "Sua resposta anterior foi cortada por tamanho antes de terminar e nada foi executado. Refaça em partes menores: no máximo 4 atividades por chamada de add_study_tasks, notas mais concisas e frases curtas.");
      continue;
    }

    finalText = response.stop_reason === "max_tokens" ? `${text}\n\n_(A resposta foi cortada por tamanho. Peça para continuar.)_` : text;
    break;
  }

  if (!finalText && ctx.actions.length) {
    // a IA executou as ações mas terminou sem texto: pedimos o resumo; se ainda vier vazio, usamos o nosso
    try {
      appendUserNote(convo, "Resuma em poucas linhas o que foi feito, usando apenas os resultados das ferramentas. Se algum resultado trouxe avisos, conte.");
      const response = await anthropic.messages.create({ model, max_tokens: 1_500, system, tools: TOOLS, tool_choice: { type: "none" }, messages: convo }, { signal });
      finalText = textOf(response);
      ctx.log("summary_round", { text_chars: finalText.length });
    } catch (err) {
      if (signal.aborted) throw err;
      ctx.log("summary_round_failed", { type: err instanceof Error ? err.name : typeof err });
    }
    if (!finalText) finalText = localSummary(ctx.actions);
  }
  return { text: finalText, rounds, truncatedRetries };
}

/* ---------- erros da IA em mensagens úteis ---------- */

export function describeChatError(err: unknown): { status: number; message: string; step: string } {
  const step = (err as { step?: string })?.step;
  if (step === "resposta_cortada") return { status: 502, step, message: "A resposta da IA foi cortada duas vezes por ser grande demais e nada foi alterado. Envie o pedido em partes menores (por exemplo, um dia ou uma disciplina por vez)." };
  if (err instanceof Anthropic.APIUserAbortError || err instanceof Anthropic.APIConnectionTimeoutError) return { status: 504, step: "tempo_esgotado", message: "A IA demorou mais do que o limite do servidor. Divida o pedido em partes menores." };
  if (err instanceof Anthropic.APIError) {
    const s = err.status;
    if (s === 401 || s === 403) return { status: 503, step: "autenticacao_ia", message: "O servidor não conseguiu autenticar na IA. Confira a variável ANTHROPIC_API_KEY na Vercel." };
    if (s === 404) return { status: 503, step: "modelo_indisponivel", message: "O modelo de IA configurado não está disponível para esta chave." };
    if (s === 429) return { status: 429, step: "limite_ia", message: "A IA recebeu pedidos demais agora. Espere um minuto e tente de novo." };
    if (s === 413 || s === 400) return { status: 422, step: "pedido_recusado_ia", message: "A IA não aceitou este pedido (o texto ou um anexo pode estar grande demais ou ilegível). Tente com menos texto ou sem o anexo." };
    if (s !== undefined && s >= 500) return { status: 502, step: "ia_instavel", message: "O serviço de IA está instável agora. Tente de novo em instantes." };
  }
  if (err instanceof Anthropic.APIConnectionError) return { status: 502, step: "conexao_ia", message: "Não consegui me conectar à IA. Tente de novo em instantes." };
  return { status: 500, step: "inesperado", message: "Ocorreu um erro inesperado no servidor." };
}
