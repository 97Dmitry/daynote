import { useState } from "react";
import { Check, FileText, Plus, Trash2 } from "lucide-react";
import { api } from "./api";
import { Dialog } from "./Dialog";
import { ReminderEditor } from "./ReminderEditor";
import { RecurrenceEditor } from "./RecurrenceEditor";
import { localInput } from "./taskTime";
import { emptyNote, errorText, type Note, type Snapshot, type Task } from "./types";

export function TaskDialog({
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
  onSave: (t: Task, discard?: boolean) => Promise<void>;
  onDelete: () => void;
  onClose: () => void;
  onOpenNote: (n: Note) => void;
  onChange: (s: Snapshot) => void;
}) {
  const [value, setValue] = useState<Task>({
      ...task,
      noteIds: [...task.noteIds],
      reminders: (task.reminders ?? []).map((row) => ({ ...row })),
    }),
    [start, setStart] = useState(localInput(task.start)),
    [end, setEnd] = useState(localInput(task.end)),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [creating, setCreating] = useState(false),
    [newTitle, setNewTitle] = useState(""),
    [newBody, setNewBody] = useState(""),
    [creatingBusy, setCreatingBusy] = useState(false);
  const [exceptionBusy, setExceptionBusy] = useState(false);
  const dirty =
    JSON.stringify({ ...value, exceptions: undefined }) !==
      JSON.stringify({ ...task, exceptions: undefined, reminders: task.reminders ?? [] }) ||
    start !== localInput(task.start) ||
    end !== localInput(task.end) ||
    newTitle !== "" ||
    newBody !== "";
  const close = () => {
    if (
      !busy &&
      !creatingBusy &&
      !exceptionBusy &&
      (!dirty || window.confirm("Закрыть карточку без сохранения изменений задачи?"))
    )
      onClose();
  };
  const submit = async () => {
    setError("");
    const a = new Date(start),
      b = new Date(end);
    if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime()) || b <= a) {
      setError("Конец задачи должен быть позже начала.");
      return;
    }
    if (value.recurrence && !value.recurrence.weekdays.length) {
      setError("Выберите хотя бы один день недели.");
      return;
    }
    try {
      const candidate = {
        ...value,
        done: value.recurrence ? false : value.done,
        start: a.toISOString(),
        end: b.toISOString(),
      };
      let discard = false;
      if (task.id && task.recurrence) {
        const count = await api.taskChangeImpact(candidate);
        if (count || !value.recurrence) {
          if (
            !window.confirm(
              `Изменение всей серии сбросит исключения вне нового расписания: ${count}. Продолжить?`,
            )
          )
            return;
          discard = true;
        }
      } else if (
        value.recurrence &&
        value.done &&
        !window.confirm("При включении повторения отметка выполнения будет сброшена. Продолжить?")
      )
        return;
      let noteIds = value.noteIds;
      if (newTitle.trim() || newBody.trim()) {
        const id = await createNote();
        if (!id) return;
        noteIds = [...noteIds, id];
      }
      await onSave(
        {
          ...candidate,
          noteIds,
        },
        discard,
      );
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
      return n.id;
    } catch (e) {
      setError(errorText(e));
    } finally {
      setCreatingBusy(false);
    }
  };
  return (
    <Dialog
      title={task.id ? (task.recurrence ? "Серия задач" : "Задача") : "Новая задача"}
      onClose={close}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <fieldset disabled={busy || creatingBusy || exceptionBusy}>
          {task.recurrence && (
            <p className="muted">
              Изменения применяются ко всей серии, включая прошлые даты. Переносы отдельных дней
              сохраняют своё время.
            </p>
          )}
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
          <RecurrenceEditor
            value={value.recurrence}
            onChange={(recurrence) => setValue({ ...value, recurrence })}
          />
          <label>
            Описание
            <textarea
              aria-label="Описание задачи"
              value={value.description}
              onChange={(e) => setValue({ ...value, description: e.target.value })}
              rows={2}
              placeholder="Что нужно подготовить?"
            />
          </label>
          <div className="form-row align-center">
            {!value.recurrence && (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={value.done}
                  onChange={(e) => setValue({ ...value, done: e.target.checked })}
                />
                <Check size={16} />
                Задача завершена
              </label>
            )}
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
          <ReminderEditor
            value={value.reminders}
            onChange={(reminders) => setValue({ ...value, reminders })}
          />
          {value.recurrence && value.reminders.some((r) => r.kind === "at") && (
            <p className="muted">
              Напоминание «в конкретное время» повторяется с тем же сдвигом календарных дней
              относительно начала серии, в её часовом поясе. Поля дат и времени выше показаны в
              местном времени компьютера.
            </p>
          )}
          {!!value.exceptions?.length && (
            <div className="series-exceptions">
              <h3>Исключения серии</h3>
              {value.exceptions.map((ex) => (
                <div className="exception-row" key={ex.date}>
                  <span>
                    {ex.date} · {ex.skipped ? "Удалено" : ex.start ? "Перенесено" : ""}
                    {ex.done ? " · Выполнено" : ""}
                  </span>
                  <button
                    type="button"
                    className="text-button"
                    onClick={async () => {
                      if (
                        !window.confirm(
                          `Сбросить все изменения повторения ${ex.date}, включая перенос, удаление и выполнение?`,
                        )
                      )
                        return;
                      setExceptionBusy(true);
                      setError("");
                      try {
                        await api.resetException(task.id, ex.date);
                        setValue((v) => ({
                          ...v,
                          exceptions: v.exceptions?.filter((p) => p.date !== ex.date),
                        }));
                        onChange(await api.load());
                      } catch (e) {
                        setError(errorText(e));
                      } finally {
                        setExceptionBusy(false);
                      }
                    }}
                  >
                    Сбросить {ex.date}
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="attachment-heading">
            <h3>Заметки к задаче</h3>
            <button type="button" className="text-button" onClick={() => setCreating(!creating)}>
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
                (n.title + " " + n.body).toLocaleLowerCase().includes(search.toLocaleLowerCase()),
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
                        window.confirm("Открыть заметку без сохранения изменений задачи?")
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
              disabled={busy || creatingBusy || exceptionBusy}
              onClick={onDelete}
            >
              <Trash2 size={15} />
              Удалить
            </button>
          )}
          <button
            type="button"
            className="secondary-button"
            disabled={busy || creatingBusy || exceptionBusy}
            onClick={close}
          >
            Отмена
          </button>
          <button
            type="submit"
            className="primary-button"
            disabled={busy || creatingBusy || exceptionBusy}
          >
            Сохранить задачу
          </button>
        </div>
      </form>
    </Dialog>
  );
}
