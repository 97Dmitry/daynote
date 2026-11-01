export type Topic = {
  id: string;
  name: string;
  color: string;
  position: number;
};
export type Note = {
  id: string;
  title: string;
  body: string;
  date: string;
  topicId: string;
  pinned: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
};
export type Reminder = {
  id: string;
  kind: string;
  minutesBefore: number;
  at: string;
  sound: boolean;
};
export type NotificationItem = {
  id: string;
  taskId: string;
  taskTitle: string;
  taskStart: string;
  dueAt: string;
  createdAt: string;
  sound: boolean;
  read: boolean;
  occurrenceDate?: string;
};
export type Recurrence = { weekdays: number[]; timeZone: string; until: string };
export type TaskException = {
  date: string;
  done: boolean;
  skipped: boolean;
  start: string;
  end: string;
};
export type Occurrence = {
  id: string;
  taskId: string;
  date: string;
  start: string;
  end: string;
  done: boolean;
};
export type Task = {
  id: string;
  title: string;
  description: string;
  start: string;
  end: string;
  color: string;
  done: boolean;
  noteIds: string[];
  reminders: Reminder[];
  recurrence?: Recurrence;
  exceptions?: TaskException[];
};
export type Snapshot = {
  version: number;
  topics: Topic[];
  notes: Note[];
  tasks: Task[];
};
export type Settings = {
  backupFolder: string;
  keyConfigured: boolean;
  lastBackup: string;
  backupError: string;
  dataFolder: string;
  theme: string;
  autostart: boolean;
  autostartSupported: boolean;
  autostartError: string;
  notificationError: string;
};
export type VoiceEvent = {
  sessionId: string;
  state: string;
  text: string;
  error: string;
  warning?: string;
};
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const emptyNote = (topicId = "", date = today()): Note => ({
  id: "",
  title: "",
  body: "",
  date,
  topicId,
  pinned: false,
  position: 0,
  createdAt: "",
  updatedAt: "",
});
export const noteSignature = (n: Note) =>
  JSON.stringify([n.id, n.title, n.body, n.date, n.topicId, n.pinned]);
export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type CloseRequest = { id: string; quit: boolean };
