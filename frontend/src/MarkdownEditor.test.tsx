import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import { describe, it, expect, vi } from "vite-plus/test";
import { MarkdownEditor } from "./MarkdownEditor";
import { MarkdownNote } from "./MarkdownNote";

function editor() {
  return EditorView.findFromDOM(screen.getByRole("textbox", { name: "Текст заметки" }))!;
}
describe("Markdown source editor", () => {
  for (const [value, button, want, tag, content] of [
    ["hello\n", "Жирный", "**hello**\n", "strong", "hello"],
    [" hello ", "Курсив", " *hello* ", "em", "hello"],
    ["a`b", "Код", "``a`b``", "code", "a`b"],
    ["`code`", "Код", "`` `code` ``", "code", "`code`"],
    [" spaced ", "Код", "`  spaced  `", "code", " spaced "],
    ["```js\nx\n```", "Блок кода", "````\n```js\nx\n```\n````", "code", "```js\nx\n```\n"],
  ]) {
    it(`preserves rendered meaning with ${button}: ${JSON.stringify(value)}`, async () => {
      const u = userEvent.setup();
      render(<MarkdownEditor value={value} onChange={() => {}} onSave={() => {}} />);
      const v = editor();
      act(() => v.dispatch({ selection: { anchor: 0, head: v.state.doc.length } }));
      await u.click(screen.getByRole("button", { name: button }));
      expect(v.state.doc.toString()).toBe(want);
      render(<MarkdownNote text={v.state.doc.toString()} />);
      expect(screen.getByLabelText("Просмотр заметки").querySelector(tag)?.textContent).toBe(
        content,
      );
    });
  }
  it("adds italic inside bold instead of removing one of its asterisks", async () => {
    const u = userEvent.setup();
    render(<MarkdownEditor value="**слово**" onChange={() => {}} onSave={() => {}} />);
    const v = editor();
    act(() => v.dispatch({ selection: { anchor: 2, head: 7 } }));
    await u.click(screen.getByRole("button", { name: "Курсив" }));
    expect(v.state.doc.toString()).toBe("***слово***");
    await u.click(screen.getByRole("button", { name: "Курсив" }));
    expect(v.state.doc.toString()).toBe("**слово**");
  });
  for (const [value, button, want] of [
    ["# Тема", "Заголовок", "## Тема"],
    ["- пункт", "Чек-лист", "- [ ] пункт"],
    ["- [x] готово", "Список", "- готово"],
  ]) {
    it(`converts existing markup with ${button}`, async () => {
      const u = userEvent.setup();
      render(<MarkdownEditor value={value} onChange={() => {}} onSave={() => {}} />);
      await u.click(screen.getByRole("button", { name: button }));
      expect(editor().state.doc.toString()).toBe(want);
    });
  }
  it("formats a selection through the toolbar and keeps it undoable", async () => {
    function Harness() {
      const [value, setValue] = useState("слово");
      return <MarkdownEditor value={value} onChange={setValue} onSave={() => {}} />;
    }
    const u = userEvent.setup();
    render(<Harness />);
    const view = editor();
    act(() => view.dispatch({ selection: { anchor: 0, head: 5 } }));
    await u.click(screen.getByRole("button", { name: "Жирный" }));
    expect(view.state.doc.toString()).toBe("**слово**");
    act(() => {
      undo(view);
    });
    expect(view.state.doc.toString()).toBe("слово");
  });
  it("updates external text without an onChange loop or replacing the editor view", () => {
    const onChange = vi.fn();
    const { rerender } = render(<MarkdownEditor value="a" onChange={onChange} onSave={() => {}} />);
    const view = editor();
    rerender(
      <MarkdownEditor value={"a\n\nГолосовая вставка"} onChange={onChange} onSave={() => {}} />,
    );
    expect(editor()).toBe(view);
    expect(view.state.doc.toString()).toBe("a\n\nГолосовая вставка");
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      undo(view);
    });
    expect(view.state.doc.toString()).toBe("a");
  });
  it("blocks toolbar changes while the application is busy", async () => {
    const onChange = vi.fn(),
      u = userEvent.setup();
    render(<MarkdownEditor value="текст" onChange={onChange} disabled onSave={() => {}} />);
    expect(screen.getByRole("button", { name: "Жирный" })).toBeDisabled();
    expect(editor().state.readOnly).toBe(true);
    await u.click(screen.getByRole("button", { name: "Жирный" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
