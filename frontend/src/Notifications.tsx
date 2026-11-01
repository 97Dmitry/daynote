import { Bell, Check } from "lucide-react";
import type { NotificationItem } from "./types";

export function NotificationsView({
  items,
  error,
  onAcknowledge,
  onOpenTask,
}: {
  items: NotificationItem[];
  error: string;
  onAcknowledge: (id: string) => void;
  onOpenTask: (taskId: string, occurrenceDate?: string) => void;
}) {
  const unread = items.filter((item) => !item.read).length;
  return (
    <div className="notifications-page">
      <header className="page-header">
        <div>
          <h1>Уведомления</h1>
          <p>Непрочитанных: {unread}</p>
        </div>
        <button className="secondary-button" disabled={!unread} onClick={() => onAcknowledge("")}>
          <Check size={16} />
          Прочитать все
        </button>
      </header>
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      {items.length === 0 && (
        <div className="empty-state">
          <Bell size={28} />
          <p>Напоминаний пока нет.</p>
        </div>
      )}
      <div className="notification-list">
        {items.map((item) => (
          <article
            key={item.id}
            className={`notification-item${item.read ? "" : " notification-unread"}`}
          >
            <div>
              <h2>{item.taskTitle || "Без названия"}</h2>
              <span className="muted">{item.read ? "Прочитано" : "Непрочитано"}</span>
            </div>
            <div className="notification-times">
              <p>
                Напоминание:{" "}
                <time dateTime={item.dueAt}>{new Date(item.dueAt).toLocaleString("ru-RU")}</time>
              </p>
              <p>
                Начало задачи:{" "}
                <time dateTime={item.taskStart}>
                  {new Date(item.taskStart).toLocaleString("ru-RU")}
                </time>
              </p>
            </div>
            <div className="settings-actions">
              <button
                className="secondary-button"
                onClick={() => onOpenTask(item.taskId, item.occurrenceDate)}
              >
                Открыть задачу
              </button>
              {!item.read && (
                <button className="text-button" onClick={() => onAcknowledge(item.id)}>
                  Отметить прочитанным
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
