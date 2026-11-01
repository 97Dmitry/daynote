import { useEffect, useState } from "react";
import { Cloud, FolderOpen, KeyRound, ShieldCheck, Download, RotateCcw, Power } from "lucide-react";
import { api } from "./api";
import { errorText, type Settings, type Snapshot } from "./types";
export function SettingsView({
  onRestore,
  onBusyChange,
}: {
  onRestore: (s: Snapshot) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [settings, setSettings] = useState<Settings | null>(null),
    [key, setKey] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    api
      .settings()
      .then(setSettings)
      .catch((e) => setError(errorText(e)));
    return api.on("backup", setSettings);
  }, []);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    onBusyChange(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  };
  return (
    <div className="settings-page">
      <header className="page-header">
        <div>
          <h1>Настройки</h1>
          <p>Ваши записи под вашим контролем</p>
        </div>
      </header>
      {error && (
        <div role="alert" className="inline-error">
          {error}
        </div>
      )}
      {message && (
        <div role="status" className="success-banner">
          {message}
        </div>
      )}
      <section className="settings-section">
        <div className="settings-section-title">
          <Power size={21} />
          <div>
            <h2>Фоновая работа</h2>
            <p>Daynote остаётся доступен в системном трее</p>
          </div>
        </div>
        <label className="checkbox-label">
          <input
            type="checkbox"
            aria-label="Запускать с Windows"
            disabled={busy || !settings?.autostartSupported}
            checked={settings?.autostart ?? false}
            onChange={(e) => {
              const enabled = e.target.checked;
              void run(async () => {
                await api.setAutostart(enabled);
                setSettings(await api.settings());
              });
            }}
          />
          Запускать с Windows
        </label>
        <p className="muted">
          {!settings
            ? "Проверка автозапуска…"
            : !settings.autostartSupported
              ? "Автозапуск недоступен на этой платформе."
              : settings.autostart
                ? "Автозапуск включён."
                : "Автозапуск выключен."}
        </p>
        {settings?.autostartError && (
          <p className="inline-error" role="alert">
            Ошибка автозапуска: {settings.autostartError}
          </p>
        )}
        {settings?.notificationError && (
          <p className="inline-error" role="alert">
            Ошибка уведомлений: {settings.notificationError}
          </p>
        )}
        <p className="muted">
          Крестик и Alt+F4 скрывают окно. Daynote продолжает работать и показывать напоминания.
          Открыть окно или полностью завершить приложение можно через иконку в трее. При запуске с
          Windows окно остаётся скрытым.
        </p>
      </section>
      <section className="settings-section">
        <div className="settings-section-title">
          <KeyRound size={21} />
          <div>
            <h2>Голосовые заметки</h2>
            <p>Распознавание речи через Gemini, как в Solveo</p>
          </div>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api.setKey(key);
              setKey("");
              setSettings(await api.settings());
              setMessage("Ключ сохранён в Windows Credential Manager.");
            });
          }}
        >
          <label>
            API-ключ Gemini
            <input
              type="password"
              autoComplete="off"
              aria-label="API-ключ Gemini"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={
                settings?.keyConfigured
                  ? "Ключ уже сохранён. Введите новый для замены."
                  : "Введите ключ Gemini API"
              }
              disabled={busy}
            />
          </label>
          <div className="settings-actions">
            <button className="primary-button" disabled={busy || !key.trim()}>
              Сохранить ключ
            </button>
            {settings?.keyConfigured && (
              <>
                <span className="configured">
                  <ShieldCheck size={15} />
                  Ключ настроен
                </span>
                <button
                  type="button"
                  className="text-button danger"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api.setKey("");
                      setSettings(await api.settings());
                      setMessage("Ключ удалён.");
                    })
                  }
                >
                  Удалить ключ
                </button>
              </>
            )}
          </div>
        </form>
        <p className="muted">
          Ключ не попадает в заметки и резервные копии. Интернет и доступ к модели Gemini Transcribe
          Live нужны только для голосового ввода. Записывается микрофон Windows по умолчанию.
        </p>
      </section>
      <section className="settings-section">
        <div className="settings-section-title">
          <Cloud size={23} />
          <div>
            <h2>Резервные копии в OneDrive</h2>
            <p>Рабочие записи остаются на компьютере</p>
          </div>
        </div>
        <label>
          Папка резервных копий
          <div className="folder-path">{settings?.backupFolder || "Папка пока не выбрана"}</div>
        </label>
        <div className="settings-actions">
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setSettings(await api.chooseBackup());
              })
            }
          >
            <FolderOpen size={16} />
            Выбрать папку
          </button>
          <button
            className="secondary-button"
            disabled={busy || !settings?.backupFolder}
            onClick={() =>
              void run(async () => {
                setSettings(await api.backup());
                setMessage("Резервная копия создана в выбранной папке.");
              })
            }
          >
            <Download size={16} />
            Создать копию
          </button>
        </div>
        {settings?.lastBackup && (
          <p className="configured">
            Последняя копия: {new Date(settings.lastBackup).toLocaleString("ru-RU")}
          </p>
        )}
        {settings?.backupError && (
          <p role="alert" className="inline-error">
            Резервная копия не создана: {settings.backupError}
          </p>
        )}
        <p className="muted">
          После изменений Daynote автоматически сохраняет отдельную JSON-копию. Выберите папку
          внутри OneDrive, чтобы её загрузил клиент OneDrive. Состояние облачной загрузки
          проверяется в самом OneDrive. Старые копии не удаляются автоматически.
        </p>
      </section>
      <section className="settings-section">
        <div className="settings-section-title">
          <RotateCcw size={21} />
          <div>
            <h2>Восстановление</h2>
            <p>Вернуться к ранее сохранённым записям</p>
          </div>
        </div>
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              onRestore(await api.restore());
              setMessage("Операция восстановления завершена.");
            })
          }
        >
          Открыть резервную копию
        </button>
        <p className="muted">
          Перед заменой приложение проверит файл, запросит подтверждение и сохранит текущие записи в
          локальную папку recovery.
        </p>
        <label>
          Данные приложения
          <div className="folder-path">{settings?.dataFolder || "…"}</div>
        </label>
        <p className="muted">
          Первая версия работает локально. Резервные копии не являются синхронизацией между
          компьютерами.
        </p>
      </section>
    </div>
  );
}
