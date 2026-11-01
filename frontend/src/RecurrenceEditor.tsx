import type { Recurrence } from "./types";

const presets: Record<string, number[]> = {
  daily: [1, 2, 3, 4, 5, 6, 7],
  weekdays: [1, 2, 3, 4, 5],
  weekend: [6, 7],
};
const days = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
export function RecurrenceEditor({
  value,
  onChange,
}: {
  value?: Recurrence;
  onChange: (value?: Recurrence) => void;
}) {
  const mode = !value
    ? "none"
    : (Object.keys(presets).find(
        (k) => JSON.stringify(presets[k]) === JSON.stringify(value.weekdays),
      ) ?? "custom");
  return (
    <div className="recurrence-editor">
      <label>
        Повторять
        <select
          aria-label="Повторять"
          value={mode}
          onChange={(e) => {
            if (e.target.value === "none") {
              onChange(undefined);
              return;
            }
            onChange({
              weekdays: [...(presets[e.target.value] ?? [])],
              timeZone: value?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
              until: value?.until ?? "",
            });
          }}
        >
          <option value="none">Не повторять</option>
          <option value="daily">Каждый день</option>
          <option value="weekdays">По будням</option>
          <option value="weekend">По выходным</option>
          <option value="custom">Выбранные дни</option>
        </select>
      </label>
      {value && (
        <>
          <div className="recurrence-days" role="group" aria-label="Дни недели">
            {days.map((label, i) => (
              <label key={label} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={value.weekdays.includes(i + 1)}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      weekdays: e.target.checked
                        ? [...value.weekdays, i + 1].sort((a, b) => a - b)
                        : value.weekdays.filter((d) => d !== i + 1),
                    })
                  }
                />
                {label}
              </label>
            ))}
          </div>
          <label>
            Повторять до
            <input
              aria-label="Повторять до"
              type="date"
              value={value.until}
              onChange={(e) => onChange({ ...value, until: e.target.value })}
            />
          </label>
          <p className="muted">
            Без даты окончания — бессрочно. Часовой пояс серии: {value.timeZone}. Будни и выходные
            без учёта праздников.
          </p>
        </>
      )}
    </div>
  );
}
