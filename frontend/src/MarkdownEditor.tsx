import { useEffect, useRef } from "react";
import { basicSetup } from "codemirror";
import { Annotation, Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { undo, redo, isolateHistory } from "@codemirror/commands";
import {
  Bold,
  Italic,
  Heading2,
  List,
  ListTodo,
  Quote,
  Link,
  Code,
  SquareCode,
  Undo2,
  Redo2,
} from "lucide-react";

const external = Annotation.define<boolean>();
function wrap(view: EditorView, before: string, after: string, sample = "текст") {
  if (view.state.readOnly) return false;
  let { from, to } = view.state.selection.main;
  // Emphasis delimiters cannot open/close against whitespace. Leave the
  // selection's surrounding spaces and final newline outside the markers.
  if ((before === "*" || before === "**") && from !== to) {
    const text = view.state.sliceDoc(from, to);
    const leading = text.length - text.trimStart().length;
    const trailing = text.length - text.trimEnd().length;
    if (leading === text.length) return false;
    from += leading;
    to -= trailing;
  }
  const selected = view.state.sliceDoc(from, to) || sample;
  let unwrap =
    from >= before.length &&
    view.state.sliceDoc(from - before.length, from) === before &&
    view.state.sliceDoc(to, to + after.length) === after;
  if (unwrap && before === "*") {
    let left = from,
      right = to;
    while (left > 0 && view.state.sliceDoc(left - 1, left) === "*") left--;
    while (right < view.state.doc.length && view.state.sliceDoc(right, right + 1) === "*") right++;
    // Two surrounding stars are bold, not an existing italic delimiter.
    unwrap = (from - left) % 2 === 1 && (right - to) % 2 === 1;
  }
  const start = unwrap ? from - before.length : from;
  view.dispatch({
    changes: {
      from: start,
      to: unwrap ? to + after.length : to,
      insert: unwrap ? selected : before + selected + after,
    },
    selection: {
      anchor: unwrap ? start : start + before.length,
      head: (unwrap ? start : start + before.length) + selected.length,
    },
    annotations: isolateHistory.of("full"),
    userEvent: "input",
  });
  view.focus();
  return true;
}
function codeFence(view: EditorView) {
  const { from, to } = view.state.selection.main;
  const text = view.state.sliceDoc(from, to) || "код";
  let length = 3;
  for (const match of text.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1);
  const fence = "`".repeat(length);
  const before =
    (from > 0 && view.state.sliceDoc(from - 1, from) !== "\n" ? "\n" : "") + fence + "\n";
  const after =
    (text.endsWith("\n") ? "" : "\n") +
    fence +
    (to < view.state.doc.length && view.state.sliceDoc(to, to + 1) !== "\n" ? "\n" : "");
  return wrap(view, before, after, "код");
}
function inlineCode(view: EditorView) {
  const { from, to } = view.state.selection.main;
  const text = view.state.sliceDoc(from, to) || "код";
  if (text.includes("\n")) return codeFence(view);
  let length = 1;
  for (const match of text.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1);
  const fence = "`".repeat(length);
  // CommonMark strips one outer space when both edges contain spaces.
  // Padding also separates literal edge backticks from the delimiters.
  const padded =
    text.startsWith("`") ||
    text.endsWith("`") ||
    (text.startsWith(" ") && text.endsWith(" ") && !/^ +$/.test(text));
  const pad = padded ? " " : "";
  return wrap(view, fence + pad, pad + fence, "код");
}
function prefix(view: EditorView, marker: string) {
  if (view.state.readOnly) return false;
  const selection = view.state.selection.main;
  const from = view.state.doc.lineAt(selection.from).from;
  const to = view.state.doc.lineAt(
    selection.to > selection.from ? selection.to - 1 : selection.to,
  ).to;
  const lines = view.state.sliceDoc(from, to).split("\n");
  const style =
    marker === "## "
      ? /^#{1,6}\s+/
      : marker.startsWith("- ")
        ? /^(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/
        : undefined;
  const remove = lines.every((line) =>
    marker === "- "
      ? /^- (?!\[[ xX]\]\s)/.test(line)
      : marker === "- [ ] "
        ? /^- \[[ xX]\]\s/.test(line)
        : line.startsWith(marker),
  );
  const text = lines
    .map((line) => {
      const plain = style ? line.replace(style, "") : remove ? line.slice(marker.length) : line;
      return remove ? plain : marker + plain;
    })
    .join("\n");
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from, head: from + text.length },
    annotations: isolateHistory.of("full"),
    userEvent: "input",
  });
  view.focus();
  return true;
}
const theme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--surface)",
    color: "var(--text)",
    fontSize: "15px",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-content": {
    fontFamily: '"Cascadia Code", Consolas, monospace',
    lineHeight: "1.8",
    padding: "12px 0",
    caretColor: "var(--text-strong)",
  },
  ".cm-scroller": { overflow: "auto" },
  ".cm-gutters": { backgroundColor: "var(--surface)", color: "var(--text-muted)", border: "none" },
  ".cm-activeLineGutter, .cm-activeLine": { backgroundColor: "var(--surface-soft)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "var(--selection)",
  },
  ".cm-cursor": { borderLeftColor: "var(--text-strong)" },
  ".cm-panels": { backgroundColor: "var(--surface-soft)", color: "var(--text)" },
  ".cm-searchMatch": { backgroundColor: "var(--warning-bg)", outline: "1px solid var(--warning)" },
  ".cm-placeholder": { color: "var(--text-muted)" },
});
const highlighting = HighlightStyle.define([
  { tag: tags.heading, color: "var(--accent-text)", fontWeight: "bold" },
  { tag: tags.strong, fontWeight: "bold", color: "var(--text-strong)" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.link, color: "var(--accent-text)", textDecoration: "underline" },
  { tag: tags.url, color: "var(--accent-soft)" },
  { tag: tags.monospace, color: "var(--success)" },
  { tag: tags.processingInstruction, color: "var(--text-muted)" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
]);

export function MarkdownEditor({
  value,
  onChange,
  disabled = false,
  onSave,
}: {
  value: string;
  onChange: (text: string) => void;
  disabled?: boolean;
  onSave: () => void;
}) {
  const parent = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | null>(null),
    readonly = useRef(new Compartment());
  const change = useRef(onChange),
    save = useRef(onSave);
  change.current = onChange;
  save.current = onSave;
  useEffect(() => {
    const instance = new EditorView({
      parent: parent.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          keymap.of([
            { key: "Mod-b", run: (v) => wrap(v, "**", "**") },
            { key: "Mod-i", run: (v) => wrap(v, "*", "*") },
            { key: "Mod-k", run: (v) => wrap(v, "[", "](https://example.com)", "ссылка") },
            {
              key: "Mod-s",
              run: () => {
                save.current();
                return true;
              },
            },
          ]),
          basicSetup,
          markdown({ base: markdownLanguage, completeHTMLTags: false }),
          theme,
          syntaxHighlighting(highlighting),
          EditorView.lineWrapping,
          placeholder("Начните писать Markdown или запишите мысль голосом…"),
          EditorView.contentAttributes.of({
            "aria-label": "Текст заметки",
            "aria-multiline": "true",
          }),
          readonly.current.of([
            EditorState.readOnly.of(disabled),
            EditorView.editable.of(!disabled),
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !update.transactions.every((tr) => tr.annotation(external))) {
              change.current(update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    view.current = instance;
    return () => {
      instance.destroy();
      view.current = null;
    };
    // The view lives for one note. Prop changes are applied below as transactions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const old = v.state.doc.toString();
    if (old === value) return;
    let from = 0;
    while (from < old.length && from < value.length && old[from] === value[from]) from++;
    let end = old.length,
      nextEnd = value.length;
    while (end > from && nextEnd > from && old[end - 1] === value[nextEnd - 1]) {
      end--;
      nextEnd--;
    }
    v.dispatch({
      changes: { from, to: end, insert: value.slice(from, nextEnd) },
      annotations: [external.of(true), isolateHistory.of("full")],
    });
  }, [value]);
  useEffect(() => {
    view.current?.dispatch({
      effects: readonly.current.reconfigure([
        EditorState.readOnly.of(disabled),
        EditorView.editable.of(!disabled),
      ]),
    });
  }, [disabled]);
  const buttons = [
    { label: "Заголовок", Icon: Heading2, run: (v: EditorView) => prefix(v, "## ") },
    { label: "Жирный", Icon: Bold, run: (v: EditorView) => wrap(v, "**", "**") },
    { label: "Курсив", Icon: Italic, run: (v: EditorView) => wrap(v, "*", "*") },
    { label: "Список", Icon: List, run: (v: EditorView) => prefix(v, "- ") },
    { label: "Чек-лист", Icon: ListTodo, run: (v: EditorView) => prefix(v, "- [ ] ") },
    { label: "Цитата", Icon: Quote, run: (v: EditorView) => prefix(v, "> ") },
    {
      label: "Ссылка",
      Icon: Link,
      run: (v: EditorView) => wrap(v, "[", "](https://example.com)", "ссылка"),
    },
    { label: "Код", Icon: Code, run: inlineCode },
    {
      label: "Блок кода",
      Icon: SquareCode,
      run: codeFence,
    },
    { label: "Отменить", Icon: Undo2, run: undo },
    { label: "Повторить", Icon: Redo2, run: redo },
  ];
  return (
    <div className="markdown-editor">
      <div className="markdown-toolbar" role="toolbar" aria-label="Форматирование Markdown">
        {buttons.map(({ label, Icon, run }) => (
          <button
            key={label}
            type="button"
            className="icon-button small"
            aria-label={label}
            title={label}
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (view.current && !view.current.state.readOnly) {
                run(view.current);
                view.current.focus();
              }
            }}
          >
            <Icon size={17} />
          </button>
        ))}
      </div>
      <div className="markdown-source" ref={parent} />
    </div>
  );
}
