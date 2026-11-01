import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vite-plus/test";
import { ReminderEditor } from "./ReminderEditor";
import { NotificationsView } from "./Notifications";
import type { Reminder, NotificationItem } from "./types";

function EditorHarness() {
  const [value, setValue] = useState<Reminder[]>([]);
  return (
    <>
      <ReminderEditor value={value} onChange={setValue} />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

const reminders = (): Reminder[] => JSON.parse(screen.getByTestId("value").textContent!);

describe("reminder editor", () => {
  it("keeps tasks without reminders empty and edits independent reminder rows with stable IDs", async () => {
    const user = userEvent.setup();
    render(<EditorHarness />);
    expect(reminders()).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Добавить напоминание" }));
    await user.click(screen.getByRole("button", { name: "Добавить напоминание" }));
    const [first, second] = reminders();
    expect(first.id).toBeTruthy();
    expect(second.id).not.toBe(first.id);
    expect(first).toMatchObject({ kind: "before", minutesBefore: 30, sound: true });
    fireEvent.change(screen.getByLabelText("Минут до начала 1"), { target: { value: "0" } });
    await user.click(screen.getByLabelText("Звук напоминания 1"));
    expect(reminders()[0]).toMatchObject({ id: first.id, minutesBefore: 0, sound: false });
    expect(reminders()[1]).toEqual(second);
    await user.click(screen.getByRole("button", { name: "Удалить напоминание 1" }));
    expect(reminders()).toEqual([second]);
  });

  it("converts an absolute local time to an ISO instant and preserves it when editing another row", async () => {
    const user = userEvent.setup();
    render(<EditorHarness />);
    await user.click(screen.getByRole("button", { name: "Добавить напоминание" }));
    await user.selectOptions(screen.getByLabelText("Режим напоминания 1"), "at");
    fireEvent.change(screen.getByLabelText("Время напоминания 1"), {
      target: { value: "2026-11-05T14:45" },
    });
    const at = reminders()[0].at;
    expect(new Date(at).getFullYear()).toBe(2026);
    expect(new Date(at).getMonth()).toBe(10);
    expect(new Date(at).getDate()).toBe(5);
    expect(new Date(at).getHours()).toBe(14);
    expect(new Date(at).getMinutes()).toBe(45);
    expect(at).toMatch(/Z$/);
    expect(screen.getByLabelText("Время напоминания 1")).toHaveValue("2026-11-05T14:45");
    await user.click(screen.getByRole("button", { name: "Добавить напоминание" }));
    expect(reminders()[0].at).toBe(at);
  });
});

describe("notifications", () => {
  it("opens a task and acknowledges individual or all unread reminders", async () => {
    const user = userEvent.setup();
    const item: NotificationItem = {
      id: "one",
      taskId: "task",
      taskTitle: "Созвон",
      taskStart: "2026-11-02T10:00:00Z",
      dueAt: "2026-11-02T09:30:00Z",
      createdAt: "2026-11-02T09:30:00Z",
      sound: true,
      read: false,
    };
    let opened = "",
      acknowledged = "unset";
    render(
      <NotificationsView
        items={[item, { ...item, id: "two", read: true }]}
        error="Ошибка системного уведомления"
        onOpenTask={(id) => {
          opened = id;
        }}
        onAcknowledge={(id) => {
          acknowledged = id;
        }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Ошибка системного уведомления");
    expect(screen.getByText("Непрочитано")).toBeVisible();
    expect(screen.getByText("Прочитано")).toBeVisible();
    await user.click(screen.getAllByRole("button", { name: "Открыть задачу" })[0]);
    expect(opened).toBe("task");
    await user.click(screen.getByRole("button", { name: "Отметить прочитанным" }));
    expect(acknowledged).toBe("one");
    await user.click(screen.getByRole("button", { name: "Прочитать все" }));
    expect(acknowledged).toBe("");
  });
});
