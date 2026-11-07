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

export type ResourceLink = {
  id: string;
  user_id: string;
  provider: "drive" | "canva";
  title: string;
  url: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

export type Flashcard = {
  id: string;
  user_id: string;
  front: string;
  back: string;
  interval: number;
  ease_factor: number;
  repetitions: number;
  /** Data de revisão no formato YYYY-MM-DD. */
  next_review: string;
  created_at: string;
  updated_at: string;
};
