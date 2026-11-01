import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { CalendarView } from "./Calendar";
import type { Snapshot, Task, TaskException } from "./types";

const bridge = vi.hoisted(() => ({
  state: { version: 3, topics: [], notes: [], tasks: [] } as Snapshot,
  fail: false,
  impact: 0,
  confirmed: false,
  rows: [] as any[],
  pending: null as Promise<any[]> | null,
  opening: null as Promise<any> | null,
  failLoad: false,
  nextId: 0,
}));
vi.mock("./api", () => ({
  api: {
    load: async () => {
      if (bridge.failLoad) throw Error("Ошибка загрузки");
      return structuredClone(bridge.state);
    },
    occurrences: async () => bridge.pending ?? structuredClone(bridge.rows),
    occurrence: async (taskId: string, date: string) => {
      if (bridge.opening) return bridge.opening;
      const o = bridge.rows.find((o) => o.taskId === taskId && o.date === date);
      if (!o) throw Error("Повторение уже удалено");
      return structuredClone(o);
    },
    saveTask: async (t: Task) => {
      if (bridge.fail) throw Error("Диск недоступен");
      const saved = { ...structuredClone(t), id: t.id || `created-${++bridge.nextId}` };
      bridge.state.tasks = [...bridge.state.tasks.filter((t) => t.id !== saved.id), saved];
      return saved;
    },
    taskChangeImpact: async () => bridge.impact,
    saveTaskWithConfirmation: async (t: Task, confirmed: boolean) => {
      bridge.confirmed = confirmed;
      bridge.state.tasks = [structuredClone(t)];
    },
    saveException: async (id: string, ex: TaskException) => {
      if (bridge.fail) throw Error("Диск недоступен");
      const t = bridge.state.tasks.find((t) => t.id === id)!;
      t.exceptions = [
        ...(t.exceptions ?? []).filter((e) => e.date !== ex.date),
        structuredClone(ex),
      ];
    },
    resetException: async (id: string, date: string) => {
      const t = bridge.state.tasks.find((t) => t.id === id)!;
      t.exceptions = (t.exceptions ?? []).filter((ex) => ex.date !== date);
    },
    remove: async () => {
      bridge.state.tasks = [];
      return structuredClone(bridge.state);
    },
  },
}));

function Harness({ date = "", id = "" }: { date?: string; id?: string }) {
  const [data, setData] = useState(bridge.state);
  return (
    <CalendarView
      data={data}
      onChange={setData}
      onOpenNote={() => {}}
      onError={() => {}}
      onBusyChange={() => {}}
      openTaskId={id}
      openOccurrenceDate={date}
    />
  );
}
beforeEach(() => {
  bridge.state = { version: 3, topics: [], notes: [], tasks: [] };
  bridge.fail = false;
  bridge.impact = 0;
  bridge.confirmed = false;
  bridge.rows = [];
  bridge.pending = null;
  bridge.opening = null;
  bridge.failLoad = false;
  bridge.nextId = 0;
});
function existingSeries() {
  bridge.state.tasks = [
    {
      id: "series",
      title: "Созвон",
      description: "",
      start: "2026-11-02T09:00:00Z",
      end: "2026-11-02T10:00:00Z",
      color: "#467769",
      done: false,
      noteIds: [],
      reminders: [],
      recurrence: { weekdays: [1, 2, 3, 4, 5, 6, 7], timeZone: "UTC", until: "" },
    },
  ];
  bridge.rows = [
    {
      id: "series/2026-11-03",
      taskId: "series",
      date: "2026-11-03",
      start: "2026-11-03T09:00:00Z",
      end: "2026-11-03T10:00:00Z",
      done: false,
    },
  ];
}
describe("recurring tasks", () => {
  it("blocks a new draft until an inbox occurrence finishes opening", async () => {
    existingSeries();
    let finish!: (value: any) => void;
    bridge.opening = new Promise((resolve) => {
      finish = resolve;
    });
    render(<Harness id="series" date="2026-11-03" />);
    expect(screen.getByRole("button", { name: "Новая задача" })).toBeDisabled();
    await act(async () => finish(bridge.rows[0]));
    expect(await screen.findByLabelText("Повторение выполнено")).toBeVisible();
  });
  it("does not duplicate a committed task when refreshing fails", async () => {
    const u = userEvent.setup();
    render(<Harness />);
    await u.click(screen.getByRole("button", { name: "Новая задача" }));
    await u.type(screen.getByLabelText("Название задачи"), "Не дублировать");
    bridge.failLoad = true;
    await u.click(screen.getByRole("button", { name: "Сохранить задачу" }));
    await waitFor(() => expect(bridge.state.tasks).toHaveLength(1));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Сохранить задачу" })).toBeEnabled(),
    );
    bridge.failLoad = false;
    await u.click(screen.getByRole("button", { name: "Сохранить задачу" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(bridge.state.tasks).toHaveLength(1);
  });
  it("ignores a stale period response after navigating the calendar", async () => {
    let finish!: (rows: any[]) => void;
    bridge.pending = new Promise((resolve) => {
      finish = resolve;
    });
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    nextWeek.setHours(12, 0, 0, 0);
    const start = nextWeek.toISOString(),
      end = new Date(nextWeek.getTime() + 3600000).toISOString();
    bridge.state.tasks = [
      {
        id: "new",
        title: "Новый период",
        description: "",
        start,
        end,
        color: "#467769",
        done: false,
        noteIds: [],
        reminders: [],
      },
    ];
    const u = userEvent.setup();
    render(<Harness />);
    await screen.findByText("Загрузка расписания…");
    bridge.pending = null;
    bridge.rows = [{ id: "new", taskId: "new", date: "", start, end, done: false }];
    await u.click(screen.getByRole("button", { name: /След/ }));
    expect(await screen.findByText("Новый период")).toBeVisible();
    await act(async () => finish([]));
    expect(screen.getByText("Новый период")).toBeVisible();
  });
  it("keeps a missing occurrence error after the calendar finishes loading", async () => {
    existingSeries();
    let finish!: (rows: any[]) => void;
    bridge.pending = new Promise((resolve) => {
      finish = resolve;
    });
    render(<Harness id="series" date="2026-11-04" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Повторение уже удалено");
    await act(async () => finish([]));
    expect(screen.getByRole("alert")).toHaveTextContent("Повторение уже удалено");
    expect(screen.getByRole("button", { name: "Открыть серию" })).toBeVisible();
  });
  for (const [mode, days] of [
    ["daily", [1, 2, 3, 4, 5, 6, 7]],
    ["weekdays", [1, 2, 3, 4, 5]],
    ["weekend", [6, 7]],
  ] as const) {
    it(`creates the ${mode} preset`, async () => {
      const u = userEvent.setup();
      render(<Harness />);
      await u.click(screen.getByRole("button", { name: "Новая задача" }));
      await u.type(screen.getByLabelText("Название задачи"), "Созвон");
      await u.selectOptions(screen.getByLabelText("Повторять"), mode);
      await u.click(screen.getByRole("button", { name: "Сохранить задачу" }));
      await waitFor(() => expect(bridge.state.tasks).toHaveLength(1));
      expect(bridge.state.tasks[0].recurrence?.weekdays).toEqual(days);
      expect(bridge.state.tasks[0].done).toBe(false);
    });
  }
  it("selects individual weekdays and an end date", async () => {
    const u = userEvent.setup();
    render(<Harness />);
    await u.click(screen.getByRole("button", { name: "Новая задача" }));
    await u.type(screen.getByLabelText("Название задачи"), "Зарядка");
    await u.selectOptions(screen.getByLabelText("Повторять"), "custom");
    for (const day of ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]) {
      const el = screen.getByLabelText(day, { exact: true });
      if ((el as HTMLInputElement).checked) await u.click(el);
    }
    await u.click(screen.getByLabelText("Вт", { exact: true }));
    await u.click(screen.getByLabelText("Чт", { exact: true }));
    await u.type(screen.getByLabelText("Повторять до"), "2027-12-31");
    await u.click(screen.getByRole("button", { name: "Сохранить задачу" }));
    await waitFor(() => expect(bridge.state.tasks).toHaveLength(1));
    expect(bridge.state.tasks[0].recurrence).toMatchObject({
      weekdays: [2, 4],
      until: "2027-12-31",
    });
  });
  it("marks only the requested day done and preserves a draft on save failure", async () => {
    existingSeries();
    const u = userEvent.setup();
    render(<Harness id="series" date="2026-11-03" />);
    await u.click(await screen.findByLabelText("Повторение выполнено"));
    bridge.fail = true;
    await u.click(screen.getByRole("button", { name: "Сохранить повторение" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Диск недоступен");
    expect(screen.getByLabelText("Повторение выполнено")).toBeChecked();
    bridge.fail = false;
    await u.click(screen.getByRole("button", { name: "Сохранить повторение" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(bridge.state.tasks[0].exceptions).toEqual([
      { date: "2026-11-03", done: true, skipped: false, start: "", end: "" },
    ]);
    expect(bridge.state.tasks[0].done).toBe(false);
    expect(bridge.state.tasks[0].start).toBe("2026-11-02T09:00:00Z");
  });
  it("deletes one day without deleting the series", async () => {
    existingSeries();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const u = userEvent.setup();
    render(<Harness id="series" date="2026-11-03" />);
    await u.click(await screen.findByRole("button", { name: "Удалить это повторение" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(bridge.state.tasks).toHaveLength(1);
    expect(bridge.state.tasks[0].exceptions?.[0]).toMatchObject({
      date: "2026-11-03",
      skipped: true,
    });
    confirm.mockRestore();
  });
  it("confirms discarded exceptions before saving a changed series", async () => {
    existingSeries();
    bridge.impact = 2;
    const u = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Harness id="series" />);
    await u.selectOptions(await screen.findByLabelText("Повторять"), "weekend");
    await u.click(screen.getByRole("button", { name: "Сохранить задачу" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("2"));
    expect(bridge.confirmed).toBe(false);
    confirm.mockReturnValue(true);
    await u.click(screen.getByRole("button", { name: "Сохранить задачу" }));
    await waitFor(() => expect(bridge.confirmed).toBe(true));
    expect(bridge.state.tasks[0].recurrence?.weekdays).toEqual([6, 7]);
    confirm.mockRestore();
  });
  it("shows the series explicitly when a requested occurrence is missing", async () => {
    existingSeries();
    const u = userEvent.setup();
    render(<Harness id="series" date="2026-11-04" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Повторение уже удалено");
    await waitFor(() => expect(screen.getByRole("button", { name: "Новая задача" })).toBeEnabled());
    await u.click(screen.getByRole("button", { name: "Открыть серию" }));
    expect(await screen.findByLabelText("Название задачи")).toHaveValue("Созвон");
  });
});
