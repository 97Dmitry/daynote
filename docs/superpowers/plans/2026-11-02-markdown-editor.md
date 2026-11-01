# Markdown Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Заменить textarea редактором Markdown с панелью и форматированием при сохранении.

**Architecture:** CodeMirror 6 владеет editor view и undo, React владеет note draft. Общий асинхронный formatter перед SaveNote; raw autosave и explicit formatting имеют отдельные режимы одной существующей очереди.

**Tech Stack:** React, CodeMirror 6, Prettier standalone Markdown, Wails v2/Vite+.

**Spec:** `docs/superpowers/specs/2026-11-02-markdown-editor-design.md`.

## Global Constraints

- Вкладки «Редактор»/«Просмотр» остаются раздельными.
- Без HTML execution, raw audio, сети для заметок и изменения схемы БД.
- Черновик сохраняется при ошибке и не заменяется устаревшим результатом.
- pnpm-lock.yaml и Vite+ остаются владельцами зависимостей/проверок проекта.
- Текущий checkout, без коммитов/публикации.

## Review Focus

- Уже автосохранённый сырой текст форматируется при explicit save — Task 2.
- Ввод во время async format/save не теряется — Task 2.
- Форматирование не ломает code fences и ручные переносы — Task 1.
- Замена заметки не наследует чужой undo; сохранение текущей сохраняет undo — Task 1/2.
- Ошибки не закрывают заметку и не оставляют статус «Сохранено» — Task 2.

## Task 1: Editor и formatter

**Files:** `frontend/src/{MarkdownEditor.tsx,markdownFormat.ts,markdownFormat.test.ts,MarkdownEditor.test.tsx,styles.css}`, `frontend/package.json`, `frontend/pnpm-lock.yaml`.

**Interfaces:** `formatMarkdown(text:string):Promise<string>`; `MarkdownEditor({value,onChange,disabled,onSave})` с accessible textbox «Текст заметки». Formatter использует lazy standalone imports. Editor монтируется с key=note.id; внешние изменения применяются как транзакции, а не созданием новой view.

- [x] Написать и увидеть FAIL formatter-тестов: списки/заголовки, пустой текст, fences, переносы, идемпотентность.
- [x] Реализовать formatter и проверить PASS.
- [x] Написать и увидеть FAIL editor-тестов: toolbar меняет выделение, undo, external update без onChange loop, readOnly.
- [x] Реализовать CodeMirror wrapper с текущими цветовыми токенами; проверить PASS.

## Task 2: Интеграция сохранения и проверка

**Files:** `frontend/src/{App.tsx,api.ts,App.test.tsx,test-setup.ts}`, `frontend/e2e/desktop.spec.ts`, `README.md`, `frontend/AGENTS.md`.

**Interfaces:** `api.saveNote(note,format=true)` форматирует копию note; `flush(format=true)` форматирует explicit checkpoint даже при совпадении raw signature; debounce вызывает `flush(false)`. App fake API должен использовать настоящий formatter. Реальный CodeMirror в тестах управляется через документированные transactions.

- [x] Написать failing tests для already-autosaved explicit formatting, async typing и отказов сохранения.
- [x] Встроить editor, Ctrl+S и режимы очереди, сохранить вкладки и голосовую вставку.
- [x] Обновить browser тесты для contenteditable и добавить toolbar/save/preview/undo сценарий.
- [x] Проверить `vp test run`, browser light/dark, `make check`, `git diff --check`; осмотреть screenshots.
- [x] Провести независимое review Markdown diff, исправить существенные находки, обновить краткую документацию.
