import * as backend from "../wailsjs/go/main/App";
import { store as generated } from "../wailsjs/go/models";
import {
  EventsOn,
  WindowSetDarkTheme,
  WindowSetLightTheme,
  WindowSetSystemDefaultTheme,
} from "../wailsjs/runtime/runtime";
import type {
  Note,
  Topic,
  Task,
  Snapshot,
  Settings,
  NotificationItem,
  TaskException,
  Occurrence,
} from "./types";
import { formatMarkdown } from "./markdownFormat";
export const api = {
  windowTheme: (mode: string) => {
    if (mode === "dark") WindowSetDarkTheme();
    else if (mode === "light") WindowSetLightTheme();
    else WindowSetSystemDefaultTheme();
  },
  load: (): Promise<Snapshot> => backend.Load(),
  saveNote: async (n: Note, format = true): Promise<Note> =>
    backend.SaveNote(format ? { ...n, body: await formatMarkdown(n.body) } : n),
  saveTopic: (t: Topic): Promise<Topic> => backend.SaveTopic(t),
  saveTask: (t: Task): Promise<Task> => backend.SaveTask(new generated.Task(t)),
  saveTaskWithConfirmation: (t: Task, discard: boolean): Promise<Task> =>
    backend.SaveTaskWithConfirmation(new generated.Task(t), discard),
  taskChangeImpact: (t: Task): Promise<number> => backend.TaskChangeImpact(new generated.Task(t)),
  occurrences: (from: string, to: string): Promise<Occurrence[]> => backend.Occurrences(from, to),
  occurrence: (taskId: string, date: string): Promise<Occurrence> =>
    backend.Occurrence(taskId, date),
  saveException: (taskId: string, ex: TaskException): Promise<void> =>
    backend.SaveException(taskId, new generated.TaskException(ex)),
  resetException: (taskId: string, date: string): Promise<void> =>
    backend.ResetException(taskId, date),
  remove: (kind: string, id: string): Promise<Snapshot> => backend.Delete(kind, id),
  move: (kind: string, id: string, delta: number, scope = "*"): Promise<Snapshot> =>
    backend.Move(kind, id, delta, scope),
  settings: (): Promise<Settings> => backend.GetSettings(),
  notifications: (): Promise<NotificationItem[]> => backend.Notifications(),
  acknowledgeNotification: (id: string): Promise<NotificationItem[]> =>
    backend.AcknowledgeNotification(id),
  setAutostart: (enabled: boolean) => backend.SetAutostart(enabled),
  ready: () => backend.RendererReady(),
  showWindow: () => backend.ShowWindow(),
  cancelClose: (id: string) => backend.CancelClose(id),
  setTheme: (theme: string) => backend.SetTheme(theme),
  setKey: (key: string) => backend.SetGeminiKey(key),
  chooseBackup: () => backend.ChooseBackupFolder(),
  backup: () => backend.BackupNow(),
  restore: () => backend.RestoreBackup(),
  startVoice: (id: string) => backend.StartVoice(id),
  stopVoice: () => backend.StopVoice(),
  cancelVoice: () => backend.CancelVoice(),
  close: (id: string) => backend.CompleteClose(id),
  on: (event: string, handler: (payload: any) => void): (() => void) => EventsOn(event, handler),
};
