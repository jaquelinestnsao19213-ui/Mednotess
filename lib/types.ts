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

export type Subject = {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  notebook_page_id: string | null;
  position: number;
  created_at: string;
};

export type Topic = {
  id: string;
  subject_id: string;
  name: string;
  page_id: string | null;
  position: number;
  created_at: string;
};

export type StudyTask = {
  id: string;
  user_id: string;
  subject_id: string | null;
  title: string;
  topic: string | null;
  time_label: string;
  scheduled_date: string;
  completed: boolean;
  created_at: string;
};
