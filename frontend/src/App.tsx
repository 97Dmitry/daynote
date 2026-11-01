import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Check,
  Folder,
  FolderPlus,
  Mic,
  NotebookPen,
  Pin,
  Plus,
  Search,
  Settings as SettingsIcon,
  Trash2,
} from "lucide-react";
import { api } from "./api";
import { emptyNote, errorText, noteSignature, type Note, type Snapshot, type Topic } from "./types";
import { CalendarView } from "./Calendar";
import { SettingsView } from "./Settings";
import { Voice } from "./Voice";
import { Dialog } from "./Dialog";
import { ThemeProvider, ThemeSelect } from "./Theme";
import { ContextActions, ActionButton, type MenuAction } from "./ActionMenu";
import { MarkdownNote } from "./MarkdownNote";

const empty: Snapshot = { version: 1, topics: [], notes: [], tasks: [] };
export function App() {
  return (
    <ThemeProvider>
      <Notebook />
    </ThemeProvider>
  );
}
function Notebook() {
  const [editorMode, setEditorMode] = useState("edit");
  const [data, setData] = useState<Snapshot>(empty),
    [loaded, setLoaded] = useState(false),
    [view, setView] = useState("notes"),
    [scope, setScope] = useState("*"),
    [query, setQuery] = useState(""),
    [sort, setSort] = useState("newest");
  const [draft, setDraft] = useState<Note | null>(null),
    [status, setStatus] = useState("Сохранено"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [topicDialog, setTopicDialog] = useState<Topic | null>(null),
    [voiceNote, setVoiceNote] = useState<Note | null>(null);
  const current = useRef<Note | null>(null),
    saved = useRef(""),
    queue = useRef<Promise<void>>(Promise.resolve()),
    busyRef = useRef(false),
    loadedRef = useRef(false);
  const select = useCallback((note: Note | null) => {
    current.current = note;
    saved.current = note ? noteSignature(note) : "";
    setDraft(note);
    setStatus("Сохранено");
  }, []);
  useEffect(() => {
    let active = true;
    api
      .load()
      .then((next) => {
        if (active) {
          setData(next);
          select(next.notes[0] || null);
          setLoaded(true);
          loadedRef.current = true;
        }
      })
      .catch((e) => setError(errorText(e)));
    return () => {
      active = false;
    };
  }, [select]);
  const edit = useCallback((patch: Partial<Note>) => {
    if (!current.current) return;
    const n = { ...current.current, ...patch };
    current.current = n;
    setDraft(n);
    setStatus("Не сохранено");
  }, []);
  const flush = useCallback(() => {
    const job = queue.current
      .catch(() => {})
      .then(async () => {
        while (current.current && noteSignature(current.current) !== saved.current) {
          const n = { ...current.current },
            signature = noteSignature(n);
          setStatus("Сохранение…");
          try {
            const result = await api.saveNote(n);
            setData((prev) => ({
              ...prev,
              notes: prev.notes.map((x) => (x.id === result.id ? result : x)),
            }));
            saved.current = signature;
            if (current.current?.id === n.id && noteSignature(current.current) === signature) {
              current.current = result;
              saved.current = noteSignature(result);
              setDraft(result);
            }
            setStatus("Сохранено");
          } catch (e) {
            setStatus("Ошибка сохранения");
            setError(errorText(e));
            throw e;
          }
        }
      });
    queue.current = job;
    return job;
  }, []);
  const run = useCallback(
    async (action: () => Promise<void>) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setError("");
      try {
        await flush();
        await action();
      } catch (e) {
        setError(errorText(e));
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [flush],
  );
  useEffect(() => {
    if (!draft || noteSignature(draft) === saved.current) return;
    const timer = setTimeout(() => {
      void flush().catch(() => {});
    }, 650);
    return () => clearTimeout(timer);
  }, [draft, flush]);
  useEffect(
    () =>
      api.on("app:closing", () => {
        if (
          document.querySelector('[role="dialog"]') &&
          !window.confirm(
            "Есть открытая карточка или голосовой черновик. Закрыть приложение без сохранения этих изменений?",
          )
        )
          return;
        if (!loadedRef.current) {
          void api.close();
          return;
        }
        void run(async () => {
          await api.cancelVoice();
          await api.close();
        });
      }),
    [run],
  );
  const navigate = (next: string) =>
    void run(async () => {
      setView(next);
    });
  const refresh = async () => {
    const next = await api.load();
    setData(next);
    return next;
  };
  const openNote = (n: Note) =>
    void run(async () => {
      const next = await refresh();
      const latest = next.notes.find((x) => x.id === n.id) || null;
      select(latest);
      setView("notes");
    });
  const newNote = () =>
    void run(async () => {
      const n = await api.saveNote(emptyNote(scope === "*" ? "" : scope));
      await refresh();
      select(n);
      setView("notes");
    });
  const chooseScope = (id: string) =>
    void run(async () => {
      setScope(id);
      setQuery("");
      const fresh = await refresh();
      const next = fresh.notes.find((n) => id === "*" || n.topicId === id) || null;
      select(next);
      setView("notes");
    });
  const pin = (n: Note) =>
    void run(async () => {
      const source = current.current?.id === n.id ? current.current : n;
      const result = await api.saveNote({ ...source, pinned: !source.pinned });
      await refresh();
      if (current.current?.id === n.id) select(result);
    });
  const move = (kind: string, id: string, delta: number) =>
    void run(async () => {
      setData(await api.move(kind, id, delta, scope));
    });
  const removeNote = (targetId?: string) =>
    void run(async () => {
      const deletingId = targetId || current.current?.id;
      if (!deletingId || !window.confirm("Удалить заметку и её связи с задачами?")) return;
      const next = await api.remove("note", deletingId);
      setData(next);
      if (current.current?.id === deletingId)
        select(next.notes.find((n) => scope === "*" || n.topicId === scope) || null);
    });
  const saveTopic = (topic: Topic) =>
    void run(async () => {
      await api.saveTopic(topic);
      await refresh();
      setTopicDialog(null);
    });
  const deleteTopic = () =>
    void run(async () => {
      if (!topicDialog?.id || !window.confirm("Удалить тему? Её заметки останутся без темы."))
        return;
      const next = await api.remove("topic", topicDialog.id);
      setData(next);
      if (scope === topicDialog.id) setScope("");
      if (current.current) select(next.notes.find((n) => n.id === current.current?.id) || null);
      setTopicDialog(null);
    });
  const removeTopicDirect = (t: Topic) =>
    void run(async () => {
      if (!window.confirm(`Удалить тему «${t.name}»? Заметки останутся без темы.`)) return;
      const next = await api.remove("topic", t.id);
      setData(next);
      if (scope === t.id) setScope("");
      if (current.current) select(next.notes.find((n) => n.id === current.current?.id) || null);
    });
  const topicActions = (t: Topic): MenuAction[] => [
    {
      label: "Переименовать тему",
      onSelect: () => setTopicDialog(t),
      disabled: busy,
      opensDialog: true,
    },
    { label: "Переместить выше", onSelect: () => move("topic", t.id, -1), disabled: busy },
    { label: "Переместить ниже", onSelect: () => move("topic", t.id, 1), disabled: busy },
    { label: "Удалить тему", onSelect: () => removeTopicDirect(t), disabled: busy, danger: true },
  ];
  const noteActions = (n: Note): MenuAction[] => [
    { label: "Открыть заметку", onSelect: () => openNote(n), disabled: busy },
    {
      label: n.pinned ? "Открепить заметку" : "Закрепить заметку",
      onSelect: () => pin(n),
      disabled: busy,
    },
    {
      label: "Переместить выше",
      onSelect: () => move("note", n.id, -1),
      disabled: busy || sort !== "manual" || !!query,
    },
    {
      label: "Переместить ниже",
      onSelect: () => move("note", n.id, 1),
      disabled: busy || sort !== "manual" || !!query,
    },
    { label: "Удалить заметку", onSelect: () => removeNote(n.id), disabled: busy, danger: true },
  ];
  const filtered = data.notes
    .filter(
      (n) =>
        (scope === "*" || n.topicId === scope) &&
        `${n.title}\n${n.body}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        (sort === "manual"
          ? a.position - b.position
          : sort === "newest"
            ? b.date.localeCompare(a.date)
            : a.date.localeCompare(b.date)) ||
        a.position - b.position ||
        a.id.localeCompare(b.id),
    );
  const topic = data.topics.find((t) => t.id === scope),
    scopeName =
      scope === "*" ? "Все заметки" : scope === "" ? "Без темы" : topic?.name || "Заметки";
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-symbol">
            <NotebookPen size={23} />
          </div>
          <span>Daynote</span>
        </div>
        <div className="sidebar-caption">Место для мыслей и планов</div>
        <nav className="main-nav" aria-label="Разделы">
          <button
            className={view === "notes" ? "active" : ""}
            onClick={() => navigate("notes")}
            disabled={busy}
          >
            <NotebookPen size={19} />
            Заметки<span className="nav-count">{data.notes.length}</span>
          </button>
          <button
            className={view === "calendar" ? "active" : ""}
            onClick={() => navigate("calendar")}
            disabled={busy}
          >
            <CalendarDays size={19} />
            Календарь
          </button>
        </nav>
        <div className="topics-heading">
          <span>Темы</span>
          <button
            className="icon-button"
            aria-label="Добавить тему"
            disabled={busy}
            onClick={() =>
              setTopicDialog({
                id: "",
                name: "",
                color: "#467769",
                position: 0,
              })
            }
          >
            <FolderPlus size={17} />
          </button>
        </div>
        <div className="topics-list">
          <button
            className={`topic-choice ${scope === "*" && view === "notes" ? "selected" : ""}`}
            onClick={() => chooseScope("*")}
            disabled={busy}
          >
            <span className="topic-dot all-dot" />
            Все заметки
          </button>
          <button
            className={`topic-choice ${scope === "" && view === "notes" ? "selected" : ""}`}
            onClick={() => chooseScope("")}
            disabled={busy}
          >
            <Folder size={15} />
            Без темы
          </button>
          {data.topics.map((t) => (
            <ContextActions key={t.id} items={topicActions(t)}>
              <div className="topic-row">
                <button
                  className={`topic-choice ${scope === t.id && view === "notes" ? "selected" : ""}`}
                  onClick={() => chooseScope(t.id)}
                  disabled={busy}
                >
                  <span className="topic-dot" style={{ background: t.color }} />
                  <span className="truncate">{t.name}</span>
                </button>
                <ActionButton items={topicActions(t)} label={`Действия темы ${t.name}`} />
              </div>
            </ContextActions>
          ))}
        </div>
        <div className="sidebar-bottom">
          <ThemeSelect />
          <div className="local-indicator">
            <span />
            Данные на этом компьютере
          </div>
          <button
            className={view === "settings" ? "settings-link active" : "settings-link"}
            onClick={() => navigate("settings")}
            disabled={busy}
          >
            <SettingsIcon size={18} />
            Настройки
          </button>
        </div>
      </aside>
      <main className="workspace">
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button onClick={() => setError("")} aria-label="Скрыть ошибку">
              ×
            </button>
          </div>
        )}
        {!loaded ? (
          <div className="empty-state">
            <NotebookPen size={36} />
            <h1>Daynote</h1>
            <p>
              {error
                ? "Не удалось открыть данные. Закройте приложение и проверьте каталог данных."
                : "Открываем ваши записи…"}
            </p>
          </div>
        ) : view === "notes" ? (
          <>
            <header className="page-header">
              <div>
                <h1>{scopeName}</h1>
                <p>
                  {filtered.length === 0
                    ? "Запишите то, что хочется сохранить"
                    : `${filtered.length} ${filtered.length === 1 ? "запись" : "записей"} в вашем пространстве`}
                </p>
              </div>
              <button className="primary-button" onClick={newNote} disabled={busy}>
                <Plus size={18} />
                Новая заметка
              </button>
            </header>
            <div className="notes-workspace">
              <section className="note-list-panel" aria-label="Список заметок">
                <div className="list-tools">
                  <label className="search-input">
                    <Search size={17} />
                    <input
                      aria-label="Поиск заметок"
                      placeholder="Найти в заметках"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  <select
                    aria-label="Сортировка заметок"
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                  >
                    <option value="newest">По дате: сначала новые</option>
                    <option value="oldest">По дате: сначала старые</option>
                    <option value="manual">Мой порядок</option>
                  </select>
                </div>
                <div className="note-list">
                  {filtered.map((n, i) => (
                    <ContextActions key={n.id} items={noteActions(n)}>
                      <div
                        key={n.id}
                        className={`note-item ${draft?.id === n.id ? "selected" : ""}`}
                      >
                        {n.pinned && (i === 0 || !filtered[i - 1].pinned) && (
                          <div className="pin-label">
                            <Pin size={12} />
                            Закреплено
                          </div>
                        )}
                        <button
                          className="note-open"
                          aria-label={`Открыть заметку ${n.title || "Без названия"}`}
                          disabled={busy}
                          onClick={() => openNote(n)}
                        >
                          <div className="note-title">{n.title || "Без названия"}</div>
                          <p>{n.body.replace(/\s+/g, " ").slice(0, 105) || "Пока без текста"}</p>
                          <div className="note-meta">
                            <time>
                              {new Date(`${n.date}T12:00:00`).toLocaleDateString("ru-RU", {
                                day: "numeric",
                                month: "short",
                              })}
                            </time>
                            {n.topicId && (
                              <span>
                                <i
                                  style={{
                                    background: data.topics.find((t) => t.id === n.topicId)?.color,
                                  }}
                                />
                                {data.topics.find((t) => t.id === n.topicId)?.name}
                              </span>
                            )}
                          </div>
                        </button>
                        <div className="note-row-actions">
                          <ActionButton
                            items={noteActions(n)}
                            label={`Действия заметки ${n.title || "Без названия"}`}
                          />
                          <button
                            className={`icon-button small ${n.pinned ? "pinned" : ""}`}
                            aria-label={n.pinned ? "Открепить заметку" : "Закрепить заметку"}
                            onClick={() => pin(n)}
                            disabled={busy}
                          >
                            <Pin size={14} />
                          </button>
                          {sort === "manual" && !query && (
                            <>
                              <button
                                className="icon-button small"
                                aria-label="Заметка выше"
                                onClick={() => move("note", n.id, -1)}
                                disabled={busy}
                              >
                                <ArrowUp size={14} />
                              </button>
                              <button
                                className="icon-button small"
                                aria-label="Заметка ниже"
                                onClick={() => move("note", n.id, 1)}
                                disabled={busy}
                              >
                                <ArrowDown size={14} />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </ContextActions>
                  ))}
                  {filtered.length === 0 && (
                    <div className="list-empty">
                      {query
                        ? "Совпадений нет. Попробуйте другое слово."
                        : "Здесь появятся ваши заметки."}
                    </div>
                  )}
                </div>
              </section>
              <section className="editor-panel" aria-label="Редактор заметки">
                {draft ? (
                  <>
                    <div className="editor-toolbar">
                      <div className="editor-properties">
                        <label>
                          Дата
                          <input
                            aria-label="Дата заметки"
                            type="date"
                            value={draft.date}
                            disabled={busy}
                            onChange={(e) => edit({ date: e.target.value })}
                          />
                        </label>
                        <label>
                          Тема
                          <select
                            aria-label="Тема заметки"
                            value={draft.topicId}
                            disabled={busy}
                            onChange={(e) => edit({ topicId: e.target.value })}
                          >
                            <option value="">Без темы</option>
                            {data.topics.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <div className="editor-actions">
                        <button
                          className={`icon-button ${draft.pinned ? "pinned" : ""}`}
                          aria-label={
                            draft.pinned ? "Открепить текущую заметку" : "Закрепить текущую заметку"
                          }
                          onClick={() => edit({ pinned: !draft.pinned })}
                          disabled={busy}
                        >
                          <Pin size={18} />
                        </button>
                        <button
                          className="icon-button danger"
                          aria-label="Удалить заметку"
                          onClick={() => removeNote()}
                          disabled={busy}
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>
                    <div className="editor-tabs" role="group" aria-label="Режим заметки">
                      <button
                        aria-pressed={editorMode === "edit"}
                        onClick={() => setEditorMode("edit")}
                      >
                        Редактор
                      </button>
                      <button
                        aria-pressed={editorMode === "preview"}
                        onClick={() => setEditorMode("preview")}
                      >
                        Просмотр
                      </button>
                      <span>Markdown</span>
                    </div>
                    <div className="editor-document">
                      <input
                        className="title-input"
                        aria-label="Заголовок заметки"
                        placeholder="Без названия"
                        value={draft.title}
                        onChange={(e) => edit({ title: e.target.value })}
                        maxLength={1000}
                        disabled={busy}
                      />
                      {editorMode === "preview" ? (
                        <MarkdownNote text={draft.body} />
                      ) : (
                        <textarea
                          className="body-input"
                          aria-label="Текст заметки"
                          placeholder="Начните писать. Здесь можно оставить мысль, план или записать её голосом…"
                          value={draft.body}
                          onChange={(e) => edit({ body: e.target.value })}
                          disabled={busy}
                        />
                      )}
                    </div>
                    <footer className="editor-footer">
                      <button
                        className="voice-button"
                        aria-label="Записать голосом"
                        disabled={busy || !!voiceNote}
                        onClick={() =>
                          void run(async () => {
                            setVoiceNote(current.current);
                          })
                        }
                      >
                        <Mic size={17} />
                        Записать голосом
                      </button>
                      <button
                        className={`save-status ${status.includes("Ошибка") ? "danger" : ""}`}
                        onClick={() => void flush().catch(() => {})}
                      >
                        <Check size={14} />
                        {status}
                      </button>
                      <span className="char-count">{draft.body.length} символов</span>
                    </footer>
                  </>
                ) : (
                  <div className="empty-state">
                    <div className="empty-icon">
                      <NotebookPen size={36} />
                    </div>
                    <h2>У каждой мысли своё место</h2>
                    <p>
                      Создайте заметку, выберите тему
                      <br />и возвращайтесь к ней, когда нужно.
                    </p>
                    <button className="primary-button" onClick={newNote} disabled={busy}>
                      <Plus size={17} />
                      Создать заметку
                    </button>
                  </div>
                )}
              </section>
            </div>
          </>
        ) : view === "calendar" ? (
          <CalendarView
            data={data}
            onChange={setData}
            onOpenNote={openNote}
            onError={setError}
            onBusyChange={(value) => {
              busyRef.current = value;
              setBusy(value);
            }}
          />
        ) : (
          <SettingsView
            onBusyChange={(value) => {
              busyRef.current = value;
              setBusy(value);
            }}
            onRestore={(next) => {
              setData(next);
              select(next.notes[0] || null);
            }}
          />
        )}
      </main>
      {topicDialog && (
        <TopicDialog
          topic={topicDialog}
          busy={busy}
          onClose={() => {
            if (!busy) setTopicDialog(null);
          }}
          onSave={saveTopic}
          onDelete={deleteTopic}
        />
      )}
      {voiceNote && (
        <Voice
          note={voiceNote}
          onClose={() => setVoiceNote(null)}
          onInsert={async (text) => {
            if (current.current?.id === voiceNote.id) {
              edit({
                body: [current.current.body, text].filter(Boolean).join("\n\n"),
              });
              setVoiceNote(null);
            } else {
              setError("Сначала откройте исходную заметку.");
            }
          }}
        />
      )}
    </div>
  );
}
function TopicDialog({
  topic,
  busy,
  onClose,
  onSave,
  onDelete,
}: {
  topic: Topic;
  busy: boolean;
  onClose: () => void;
  onSave: (t: Topic) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(topic.name),
    [color, setColor] = useState(topic.color);
  return (
    <Dialog
      title={topic.id ? "Изменить тему" : "Новая тема"}
      onClose={() => {
        if (
          !busy &&
          ((name === topic.name && color === topic.color) ||
            window.confirm("Закрыть тему без сохранения изменений?"))
        )
          onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ ...topic, name, color });
        }}
      >
        <label>
          Название
          <input
            autoFocus
            aria-label="Название темы"
            disabled={busy}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={300}
          />
        </label>
        <label>
          Цвет
          <input
            aria-label="Цвет темы"
            disabled={busy}
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </label>
        <div className="dialog-footer">
          {topic.id && (
            <button type="button" className="text-button danger" onClick={onDelete} disabled={busy}>
              Удалить тему
            </button>
          )}
          <button className="primary-button" type="submit" disabled={busy || !name.trim()}>
            Сохранить тему
          </button>
        </div>
      </form>
    </Dialog>
  );
}
