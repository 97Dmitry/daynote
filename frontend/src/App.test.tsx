import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect, beforeEach } from "vite-plus/test";
import { App } from "./App";
import { emptyNote, type Snapshot, type VoiceEvent } from "./types";

const fake = vi.hoisted(() => ({
  state: { version: 2, topics: [], notes: [], tasks: [] } as Snapshot,
  listeners: new Map<string, (p: any) => void>(),
  failSave: false,
  closed: false,
  saveTopicWait: null as null | Promise<void>,
  theme: "system",
}));
vi.mock("./api", () => ({
  api: {
    windowTheme: () => {},
    ready: async () => {},
    showWindow: async () => {},
    cancelClose: async () => {},
    notifications: async () => [],
    acknowledgeNotification: async () => [],
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
      theme: fake.theme,
    }),
    setTheme: async (theme: string) => {
      fake.theme = theme;
      return { theme };
    },
    remove: async (kind: string, id: string) => {
      if (kind === "note") fake.state.notes = fake.state.notes.filter((n) => n.id !== id);
      if (kind === "topic") {
        fake.state.topics = fake.state.topics.filter((t) => t.id !== id);
        fake.state.notes = fake.state.notes.map((n) =>
          n.topicId === id ? { ...n, topicId: "" } : n,
        );
      }
      return structuredClone(fake.state);
    },
    saveNote: async (n: any) => {
      if (fake.failSave) throw Error("Диск недоступен");
      const saved = { ...n, id: n.id || "new-note" };
      fake.state.notes = [...fake.state.notes.filter((x) => x.id !== saved.id), saved];
      return saved;
    },
    saveTask: async (t: any) => {
      const saved = { ...t, id: t.id || "new-task" };
      fake.state.tasks = [...fake.state.tasks.filter((x) => x.id !== saved.id), saved];
      return saved;
    },
    saveTopic: async (t: any) => {
      if (fake.saveTopicWait) await fake.saveTopicWait;
      const saved = { ...t, id: t.id || "topic" };
      fake.state.topics = [saved];
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
    version: 2,
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
  fake.saveTopicWait = null;
  fake.theme = "system";
  localStorage.clear();
});
describe("Daynote workflows", () => {
  it("changes the theme without leaving the editor", async () => {
    const u = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: "Открыть заметку Первая" });
    await u.selectOptions(screen.getByLabelText("Оформление"), "dark");
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    expect(fake.theme).toBe("dark");
    expect(screen.getByLabelText("Текст заметки")).toBeVisible();
  });
  it("deletes another note directly from its action menu", async () => {
    const u = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App />);
    await screen.findByRole("button", { name: "Открыть заметку Вторая" });
    await u.click(screen.getByRole("button", { name: "Действия заметки Вторая" }));
    await u.click(await screen.findByRole("menuitem", { name: /Удалить заметку/ }));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Открыть заметку Вторая" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Заголовок заметки")).toHaveValue("Первая");
    confirm.mockRestore();
  });
  it("renders Markdown headings lists and tables without executing HTML", async () => {
    fake.state.notes[0].body =
      "# План\n\n- Пункт\n\n| Задача | Статус |\n| --- | --- |\n| Созвон | Готово |\n\n<script>alert(1)</script>";
    const u = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: "Открыть заметку Первая" });
    await u.click(screen.getByRole("button", { name: "Просмотр" }));
    expect(screen.getByRole("heading", { name: "План" })).toBeVisible();
    expect(screen.getByRole("table")).toHaveTextContent("Созвон");
    expect(document.querySelector(".markdown-body script")).toBeNull();
    await u.click(screen.getByRole("button", { name: "Редактор" }));
    expect(screen.getByLabelText("Текст заметки")).toHaveValue(fake.state.notes[0].body);
  });
  it("preserves a changed topic on Escape and locks fields during save", async () => {
    const u = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: "Открыть заметку Первая" });
    await u.click(screen.getByRole("button", { name: "Добавить тему" }));
    await u.type(screen.getByLabelText("Название темы"), "Работа");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await u.keyboard("{Escape}");
    expect(screen.queryByLabelText("Название темы")).toHaveValue("Работа");
    let finish!: () => void;
    fake.saveTopicWait = new Promise<void>((resolve) => {
      finish = resolve;
    });
    await u.click(screen.getByRole("button", { name: "Сохранить тему" }));
    await waitFor(() => expect(screen.getByLabelText("Название темы")).toBeDisabled());
    finish();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    confirm.mockRestore();
  });
  it("saves a pending inline note when the task is saved", async () => {
    const u = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: "Открыть заметку Первая" });
    await u.click(screen.getByRole("button", { name: "Календарь" }));
    await u.click(screen.getByRole("button", { name: "Новая задача" }));
    await u.type(screen.getByLabelText("Название задачи"), "Созвон");
    await u.click(screen.getByRole("button", { name: "Новая заметка" }));
    await u.type(screen.getByLabelText("Заголовок новой заметки к задаче"), "Повестка");
    await u.type(screen.getByLabelText("Текст новой заметки к задаче"), "Не потерять пункты");
    await u.click(screen.getByRole("button", { name: "Сохранить задачу" }));
    await waitFor(() => expect(fake.state.tasks).toHaveLength(1));
    const note = fake.state.notes.find((n) => n.title === "Повестка");
    expect(note?.body).toBe("Не потерять пункты");
    expect(fake.state.tasks[0].noteIds).toContain(note?.id);
  });
  it("asks before closing a window with an open task draft", async () => {
    const u = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: "Календарь" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Календарь" })).not.toBeDisabled(),
    );
    await u.click(screen.getByRole("button", { name: "Календарь" }));
    await u.click(screen.getByRole("button", { name: "Новая задача" }));
    await u.type(screen.getByLabelText("Название задачи"), "Не потерять");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    act(() => fake.listeners.get("app:closing")?.({ id: "quit", quit: true }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(fake.closed).toBe(false);
    expect(screen.getByLabelText("Название задачи")).toHaveValue("Не потерять");
    expect(confirm).toHaveBeenCalled();
    confirm.mockRestore();
  });
  it("hides with an open task draft without discarding it", async () => {
    const u = userEvent.setup();
    render(<App />);
    await u.click(await screen.findByRole("button", { name: "Календарь" }));
    await u.click(screen.getByRole("button", { name: "Новая задача" }));
    await u.type(screen.getByLabelText("Название задачи"), "Сохранить черновик");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    act(() => fake.listeners.get("app:closing")?.({ id: "hide", quit: false }));
    await waitFor(() => expect(fake.closed).toBe(true));
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Название задачи")).toHaveValue("Сохранить черновик");
    confirm.mockRestore();
  });
  it("refuses to hide and preserves the note when saving fails", async () => {
    const u = userEvent.setup();
    render(<App />);
    await screen.findByLabelText("Текст заметки");
    fake.failSave = true;
    await u.type(screen.getByLabelText("Текст заметки"), "Не потерять при закрытии");
    act(() => fake.listeners.get("app:closing")?.({ id: "hide", quit: false }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Диск недоступен");
    await waitFor(() => expect(screen.getByLabelText("Текст заметки")).toBeEnabled());
    expect(fake.closed).toBe(false);
    expect(screen.getByLabelText("Текст заметки")).toHaveValue("Не потерять при закрытии");
  });
  it("saves the edited note before selecting another note", async () => {
    const u = userEvent.setup();
    render(<App />);
    await u.click(await screen.findByRole("button", { name: "Открыть заметку Первая" }));
    const title = screen.getByLabelText("Заголовок заметки");
    await u.clear(title);
    await u.type(title, "Изменено");
    await u.click(screen.getByRole("button", { name: "Открыть заметку Вторая" }));
    expect(screen.getByLabelText("Заголовок заметки")).toHaveValue("Вторая");
    expect(fake.state.notes.find((n) => n.id === "one")?.title).toBe("Изменено");
  });
  it("keeps the draft and refuses navigation if persistence fails", async () => {
    const u = userEvent.setup();
    render(<App />);
    await u.click(await screen.findByRole("button", { name: "Открыть заметку Первая" }));
    fake.failSave = true;
    const body = screen.getByLabelText("Текст заметки");
    await u.type(body, "Не потерять");
    await u.click(screen.getByRole("button", { name: "Календарь" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Диск недоступен");
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
    await u.click(await screen.findByRole("button", { name: "Открыть заметку Первая" }));
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
      expect(screen.getByLabelText("Распознанный текст")).toHaveValue("Моя мысль"),
    );
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await u.keyboard("{Escape}");
    expect(screen.queryByLabelText("Распознанный текст")).toHaveValue("Моя мысль");
    confirm.mockRestore();
    expect(screen.getByLabelText("Текст заметки")).toHaveValue("");
    await u.click(screen.getByRole("button", { name: "Добавить в заметку" }));
    expect(screen.getByLabelText("Текст заметки")).toHaveValue("Моя мысль");
  });
});
