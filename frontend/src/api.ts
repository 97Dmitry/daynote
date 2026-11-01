import * as backend from "../wailsjs/go/main/App";
import { EventsOn } from "../wailsjs/runtime/runtime";
import type { Note, Topic, Task, Snapshot, Settings } from "./types";
export const api = {
  load: (): Promise<Snapshot> => backend.Load(),
  saveNote: (n: Note): Promise<Note> => backend.SaveNote(n),
  saveTopic: (t: Topic): Promise<Topic> => backend.SaveTopic(t),
  saveTask: (t: Task): Promise<Task> => backend.SaveTask(t),
  remove: (kind: string, id: string): Promise<Snapshot> =>
    backend.Delete(kind, id),
  move: (
    kind: string,
    id: string,
    delta: number,
    scope = "*",
  ): Promise<Snapshot> => backend.Move(kind, id, delta, scope),
  settings: (): Promise<Settings> => backend.GetSettings(),
  setKey: (key: string) => backend.SetGeminiKey(key),
  chooseBackup: () => backend.ChooseBackupFolder(),
  backup: () => backend.BackupNow(),
  restore: () => backend.RestoreBackup(),
  startVoice: (id: string) => backend.StartVoice(id),
  stopVoice: () => backend.StopVoice(),
  cancelVoice: () => backend.CancelVoice(),
  close: () => backend.CloseWindow(),
  on: (event: string, handler: (payload: any) => void): (() => void) =>
    EventsOn(event, handler),
};
