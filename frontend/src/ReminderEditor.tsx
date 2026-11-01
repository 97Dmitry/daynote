import { Plus, Trash2 } from "lucide-react";
import type { Reminder } from "./types";

const localTime = (instant: string) => {
  if (!instant) return "";
  const d = new Date(instant);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function ReminderEditor({
  value,
  onChange,
}: {
  value: Reminder[];
  onChange: (reminders: Reminder[]) => void;
}) {
  const update = (id: string, patch: Partial<Reminder>) =>
    onChange(value.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  return (
    <section className="reminder-editor" aria-label="Напоминания задачи">
      <div className="attachment-heading">
        <h3>Напоминания</h3>
        <button
          type="button"
          className="text-button"
          disabled={value.length >= 64}
          onClick={() =>
            onChange([
              ...value,
              { id: crypto.randomUUID(), kind: "before", minutesBefore: 30, at: "", sound: true },
            ])
          }
        >
          <Plus size={15} />
          Добавить напоминание
        </button>
      </div>
      {value.length === 0 && <p className="muted">У задачи нет напоминаний.</p>}
      {value.map((row, index) => (
        <div className="reminder-row" key={row.id}>
          <div className="form-row">
            <label>
              Когда напомнить
              <select
                aria-label={`Режим напоминания ${index + 1}`}
                value={row.kind}
                onChange={(e) => update(row.id, { kind: e.target.value })}
              >
                <option value="before">До начала</option>
                <option value="at">В конкретное время</option>
              </select>
            </label>
            {row.kind === "at" ? (
              <label>
                Дата и время
                <input
                  aria-label={`Время напоминания ${index + 1}`}
                  type="datetime-local"
                  required
                  value={localTime(row.at)}
                  onChange={(e) => {
                    const d = new Date(e.target.value);
                    update(row.id, { at: Number.isFinite(d.getTime()) ? d.toISOString() : "" });
                  }}
                />
              </label>
            ) : (
              <label>
                Минут до начала
                <input
                  aria-label={`Минут до начала ${index + 1}`}
                  type="number"
                  min={0}
                  max={525600}
                  step={1}
                  required
                  value={row.minutesBefore}
                  onChange={(e) => update(row.id, { minutesBefore: Number(e.target.value) })}
                />
              </label>
            )}
          </div>
          <div className="form-row align-center">
            <label className="checkbox-label">
              <input
                aria-label={`Звук напоминания ${index + 1}`}
                type="checkbox"
                checked={row.sound}
                onChange={(e) => update(row.id, { sound: e.target.checked })}
              />
              Звук
            </label>
            <button
              type="button"
              className="text-button danger"
              aria-label={`Удалить напоминание ${index + 1}`}
              onClick={() => onChange(value.filter((r) => r.id !== row.id))}
            >
              <Trash2 size={15} />
              Удалить
            </button>
          </div>
        </div>
      ))}
      {value.length > 0 && (
        <p className="muted">
          Время указано в часовом поясе компьютера. Звук зависит от настроек Windows.
        </p>
      )}
    </section>
  );
}
