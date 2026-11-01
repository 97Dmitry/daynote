import { useState } from "react";
import { Dialog } from "./Dialog";
import { localInput } from "./taskTime";
import { errorText, type Note, type Task, type Occurrence, type TaskException } from "./types";

export function OccurrenceDialog({
  task,
  occurrence,
  notes,
  busy,
  onSave,
  onEditSeries,
  onDeleteSeries,
  onOpenNote,
  onClose,
}: {
  task: Task;
  occurrence: Occurrence;
  notes: Note[];
  busy: boolean;
  onSave: (ex: TaskException) => Promise<void>;
  onEditSeries: () => void;
  onDeleteSeries: () => void;
  onOpenNote: (n: Note) => void;
  onClose: () => void;
}) {
  const [start, setStart] = useState(localInput(occurrence.start)),
    [end, setEnd] = useState(localInput(occurrence.end)),
    [done, setDone] = useState(occurrence.done),
    [error, setError] = useState("");
  const dirty =
    start !== localInput(occurrence.start) ||
    end !== localInput(occurrence.end) ||
    done !== occurrence.done;
  const mayLeave = () =>
    !dirty || window.confirm("Закрыть карточку без сохранения изменений повторения?");
  const close = () => {
    if (!busy && mayLeave()) onClose();
  };
  const save = async (skipped = false) => {
    setError("");
    const a = new Date(start),
      b = new Date(end);
    if (!skipped && (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime()) || b <= a)) {
      setError("Конец задачи должен быть позже начала.");
      return;
    }
    const previous = task.exceptions?.find((ex) => ex.date === occurrence.date);
    const moved = start !== localInput(occurrence.start) || end !== localInput(occurrence.end);
    try {
      await onSave({
        date: occurrence.date,
        done: skipped ? false : done,
        skipped,
        start: skipped ? "" : moved ? a.toISOString() : (previous?.start ?? ""),
        end: skipped ? "" : moved ? b.toISOString() : (previous?.end ?? ""),
      });
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <Dialog title={`Повторение · ${occurrence.date}`} onClose={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={busy}>
          <h3>{task.title}</h3>
          {task.description && <p className="occurrence-description">{task.description}</p>}
          <p className="muted">
            Изменения относятся только к этому повторению. Исходная дата: {occurrence.date} (
            {task.recurrence?.timeZone}). Время ниже — местное время компьютера.
          </p>
          <div className="form-row">
            <label>
              Начало
              <input
                aria-label="Начало повторения"
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                required
              />
            </label>
            <label>
              Конец
              <input
                aria-label="Конец повторения"
                type="datetime-local"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                required
              />
            </label>
          </div>
          <label className="checkbox-label">
            <input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} />
            Повторение выполнено
          </label>
          <div className="settings-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                if (mayLeave()) onEditSeries();
              }}
            >
              Изменить серию
            </button>
            <button
              type="button"
              className="text-button danger"
              onClick={() => {
                if (window.confirm("Удалить всю серию? Прикреплённые заметки останутся."))
                  onDeleteSeries();
              }}
            >
              Удалить серию
            </button>
          </div>
          {notes
            .filter((n) => task.noteIds.includes(n.id))
            .map((n) => (
              <button
                key={n.id}
                className="text-button"
                type="button"
                onClick={() => {
                  if (mayLeave()) onOpenNote(n);
                }}
              >
                Открыть заметку {n.title || "Без названия"}
              </button>
            ))}
        </fieldset>
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
        <div className="dialog-footer">
          <button
            type="button"
            className="text-button danger"
            disabled={busy}
            onClick={() => {
              if (window.confirm("Удалить только это повторение?")) void save(true);
            }}
          >
            Удалить это повторение
          </button>
          <button type="button" className="secondary-button" disabled={busy} onClick={close}>
            Отмена
          </button>
          <button type="submit" className="primary-button" disabled={busy}>
            Сохранить повторение
          </button>
        </div>
      </form>
    </Dialog>
  );
}
