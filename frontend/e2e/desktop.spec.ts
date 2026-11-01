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
      version: 2,
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
  await expect(page.getByLabel("Текст заметки")).toHaveValue(
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
