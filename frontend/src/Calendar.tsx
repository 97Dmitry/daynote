import { useState } from "react";
import FullCalendar, {
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
import { Plus, FileText, CalendarDays, Check, Trash2 } from "lucide-react";
import { api } from "./api";
import { Dialog } from "./Dialog";
import {
  emptyNote,
  errorText,
  type Note,
  type Snapshot,
  type Task,
} from "./types";

const localInput = (s: string) => {
  const d = new Date(s);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
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
  };
}

export function CalendarView({
  data,
  onChange,
  onOpenNote,
  onError,
  onBusyChange,
}: {
  data: Snapshot;
  onChange: (s: Snapshot) => void;
  onOpenNote: (n: Note) => void;
  onError: (s: string) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [editing, setEditing] = useState<Task | null>(null),
    [busy, setBusy] = useState(false);
  const markBusy = (value: boolean) => {
    setBusy(value);
    onBusyChange(value);
  };
  const updateEvent = async (info: EventDropInfo | EventResizeDoneInfo) => {
    const t = data.tasks.find((t) => t.id === info.event.id);
    if (!t || !info.event.start || !info.event.end) {
      info.revert();
      return;
    }
    markBusy(true);
    try {
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
  const save = async (t: Task) => {
    markBusy(true);
    try {
      await api.saveTask(t);
      onChange(await api.load());
      setEditing(null);
    } catch (e) {
      onError(errorText(e));
      throw e;
    } finally {
      markBusy(false);
    }
  };
  const remove = async () => {
    if (
      !editing?.id ||
      !window.confirm("Удалить задачу? Прикреплённые заметки останутся.")
    )
      return;
    markBusy(true);
    try {
      onChange(await api.remove("task", editing.id));
      setEditing(null);
    } catch (e) {
      onError(errorText(e));
    } finally {
      markBusy(false);
    }
  };
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
          disabled={busy}
        >
          <Plus size={18} />
          Новая задача
        </button>
      </header>
      <div className="calendar-surface">
        <FullCalendar
          plugins={[
            themePlugin,
            dayGridPlugin,
            timeGridPlugin,
            interactionPlugin,
          ]}
          locale={ruLocale}
          firstDay={1}
          initialView="timeGridWeek"
          timeZone="local"
          nowIndicator
          height="100%"
          editable={!busy}
          selectable={!busy}
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
          events={data.tasks.map((t) => ({
            id: t.id,
            title: t.title,
            start: t.start,
            end: t.end,
            allDay: false,
            color: t.color,
            className: t.done ? "task-done" : "",
            extendedProps: { noteCount: t.noteIds.length },
          }))}
          dateClick={(info) => {
            if (!busy) {
              const d = new Date(info.date);
              if (info.allDay) d.setHours(9, 0, 0, 0);
              setEditing(newTask(d));
            }
          }}
          select={(info) => {
            if (!busy) {
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
            if (!busy)
              setEditing(
                data.tasks.find((t) => t.id === info.event.id) || null,
              );
          }}
          eventDrop={(info) => void updateEvent(info)}
          eventResize={(info) => void updateEvent(info)}
          eventContent={(info) => (
            <div className="calendar-event-content">
              <span>{info.timeText}</span>
              <strong>{info.event.title}</strong>
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
          task={editing}
          data={data}
          busy={busy}
          onSave={save}
          onDelete={() => void remove()}
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
    </div>
  );
}

function TaskDialog({
  task,
  data,
  busy,
  onSave,
  onDelete,
  onClose,
  onOpenNote,
  onChange,
}: {
  task: Task;
  data: Snapshot;
  busy: boolean;
  onSave: (t: Task) => Promise<void>;
  onDelete: () => void;
  onClose: () => void;
  onOpenNote: (n: Note) => void;
  onChange: (s: Snapshot) => void;
}) {
  const [value, setValue] = useState<Task>({
      ...task,
      noteIds: [...task.noteIds],
    }),
    [start, setStart] = useState(localInput(task.start)),
    [end, setEnd] = useState(localInput(task.end)),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [creating, setCreating] = useState(false),
    [newTitle, setNewTitle] = useState(""),
    [newBody, setNewBody] = useState(""),
    [creatingBusy, setCreatingBusy] = useState(false);
  const dirty =
    JSON.stringify(value) !== JSON.stringify(task) ||
    start !== localInput(task.start) ||
    end !== localInput(task.end) ||
    newTitle !== "" ||
    newBody !== "";
  const close = () => {
    if (
      !busy &&
      !creatingBusy &&
      (!dirty ||
        window.confirm("Закрыть карточку без сохранения изменений задачи?"))
    )
      onClose();
  };
  const submit = async () => {
    setError("");
    const a = new Date(start),
      b = new Date(end);
    if (
      !Number.isFinite(a.getTime()) ||
      !Number.isFinite(b.getTime()) ||
      b <= a
    ) {
      setError("Конец задачи должен быть позже начала.");
      return;
    }
    try {
      await onSave({ ...value, start: a.toISOString(), end: b.toISOString() });
    } catch (e) {
      setError(errorText(e));
    }
  };
  const createNote = async () => {
    if (!newTitle.trim() && !newBody.trim()) return;
    setCreatingBusy(true);
    setError("");
    try {
      const n = await api.saveNote({
        ...emptyNote("", start.slice(0, 10)),
        title: newTitle,
        body: newBody,
      });
      onChange(await api.load());
      setValue((v) => ({ ...v, noteIds: [...v.noteIds, n.id] }));
      setNewTitle("");
      setNewBody("");
      setCreating(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setCreatingBusy(false);
    }
  };
  return (
    <Dialog title={task.id ? "Задача" : "Новая задача"} onClose={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <fieldset disabled={busy || creatingBusy}>
          <label>
            Название задачи
            <input
              autoFocus
              aria-label="Название задачи"
              value={value.title}
              onChange={(e) => setValue({ ...value, title: e.target.value })}
              required
              maxLength={1000}
              placeholder="Например, утренний созвон"
            />
          </label>
          <div className="form-row">
            <label>
              Начало
              <input
                aria-label="Начало задачи"
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                required
              />
            </label>
            <label>
              Конец
              <input
                aria-label="Конец задачи"
                type="datetime-local"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                required
              />
            </label>
          </div>
          <label>
            Описание
            <textarea
              aria-label="Описание задачи"
              value={value.description}
              onChange={(e) =>
                setValue({ ...value, description: e.target.value })
              }
              rows={2}
              placeholder="Что нужно подготовить?"
            />
          </label>
          <div className="form-row align-center">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={value.done}
                onChange={(e) => setValue({ ...value, done: e.target.checked })}
              />
              <Check size={16} />
              Задача завершена
            </label>
            <label className="color-label">
              Цвет
              <input
                aria-label="Цвет задачи"
                type="color"
                value={value.color}
                onChange={(e) => setValue({ ...value, color: e.target.value })}
              />
            </label>
          </div>
          <div className="attachment-heading">
            <h3>Заметки к задаче</h3>
            <button
              type="button"
              className="text-button"
              onClick={() => setCreating(!creating)}
            >
              <Plus size={15} />
              Новая заметка
            </button>
          </div>
          <input
            aria-label="Найти заметку для задачи"
            placeholder="Найти заметку для прикрепления"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="attach-list">
            {data.notes
              .filter((n) =>
                (n.title + " " + n.body)
                  .toLocaleLowerCase()
                  .includes(search.toLocaleLowerCase()),
              )
              .map((n) => (
                <div className="attach-row" key={n.id}>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      aria-label={`Прикрепить ${n.title || "Без названия"}`}
                      checked={value.noteIds.includes(n.id)}
                      onChange={(e) =>
                        setValue({
                          ...value,
                          noteIds: e.target.checked
                            ? [...value.noteIds, n.id]
                            : value.noteIds.filter((id) => id !== n.id),
                        })
                      }
                    />
                    <FileText size={15} />
                    <span>{n.title || "Без названия"}</span>
                  </label>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      if (
                        !dirty ||
                        window.confirm(
                          "Открыть заметку без сохранения изменений задачи?",
                        )
                      )
                        onOpenNote(n);
                    }}
                  >
                    Открыть
                  </button>
                </div>
              ))}
            {data.notes.length === 0 && (
              <p className="muted">Создайте первую заметку прямо здесь.</p>
            )}
          </div>
          {creating && (
            <div className="inline-note">
              <label>
                Заголовок новой заметки
                <input
                  aria-label="Заголовок новой заметки к задаче"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                />
              </label>
              <label>
                Текст новой заметки
                <textarea
                  aria-label="Текст новой заметки к задаче"
                  value={newBody}
                  onChange={(e) => setNewBody(e.target.value)}
                  rows={3}
                />
              </label>
              <button
                type="button"
                className="secondary-button"
                disabled={!newTitle.trim() && !newBody.trim()}
                onClick={() => void createNote()}
              >
                Создать и прикрепить
              </button>
            </div>
          )}
        </fieldset>
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
        <div className="dialog-footer">
          {task.id && (
            <button
              type="button"
              className="text-button danger"
              disabled={busy || creatingBusy}
              onClick={onDelete}
            >
              <Trash2 size={15} />
              Удалить
            </button>
          )}
          <button
            type="button"
            className="secondary-button"
            disabled={busy || creatingBusy}
            onClick={close}
          >
            Отмена
          </button>
          <button
            type="submit"
            className="primary-button"
            disabled={busy || creatingBusy}
          >
            Сохранить задачу
          </button>
        </div>
      </form>
    </Dialog>
  );
}
