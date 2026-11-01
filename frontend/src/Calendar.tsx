import { useEffect, useRef, useState } from "react";
import FullCalendar, {
  type CalendarRef,
  type EventDropInfo,
  type EventResizeDoneInfo,
} from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import interactionPlugin from "@fullcalendar/react/interaction";
import themePlugin from "@fullcalendar/react/themes/classic";
import ruLocale from "@fullcalendar/react/locales/ru";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/classic/theme.css";
import "@fullcalendar/react/themes/classic/palette.css";
import { Plus, FileText, CalendarDays } from "lucide-react";
import { api } from "./api";
import { TaskDialog } from "./TaskDialog";
import { OccurrenceDialog } from "./OccurrenceDialog";
import {
  errorText,
  type Note,
  type Snapshot,
  type Task,
  type Occurrence,
  type TaskException,
} from "./types";
function newTask(start?: Date, end?: Date): Task {
  const a = start ? new Date(start) : new Date();
  if (!start) {
    a.setHours(a.getHours() + 1, 0, 0, 0);
  }
  return {
    id: "",
    title: "",
    description: "",
    start: a.toISOString(),
    end: (end || new Date(a.getTime() + 3600000)).toISOString(),
    color: "#467769",
    done: false,
    noteIds: [],
    reminders: [],
  };
}

export function CalendarView({
  data,
  onChange,
  onOpenNote,
  onError,
  onBusyChange,
  openTaskId,
  openOccurrenceDate = "",
  onTaskOpened,
}: {
  data: Snapshot;
  onChange: (s: Snapshot) => void;
  onOpenNote: (n: Note) => void;
  onError: (s: string) => void;
  onBusyChange: (busy: boolean) => void;
  openTaskId?: string;
  openOccurrenceDate?: string;
  onTaskOpened?: () => void;
}) {
  const [editing, setEditing] = useState<Task | null>(null),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<Occurrence | null>(null),
    [occurrences, setOccurrences] = useState<Occurrence[]>([]),
    [range, setRange] = useState<{ from: string; to: string } | null>(null),
    [loading, setLoading] = useState(false),
    [opening, setOpening] = useState(false),
    [calendarError, setCalendarError] = useState(""),
    [openError, setOpenError] = useState(""),
    [missingTask, setMissingTask] = useState<Task | null>(null);
  const calendar = useRef<CalendarRef>(null);
  useEffect(() => {
    if (!range) return;
    let active = true;
    setLoading(true);
    setOccurrences([]);
    api
      .occurrences(range.from, range.to)
      .then((rows) => {
        if (active) {
          setOccurrences(rows);
          setCalendarError("");
        }
      })
      .catch((e) => {
        if (active) setCalendarError(errorText(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [range, data.tasks]);
  const openedTask = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!openTaskId) {
      openedTask.current = undefined;
      return;
    }
    const key = JSON.stringify([openTaskId, openOccurrenceDate]);
    if (busy || openedTask.current === key) return;
    const task = data.tasks.find((t) => t.id === openTaskId);
    if (!task) return;
    if (openOccurrenceDate) {
      let active = true;
      setOpening(true);
      setOpenError("");
      setMissingTask(null);
      api
        .occurrence(task.id, openOccurrenceDate)
        .then((o) => {
          if (active) {
            setEditing(null);
            setSelected(o);
            calendar.current?.getApi().gotoDate(o.start);
          }
        })
        .catch((e) => {
          if (active) {
            setOpenError(errorText(e));
            setMissingTask(task);
          }
        })
        .finally(() => {
          if (active) {
            setOpening(false);
            openedTask.current = key;
            onTaskOpened?.();
          }
        });
      return () => {
        active = false;
        setOpening(false);
      };
    }
    openedTask.current = key;
    setEditing(task);
    onTaskOpened?.();
  }, [openTaskId, openOccurrenceDate, data.tasks, busy, onTaskOpened]);
  const markBusy = (value: boolean) => {
    setBusy(value);
    onBusyChange(value);
  };
  const updateEvent = async (info: EventDropInfo | EventResizeDoneInfo) => {
    const o = occurrences.find((o) => o.id === info.event.id);
    const t = data.tasks.find((t) => t.id === o?.taskId);
    if (!t || !info.event.start || !info.event.end) {
      info.revert();
      return;
    }
    markBusy(true);
    try {
      if (t.recurrence && o) {
        await api.saveException(t.id, {
          date: o.date,
          done: o.done,
          skipped: false,
          start: info.event.start.toISOString(),
          end: info.event.end.toISOString(),
        });
      } else
        await api.saveTask({
          ...t,
          start: info.event.start.toISOString(),
          end: info.event.end.toISOString(),
        });
      onChange(await api.load());
    } catch (e) {
      info.revert();
      onError(errorText(e));
    } finally {
      markBusy(false);
    }
  };
  const save = async (t: Task, discard = false) => {
    markBusy(true);
    let committed: Task | undefined;
    try {
      committed = discard ? await api.saveTaskWithConfirmation(t, true) : await api.saveTask(t);
      onChange(await api.load());
      setEditing(null);
    } catch (e) {
      if (committed) {
        setEditing(committed);
        onError(`Задача сохранена, но не удалось обновить календарь: ${errorText(e)}`);
      } else onError(errorText(e));
      throw e;
    } finally {
      markBusy(false);
    }
  };
  const remove = async (id: string) => {
    markBusy(true);
    try {
      onChange(await api.remove("task", id));
      setEditing(null);
      setSelected(null);
    } catch (e) {
      onError(errorText(e));
    } finally {
      markBusy(false);
    }
  };
  const saveOccurrence = async (ex: TaskException) => {
    if (!selected) return;
    markBusy(true);
    try {
      await api.saveException(selected.taskId, ex);
      onChange(await api.load());
      setSelected(null);
    } finally {
      markBusy(false);
    }
  };
  const selectedTask = data.tasks.find((t) => t.id === selected?.taskId);
  return (
    <div className="calendar-page">
      <header className="page-header">
        <div>
          <h1>Календарь</h1>
          <p>Ваш день, с местом для важного</p>
        </div>
        <button
          className="primary-button"
          onClick={() => setEditing(newTask())}
          disabled={busy || opening}
        >
          <Plus size={18} />
          Новая задача
        </button>
      </header>
      {calendarError && (
        <div className="inline-error" role="alert">
          {calendarError}
        </div>
      )}
      {openError && (
        <div className="inline-error" role="alert">
          {openError}
          {missingTask && (
            <button
              className="text-button"
              onClick={() => {
                setEditing(missingTask);
                setMissingTask(null);
                setOpenError("");
              }}
            >
              Открыть серию
            </button>
          )}
        </div>
      )}
      {loading && (
        <p className="muted" role="status">
          Загрузка расписания…
        </p>
      )}
      <div className="calendar-surface">
        <FullCalendar
          ref={calendar}
          datesSet={(info) =>
            setRange((previous) =>
              previous?.from === info.startStr && previous?.to === info.endStr
                ? previous
                : { from: info.startStr, to: info.endStr },
            )
          }
          plugins={[themePlugin, dayGridPlugin, timeGridPlugin, interactionPlugin]}
          locale={ruLocale}
          firstDay={1}
          initialView="timeGridWeek"
          timeZone="local"
          nowIndicator
          height="100%"
          editable={!busy && !loading && !opening}
          selectable={!busy && !loading && !opening}
          selectMirror
          allDaySlot={false}
          slotMinTime="00:00:00"
          slotMaxTime="24:00:00"
          scrollTime="08:00:00"
          slotDuration="00:30:00"
          eventTimeFormat={{
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }}
          headerToolbar={{
            left: "prev,next today",
            center: "title",
            right: "dayGridMonth,timeGridWeek,timeGridDay",
          }}
          events={occurrences.flatMap((o) => {
            const t = data.tasks.find((t) => t.id === o.taskId);
            return t
              ? [
                  {
                    id: o.id,
                    title: t.title,
                    start: o.start,
                    end: o.end,
                    allDay: false,
                    color: t.color,
                    className: o.done ? "task-done" : "",
                    extendedProps: { noteCount: t.noteIds.length, recurring: !!t.recurrence },
                  },
                ]
              : [];
          })}
          dateClick={(info) => {
            if (!busy && !opening) {
              const d = new Date(info.date);
              if (info.allDay) d.setHours(9, 0, 0, 0);
              setEditing(newTask(d));
            }
          }}
          select={(info) => {
            if (!busy && !opening) {
              const start = new Date(info.start),
                end = new Date(info.end);
              if (info.allDay) {
                start.setHours(9, 0, 0, 0);
                end.setTime(start.getTime() + 3600000);
              }
              setEditing(newTask(start, end));
            }
          }}
          eventClick={(info) => {
            if (busy || loading || opening) return;
            const o = occurrences.find((o) => o.id === info.event.id),
              t = data.tasks.find((t) => t.id === o?.taskId);
            if (o && t) {
              if (t.recurrence) setSelected(o);
              else setEditing(t);
            }
          }}
          eventDrop={(info) => void updateEvent(info)}
          eventResize={(info) => void updateEvent(info)}
          eventContent={(info) => (
            <div className="calendar-event-content">
              <span>{info.timeText}</span>
              <strong>
                {info.event.title}
                {info.event.extendedProps.recurring && (
                  <span title="Повторяющаяся задача" aria-label="Повторяющаяся задача">
                    {" ↻"}
                  </span>
                )}
              </strong>
              {info.event.extendedProps.noteCount > 0 && (
                <small>
                  <FileText size={11} />
                  {info.event.extendedProps.noteCount}
                </small>
              )}
            </div>
          )}
        />
      </div>
      <div className="calendar-hint">
        <CalendarDays size={14} />
        Выделите время для новой задачи. Блоки можно переносить и растягивать.
      </div>
      {editing && (
        <TaskDialog
          key={editing.id || "new"}
          task={editing}
          data={data}
          busy={busy}
          onSave={save}
          onDelete={() => {
            if (
              window.confirm(
                editing.recurrence
                  ? "Удалить всю серию? Прикреплённые заметки останутся."
                  : "Удалить задачу? Прикреплённые заметки останутся.",
              )
            )
              void remove(editing.id);
          }}
          onClose={() => {
            if (!busy) setEditing(null);
          }}
          onOpenNote={(n) => {
            setEditing(null);
            onOpenNote(n);
          }}
          onChange={onChange}
        />
      )}
      {selected && selectedTask && (
        <OccurrenceDialog
          key={selected.id}
          task={selectedTask}
          occurrence={selected}
          notes={data.notes}
          busy={busy}
          onSave={saveOccurrence}
          onClose={() => setSelected(null)}
          onEditSeries={() => {
            setSelected(null);
            setEditing(selectedTask);
          }}
          onDeleteSeries={() => void remove(selectedTask.id)}
          onOpenNote={(n) => {
            setSelected(null);
            onOpenNote(n);
          }}
        />
      )}
    </div>
  );
}
