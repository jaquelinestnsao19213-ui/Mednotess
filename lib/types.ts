export type PageRow = {
  id: string;
  parent_id: string | null;
  type: "page" | "notebook" | "lesson" | "diary" | "task" | "exam";
  title: string;
  icon: string | null;
  cover_url: string | null;
  content: unknown;
  props: { date?: string; discipline?: string; room?: string; [key: string]: unknown };
  position: number;
  created_at: string;
  updated_at: string;
};
