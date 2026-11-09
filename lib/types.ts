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
  notes?: string | null; // só existe depois de executar o schema12.sql
  created_at: string;
};

export type StudyTaskStep = {
  id: string;
  task_id: string;
  user_id: string;
  text: string;
  completed: boolean;
  position: number;
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

export type StudyCard = {
  id: string;
  user_id: string;
  page_id: string | null;
  source_title: string;
  kind: "flashcard" | "question";
  question: string;
  answer: string;
  explanation: string | null;
  options: string[] | null;
  correct_index: number | null;
  topic: string | null;
  concept: string | null;
  option_notes: string[] | null;
  due_at: string;
  interval_days: number;
  ease: number;
  reps: number;
  lapses: number;
  last_reviewed_at: string | null;
  created_at: string;
};

// Atalho de um assunto para uma página (de qualquer caderno). Existe depois de executar o schema15.sql.
export type TopicLink = {
  id: string;
  topic_id: string;
  page_id: string;
  position: number;
  created_at: string;
};
