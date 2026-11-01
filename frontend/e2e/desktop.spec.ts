import { test, expect } from "@playwright/test";

test("desktop renderer: edit, switch, calendar and linked note", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const day = new Date();
    const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    const note = {
      id: "one",
      title: "План на сегодня",
      body: "Обсудить результаты на утреннем созвоне.\n\nПосле обеда — тренировка.",
      date,
      topicId: "work",
      pinned: true,
      position: 0,
      createdAt: "",
      updatedAt: "",
    };
    const state = {
      version: 3,
      topics: [
        { id: "work", name: "Работа", color: "#537ca7", position: 0 },
        { id: "personal", name: "Личное", color: "#76997a", position: 1 },
      ],
      notes: [
        note,
        {
          ...note,
          id: "two",
          title: "Идеи",
          body: "Место для следующих мыслей.",
          pinned: false,
          position: 1,
          topicId: "personal",
        },
      ],
      tasks: [] as any[],
    };
    const listeners = new Map();
    let inbox: any[] = [];
    let autostart = false;
    const preferences = () => ({
      backupFolder: "",
      keyConfigured: false,
      lastBackup: "",
      backupError: "",
      dataFolder: "C:/Users/test/AppData/Local/Daynote",
      autostart,
      autostartSupported: true,
      autostartError: "",
      notificationError: "",
      theme: localStorage.getItem("daynote.theme") || "system",
    });
    const app = {
      RendererReady: async () => {},
      Notifications: async () => structuredClone(inbox),
      AcknowledgeNotification: async (id: string) => {
        inbox = inbox.map((n) => (!id || id === n.id ? { ...n, read: true } : n));
        listeners.get("notifications")?.(structuredClone(inbox));
        return structuredClone(inbox);
      },
      SetAutostart: async (enabled: boolean) => {
        autostart = enabled;
      },
      Load: async () => structuredClone(state),
      Occurrences: async (from: string, to: string) =>
        state.tasks.flatMap((t) => {
          const dates = t.recurrence ? [0, 1] : [0];
          return dates.flatMap((offset) => {
            const a = new Date(t.start),
              b = new Date(t.end);
            a.setDate(a.getDate() + offset);
            b.setDate(b.getDate() + offset);
            const date = t.recurrence ? a.toLocaleDateString("sv-SE") : "";
            const ex = t.exceptions?.find((e: any) => e.date === date);
            const row = {
              id: date ? `${t.id}/${date}` : t.id,
              taskId: t.id,
              date,
              start: ex?.start || a.toISOString(),
              end: ex?.end || b.toISOString(),
              done: ex?.done ?? t.done,
            };
            return !ex?.skipped &&
              Date.parse(row.start) < Date.parse(to) &&
              Date.parse(row.end) > Date.parse(from)
              ? [row]
              : [];
          });
        }),
      Occurrence: async (taskId: string, date: string) => {
        const rows = await app.Occurrences("2020-01-01T00:00:00Z", "2035-01-01T00:00:00Z");
        const row = rows.find((o) => o.taskId === taskId && o.date === date);
        if (!row) throw Error("Повторение уже удалено");
        return row;
      },
      TaskChangeImpact: async () => 0,
      SaveTaskWithConfirmation: async (t: any) => app.SaveTask(t),
      SaveException: async (taskId: string, ex: any) => {
        const t = state.tasks.find((t) => t.id === taskId);
        t.exceptions = [...(t.exceptions ?? []).filter((e: any) => e.date !== ex.date), ex];
      },
      ResetException: async (taskId: string, date: string) => {
        const t = state.tasks.find((t) => t.id === taskId);
        t.exceptions = (t.exceptions ?? []).filter((e: any) => e.date !== date);
      },
      SaveNote: async (n: any) => {
        const saved = { ...n, id: n.id || crypto.randomUUID() };
        state.notes = [...state.notes.filter((x) => x.id !== saved.id), saved];
        return saved;
      },
      SaveTask: async (t: any) => {
        const saved = { ...t, id: t.id || crypto.randomUUID() };
        state.tasks = [...state.tasks.filter((x) => x.id !== saved.id), saved];
        if (!inbox.length) {
          inbox = [
            {
              id: "notice",
              taskId: saved.id,
              taskTitle: saved.title,
              taskStart: saved.start,
              dueAt: saved.start,
              createdAt: saved.start,
              sound: true,
              read: false,
            },
          ];
          listeners.get("notifications")?.(structuredClone(inbox));
        }
        return saved;
      },
      GetSettings: async () => preferences(),
      SetTheme: async (theme: string) => {
        localStorage.setItem("daynote.theme", theme);
        return preferences();
      },
      Delete: async (kind: string, id: string) => {
        if (kind === "topic") {
          state.topics = state.topics.filter((t) => t.id !== id);
          state.notes = state.notes.map((n) => (n.topicId === id ? { ...n, topicId: "" } : n));
        } else if (kind === "note") {
          state.notes = state.notes.filter((n) => n.id !== id);
        } else if (kind === "task") {
          state.tasks = state.tasks.filter((t) => t.id !== id);
        }
        return structuredClone(state);
      },
    };
    (window as any).go = { main: { App: app } };
    (window as any).runtime = {
      WindowSetDarkTheme: () => {},
      WindowSetLightTheme: () => {},
      WindowSetSystemDefaultTheme: () => {},
      EventsOnMultiple: (name: string, f: any) => {
        listeners.set(name, f);
        return () => listeners.delete(name);
      },
    };
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByLabel("Заголовок заметки")).toHaveValue("План на сегодня");
  await page.getByLabel("Текст заметки").fill("Последняя версия перед переключением.");
  await page.getByRole("button", { name: "Открыть заметку Идеи", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Открыть заметку План на сегодня",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("Текст заметки")).toHaveText(
    "Последняя версия перед переключением.",
  );
  await expect(page.locator("html")).toHaveAttribute("data-theme", testInfo.project.name);
  await page
    .getByRole("button", { name: "Открыть заметку Идеи", exact: true })
    .click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Удалить заметку", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Работа", exact: true }).click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Переименовать тему" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Переименовать тему" }).click();
  await expect(page.getByLabel("Название темы")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Личное", exact: true }).click({ button: "right" });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("menuitem", { name: "Удалить тему", exact: true }).click();
  await expect(page.getByRole("button", { name: "Личное", exact: true })).toHaveCount(0);
  const source = page.getByLabel("Текст заметки", { exact: true });
  await source.fill("текст");
  await source.press("Control+a");
  await page.getByRole("button", { name: "Жирный", exact: true }).click();
  await expect(source).toHaveText("**текст**");
  await source.press("Control+z");
  await expect(source).toHaveText("текст");
  await source.fill("#   План\n\n*   пункт");
  await page.getByRole("button", { name: "Сохранить заметку" }).click();
  await expect(source.locator(".cm-line")).toHaveText(["# План", "", "- пункт", ""]);
  await page.screenshot({
    path: `../.superpowers/sdd/2026-11-02-markdown-editor/editor-${testInfo.project.name}.png`,
  });
  await page.getByRole("button", { name: "Просмотр", exact: true }).click();
  await expect(page.getByRole("heading", { name: "План", exact: true })).toBeVisible();
  await expect(page.getByLabel("Просмотр заметки").getByRole("listitem")).toHaveText("пункт");
  await page.getByRole("button", { name: "Редактор", exact: true }).click();
  await source.press("Control+z");
  await expect(source.locator(".cm-line")).toHaveText(["#   План", "", "*   пункт"]);
  await source.fill("Последняя версия перед переключением.");
  await page.getByRole("button", { name: "Просмотр", exact: true }).click();
  await expect(page.getByLabel("Просмотр заметки")).toContainText("Последняя версия");
  await page.getByRole("button", { name: "Редактор", exact: true }).click();
  await page.screenshot({
    path: `../.superpowers/theme-vite-plus/notes-${testInfo.project.name}.png`,
  });
  await page.getByRole("button", { name: "Календарь", exact: true }).click();
  await page.getByRole("button", { name: "Новая задача", exact: true }).click();
  await page.getByLabel("Название задачи", { exact: true }).fill("Утренний созвон");
  await page
    .getByLabel("Начало задачи", { exact: true })
    .fill(`${new Date().toLocaleDateString("sv-SE")}T09:00`);
  await page
    .getByLabel("Конец задачи", { exact: true })
    .fill(`${new Date().toLocaleDateString("sv-SE")}T10:00`);
  await page.getByRole("button", { name: "Добавить напоминание" }).click();
  await expect(page.getByLabel("Минут до начала 1", { exact: true })).toHaveValue("30");
  await page.getByRole("button", { name: "Добавить напоминание" }).click();
  await page.getByLabel("Режим напоминания 2").selectOption("at");
  await page
    .getByLabel("Время напоминания 2")
    .fill(`${new Date().toLocaleDateString("sv-SE")}T08:00`);
  await page.getByLabel("Звук напоминания 2").uncheck();
  await page.screenshot({
    path: `../.superpowers/background-reminders/reminders-${testInfo.project.name}.png`,
  });
  await page.getByLabel("Прикрепить План на сегодня", { exact: true }).check();
  await page.getByRole("button", { name: "Сохранить задачу", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "09:00–10:00 Утренний созвон 1",
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: `../.superpowers/theme-vite-plus/calendar-${testInfo.project.name}.png`,
  });
  await page.getByRole("button", { name: "09:00–10:00 Утренний созвон 1", exact: true }).click();
  await expect(page.getByLabel("Минут до начала 1", { exact: true })).toHaveValue("30");
  await expect(page.getByLabel("Режим напоминания 2")).toHaveValue("at");
  await expect(page.getByLabel("Звук напоминания 2")).not.toBeChecked();
  await page.getByLabel("Задача завершена", { exact: false }).check();
  await page.getByRole("button", { name: "Сохранить задачу", exact: true }).click();
  await expect(page.getByText("Утренний созвон", { exact: true })).toHaveCSS(
    "text-decoration-line",
    "line-through",
  );
  await page.getByRole("button", { name: /Уведомления/ }).click();
  await expect(page.getByRole("heading", { name: "Уведомления", exact: true })).toBeVisible();
  await expect(page.getByText("Непрочитанных: 1", { exact: true })).toBeVisible();
  await page.screenshot({
    path: `../.superpowers/background-reminders/notifications-${testInfo.project.name}.png`,
  });
  await page.getByRole("button", { name: "Открыть задачу", exact: true }).click();
  await expect(page.getByLabel("Название задачи", { exact: true })).toHaveValue("Утренний созвон");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: /Уведомления/ }).click();
  await expect(page.getByText("Непрочитанных: 0", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Прочитать все" })).toBeDisabled();
  await page.getByRole("button", { name: "Календарь", exact: true }).click();
  await page.getByRole("button", { name: "Новая задача", exact: true }).click();
  await page.getByLabel("Название задачи", { exact: true }).fill("Ежедневная");
  const monday = new Date();
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const seriesDate = monday.toLocaleDateString("sv-SE");
  await page.getByLabel("Начало задачи", { exact: true }).fill(`${seriesDate}T12:00`);
  await page.getByLabel("Конец задачи", { exact: true }).fill(`${seriesDate}T13:00`);
  await page.getByLabel("Повторять", { exact: true }).selectOption("daily");
  await page.getByRole("button", { name: "Сохранить задачу", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const repeated = page.getByRole("button", { name: /12:00–13:00 Ежедневная/ });
  await expect(repeated).toHaveCount(2);
  await repeated.first().click();
  await page.getByLabel("Повторение выполнено").check();
  await page.getByRole("button", { name: "Сохранить повторение" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".task-done").filter({ hasText: "Ежедневная" })).toHaveCount(1);
  await repeated.last().click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Удалить это повторение" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(repeated).toHaveCount(1);
  await page.screenshot({
    path: `../.superpowers/sdd/2026-11-02-recurring-tasks/calendar-${testInfo.project.name}.png`,
  });
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await page.getByLabel("Запускать с Windows").check();
  await expect(page.getByText("Автозапуск включён.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Резервные копии в OneDrive" })).toBeVisible();
  await page.selectOption('select[aria-label="Оформление"]', "dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.selectOption('select[aria-label="Оформление"]', "system");
  await expect(page.locator("html")).toHaveAttribute("data-theme", testInfo.project.name);
  const opposite = testInfo.project.name === "dark" ? "light" : "dark";
  await page.emulateMedia({ colorScheme: opposite });
  await expect(page.locator("html")).toHaveAttribute("data-theme", opposite);
  expect(errors).toEqual([]);
});
