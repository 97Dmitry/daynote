import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { CalendarView } from "./Calendar";
import { SettingsView } from "./Settings";
import type { Settings, Snapshot, Task } from "./types";

const bridge = vi.hoisted(() => ({
  settings: {} as Settings,
  state: { version: 2, topics: [], notes: [], tasks: [] } as Snapshot,
  failAutostart: false,
}));
vi.mock("./api", () => ({
  api: {
    settings: async () => structuredClone(bridge.settings),
    setAutostart: async (enabled: boolean) => {
      if (bridge.failAutostart) throw Error("Нет доступа к автозапуску");
      bridge.settings.autostart = enabled;
    },
    load: async () => structuredClone(bridge.state),
    occurrences: async () =>
      bridge.state.tasks.map((t) => ({
        id: t.id,
        taskId: t.id,
        date: "",
        start: t.start,
        end: t.end,
        done: t.done,
      })),
    saveTask: async (task: Task) => {
      const saved = { ...structuredClone(task), id: task.id || "new" };
      bridge.state.tasks = [saved];
      return saved;
    },
    on: () => () => {},
  },
}));

beforeEach(() => {
  bridge.settings = {
    backupFolder: "",
    keyConfigured: false,
    lastBackup: "",
    backupError: "",
    dataFolder: "C:/test",
    theme: "system",
    autostart: false,
    autostartSupported: true,
    autostartError: "",
    notificationError: "",
  };
  bridge.state = { version: 2, topics: [], notes: [], tasks: [] };
  bridge.failAutostart = false;
});

describe("startup settings", () => {
  it("refreshes the native startup state after toggling and preserves it when Windows rejects a change", async () => {
    const user = userEvent.setup();
    render(<SettingsView onBusyChange={() => {}} onRestore={() => {}} />);
    const checkbox = screen.getByLabelText("Запускать с Windows");
    await waitFor(() => expect(checkbox).not.toBeDisabled());
    expect(checkbox).not.toBeChecked();
    await user.click(checkbox);
    await waitFor(() => expect(checkbox).toBeChecked());
    expect(screen.getByText("Автозапуск включён.")).toBeVisible();
    bridge.failAutostart = true;
    await user.click(checkbox);
    expect(await screen.findByRole("alert")).toHaveTextContent("Нет доступа к автозапуску");
    expect(checkbox).toBeChecked();
  });

  it("disables unavailable startup settings and shows native shell errors", async () => {
    bridge.settings.autostartSupported = false;
    bridge.settings.autostartError = "Ошибка чтения настроек";
    bridge.settings.notificationError = "Трей недоступен";
    render(<SettingsView onBusyChange={() => {}} onRestore={() => {}} />);
    expect(await screen.findByText("Автозапуск недоступен на этой платформе.")).toBeVisible();
    expect(screen.getByLabelText("Запускать с Windows")).toBeDisabled();
    expect(screen.getByText(/Ошибка чтения настроек/)).toBeVisible();
    expect(screen.getByText(/Трей недоступен/)).toBeVisible();
  });
});

describe("task reminder integration", () => {
  it("opens a requested event and persists edited reminders without mutating loaded data", async () => {
    const user = userEvent.setup();
    const task: Task = {
      id: "task",
      title: "Созвон",
      description: "",
      start: "2026-11-02T10:00:00Z",
      end: "2026-11-02T11:00:00Z",
      color: "#467769",
      done: false,
      noteIds: [],
      reminders: [],
    };
    const data: Snapshot = { version: 2, notes: [], topics: [], tasks: [task] };
    let opened = false;
    render(
      <CalendarView
        data={data}
        onBusyChange={() => {}}
        onChange={() => {}}
        onOpenNote={() => {}}
        onError={() => {}}
        openTaskId="task"
        onTaskOpened={() => {
          opened = true;
        }}
      />,
    );
    expect(await screen.findByLabelText("Название задачи")).toHaveValue("Созвон");
    expect(opened).toBe(true);
    await user.click(screen.getByRole("button", { name: "Добавить напоминание" }));
    expect(task.reminders).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Сохранить задачу" }));
    await waitFor(() => expect(bridge.state.tasks[0].reminders).toHaveLength(1));
    expect(bridge.state.tasks[0].reminders[0]).toMatchObject({
      kind: "before",
      minutesBefore: 30,
      sound: true,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
