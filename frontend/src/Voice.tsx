import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { api } from "./api";
import { Dialog } from "./Dialog";
import { errorText, type Note, type VoiceEvent } from "./types";
export function Voice({
  note,
  onClose,
  onInsert,
}: {
  note: Note;
  onClose: () => void;
  onInsert: (text: string) => Promise<void>;
}) {
  const [session] = useState(() => crypto.randomUUID()),
    [state, setState] = useState("connecting"),
    [text, setText] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const started = useRef(false);
  useEffect(() => {
    const off = api.on("voice", (e: VoiceEvent) => {
      if (e.sessionId !== session) return;
      setState(e.state);
      setText(e.text);
      setError(e.error);
    });
    if (!started.current) {
      started.current = true;
      void api.startVoice(session).catch((e) => {
        setState("error");
        setError(errorText(e));
      });
    }
    return () => {
      off();
    };
  }, [session]);
  const stop = async () => {
    setBusy(true);
    try {
      await api.stopVoice();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const close = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.cancelVoice();
      onClose();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };
  const recording =
    state === "recording" || state === "connecting" || state === "stopping";
  return (
    <Dialog
      title="Голосовая заметка"
      session={session}
      onClose={() => void close()}
    >
      <p className="muted">
        Запись для «{note.title || "Без названия"}». Звук отправляется Google
        Gemini.
      </p>
      <div
        className={`voice-state ${state === "recording" ? "recording" : ""}`}
        role="status"
      >
        <Mic size={20} />
        {state === "connecting"
          ? "Подключаем микрофон и Gemini…"
          : state === "recording"
            ? "Идёт запись"
            : state === "stopping"
              ? "Получаем последнюю фразу…"
              : state === "ready"
                ? "Текст готов к проверке"
                : "Запись остановлена"}
      </div>
      <label>
        Распознанный текст
        <textarea
          aria-label="Распознанный текст"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={recording}
          rows={9}
          placeholder="Здесь появятся ваши слова…"
        />
      </label>
      {error && (
        <div role="alert" className="inline-error">
          {error}
        </div>
      )}
      <p className="muted small-copy">
        Проверьте текст перед добавлением. Исходная заметка пока не изменилась.
      </p>
      <div className="dialog-footer">
        <button
          className="secondary-button"
          onClick={() => void close()}
          disabled={busy}
        >
          Отмена
        </button>
        {recording ? (
          <button
            className="primary-button"
            onClick={() => void stop()}
            disabled={busy || state !== "recording"}
          >
            <Square size={15} />
            Остановить запись
          </button>
        ) : (
          <button
            className="primary-button"
            disabled={busy || !text.trim()}
            onClick={() => void onInsert(text.trim())}
          >
            Добавить в заметку
          </button>
        )}
      </div>
    </Dialog>
  );
}
