import { test, expect } from "@playwright/test";

test("desktop renderer: edit, switch, calendar and linked note", async ({
  page,
}) => {
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
      version: 1,
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
    const app = {
      Load: async () => structuredClone(state),
      SaveNote: async (n: any) => {
        const saved = { ...n, id: n.id || crypto.randomUUID() };
        state.notes = [...state.notes.filter((x) => x.id !== saved.id), saved];
        return saved;
      },
      SaveTask: async (t: any) => {
        const saved = { ...t, id: t.id || crypto.randomUUID() };
        state.tasks = [...state.tasks.filter((x) => x.id !== saved.id), saved];
        return saved;
      },
      GetSettings: async () => ({
        backupFolder: "",
        keyConfigured: false,
        lastBackup: "",
        backupError: "",
        dataFolder: "C:\\Users\\test\\AppData\\Local\\Daynote",
      }),
    };
    (window as any).go = { main: { App: app } };
    (window as any).runtime = {
      EventsOnMultiple: (name: string, f: any) => {
        listeners.set(name, f);
        return () => listeners.delete(name);
      },
    };
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByLabel("Заголовок заметки")).toHaveValue(
    "План на сегодня",
  );
  await page
    .getByLabel("Текст заметки")
    .fill("Последняя версия перед переключением.");
  await page
    .getByRole("button", { name: "Открыть заметку Идеи", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Открыть заметку План на сегодня",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("Текст заметки")).toHaveValue(
    "Последняя версия перед переключением.",
  );
  await page.screenshot({
    path: "../.superpowers/sdd/2026-11-02-daynote/notes.png",
  });
  await page.getByRole("button", { name: "Календарь", exact: true }).click();
  await page.getByRole("button", { name: "Новая задача", exact: true }).click();
  await page
    .getByLabel("Название задачи", { exact: true })
    .fill("Утренний созвон");
  await page
    .getByLabel("Начало задачи", { exact: true })
    .fill(`${new Date().toLocaleDateString("sv-SE")}T09:00`);
  await page
    .getByLabel("Конец задачи", { exact: true })
    .fill(`${new Date().toLocaleDateString("sv-SE")}T10:00`);
  await page.getByLabel("Прикрепить План на сегодня", { exact: true }).check();
  await page
    .getByRole("button", { name: "Сохранить задачу", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "09:00–10:00 Утренний созвон 1",
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: "../.superpowers/sdd/2026-11-02-daynote/calendar.png",
  });
  await page
    .getByRole("button", { name: "09:00–10:00 Утренний созвон 1", exact: true })
    .click();
  await page.getByLabel("Задача завершена", { exact: false }).check();
  await page
    .getByRole("button", { name: "Сохранить задачу", exact: true })
    .click();
  await expect(page.getByText("Утренний созвон", { exact: true })).toHaveCSS(
    "text-decoration-line",
    "line-through",
  );
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Резервные копии в OneDrive" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
