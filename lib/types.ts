export type PageRow = {
  id: string;
  parent_id: string | null;
  type: "page" | "notebook" | "lesson" | "diary" | "task" | "exam";
  title: string;
  content: { type: string; text: string }[];
  props: Record<string, unknown>;
  position: number;
  created_at: string;
  updated_at: string;
};
