import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { App } from "./App";
import { emptyNote, type Snapshot, type VoiceEvent } from "./types";

const fake = vi.hoisted(() => ({
  state: { version: 1, topics: [], notes: [], tasks: [] } as Snapshot,
  listeners: new Map<string, (p: any) => void>(),
  failSave: false,
  closed: false,
}));
vi.mock("./api", () => ({
  api: {
    load: async () => structuredClone(fake.state),
    on: (name: string, f: (p: any) => void) => {
      fake.listeners.set(name, f);
      return () => fake.listeners.delete(name);
    },
    settings: async () => ({
      keyConfigured: false,
      backupFolder: "",
      lastBackup: "",
      backupError: "",
      dataFolder: "C:/test",
    }),
    saveNote: async (n: any) => {
      if (fake.failSave) throw Error("Диск недоступен");
      const saved = { ...n, id: n.id || "new-note" };
      fake.state.notes = [
        ...fake.state.notes.filter((x) => x.id !== saved.id),
        saved,
      ];
      return saved;
    },
    saveTask: async (t: any) => {
      const saved = { ...t, id: t.id || "new-task" };
      fake.state.tasks = [
        ...fake.state.tasks.filter((x) => x.id !== saved.id),
        saved,
      ];
      return saved;
    },
    startVoice: async () => {},
    stopVoice: async () => {},
    cancelVoice: async () => {},
    close: async () => {
      fake.closed = true;
    },
  },
}));
beforeEach(() => {
  fake.state = {
    version: 1,
    topics: [],
    notes: [
      { ...emptyNote(), id: "one", title: "Первая" },
      { ...emptyNote(), id: "two", title: "Вторая" },
    ],
    tasks: [],
  };
  fake.listeners.clear();
  fake.failSave = false;
  fake.closed = false;
});
describe("Daynote workflows", () => {
  it("asks before closing a window with an open task draft", async () => {
    const u = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: "Календарь" });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Календарь" }),
      ).not.toBeDisabled(),
    );
    await u.click(screen.getByRole("button", { name: "Календарь" }));
    await u.click(screen.getByRole("button", { name: "Новая задача" }));
    await u.type(screen.getByLabelText("Название задачи"), "Не потерять");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fake.listeners.get("app:closing")?.(true);
    await Promise.resolve();
    expect(fake.closed).toBe(false);
    expect(screen.getByLabelText("Название задачи")).toHaveValue("Не потерять");
    expect(confirm).toHaveBeenCalled();
    confirm.mockRestore();
  });
  it("saves the edited note before selecting another note", async () => {
    const u = userEvent.setup();
    render(<App />);
    await u.click(
      await screen.findByRole("button", { name: "Открыть заметку Первая" }),
    );
    const title = screen.getByLabelText("Заголовок заметки");
    await u.clear(title);
    await u.type(title, "Изменено");
    await u.click(
      screen.getByRole("button", { name: "Открыть заметку Вторая" }),
    );
    expect(screen.getByLabelText("Заголовок заметки")).toHaveValue("Вторая");
    expect(fake.state.notes.find((n) => n.id === "one")?.title).toBe(
      "Изменено",
    );
  });
  it("keeps the draft and refuses navigation if persistence fails", async () => {
    const u = userEvent.setup();
    render(<App />);
    await u.click(
      await screen.findByRole("button", { name: "Открыть заметку Первая" }),
    );
    fake.failSave = true;
    const body = screen.getByLabelText("Текст заметки");
    await u.type(body, "Не потерять");
    await u.click(screen.getByRole("button", { name: "Календарь" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Диск недоступен",
    );
    expect(body).toHaveValue("Не потерять");
    expect(screen.getByLabelText("Заголовок заметки")).toHaveValue("Первая");
  });
  it("creates a timed task and attaches an existing note", async () => {
    const u = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: "Открыть заметку Первая" });
    await u.click(screen.getByRole("button", { name: "Календарь" }));
    await u.click(screen.getByRole("button", { name: "Новая задача" }));
    await u.type(screen.getByLabelText("Название задачи"), "Созвон");
    await u.click(screen.getByLabelText("Прикрепить Первая"));
    await u.click(screen.getByRole("button", { name: "Сохранить задачу" }));
    await waitFor(() => expect(fake.state.tasks).toHaveLength(1));
    expect(fake.state.tasks[0].noteIds).toEqual(["one"]);
    expect(Date.parse(fake.state.tasks[0].end)).toBeGreaterThan(
      Date.parse(fake.state.tasks[0].start),
    );
  });
  it("keeps a voice draft separate until explicitly inserted", async () => {
    const u = userEvent.setup();
    render(<App />);
    await u.click(
      await screen.findByRole("button", { name: "Открыть заметку Первая" }),
    );
    await u.click(screen.getByRole("button", { name: "Записать голосом" }));
    const id = screen
      .getByRole("dialog", { name: "Голосовая заметка" })
      .getAttribute("data-session");
    const event: VoiceEvent = {
      sessionId: id!,
      state: "ready",
      text: "Моя мысль",
      error: "",
    };
    fake.listeners.get("voice")?.(event);
    await waitFor(() =>
      expect(screen.getByLabelText("Распознанный текст")).toHaveValue(
        "Моя мысль",
      ),
    );
    expect(screen.getByLabelText("Текст заметки")).toHaveValue("");
    await u.click(screen.getByRole("button", { name: "Добавить в заметку" }));
    expect(screen.getByLabelText("Текст заметки")).toHaveValue("Моя мысль");
  });
});
