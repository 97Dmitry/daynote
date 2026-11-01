# Recurring Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Повторяющиеся задачи с независимым выполнением и исключениями отдельных дней.

**Architecture:** Go хранит правила и исключения внутри Task и вычисляет экземпляры по диапазону. Один механизм обслуживает календарь и reminders. Renderer редактирует серии или конкретный экземпляр, не создавая собственных правил повторения.

**Tech Stack:** Go, SQLite, Wails v2, React/TypeScript, FullCalendar v7, Vite+.

**Spec:** `docs/superpowers/specs/2026-11-02-recurring-tasks-design.md` (согласован пользователем).

## Global Constraints

- SQLite/backup version 3, чтение backup v1/v2; неизвестные версии отклоняются.
- Только текущий checkout; без коммитов, push, PR и прямого изменения пользовательских данных.
- Никаких новых библиотек расписаний; timezone data встроены через `time/tzdata`.
- Календарный диапазон не больше 366 дней; Go владеет валидацией и вычислением.
- Reminder catch-up 24 часа; receipts фиксируются до shell delivery и не входят в backup.
- Сгенерированные Wails bindings только через `make bindings`.

## Review Focus

- Перенесённый экземпляр с исходной датой вне периода должен попадать в календарь и reminder window — Task 1/2.
- Весенний пропуск и осенняя неоднозначность DST не должны давать разные даты в календаре и reminders — Task 1/2.
- Изменение серии не должно незаметно потерять исключения или вернуть старые receipts — Task 2/3.
- Устаревшие ответы API после переключения периода не должны замещать актуальный календарь — Task 3.
- Сбой сохранения и переход из inbox не должны терять черновик или открывать другой день — Task 3.

## Task 1: Правило и вычисление экземпляров

**Files:** `internal/store/recurrence.go`, `internal/store/recurrence_test.go`, `internal/store/model.go`.

**Interfaces:** `Recurrence{Weekdays []int, TimeZone string, Until string}` (ISO weekday 1–7), `TaskException{Date string, Done bool, Skipped bool, Start string, End string}`; `Occurrence{ID, TaskID, Date, Start, End string; Done bool}`. `Task` получает `Recurrence *Recurrence` и `Exceptions []TaskException`. `expandTask(Task, from, to time.Time) ([]Occurrence, error)` и `occurrenceOn(Task,date string) (Occurrence,bool)` используют общую календарную арифметику.

- [x] Написать таблицы тестов: каждый день/будни/выходные/выбранные дни, включительные границы серии, смена года/leap day, длительность через полночь; DST gap пропускается, fold использует первый момент; выполненный/удалённый/перенесённый день, включая перенос извне периода; неправильные правила/исключения отклоняются.
- [x] Запустить `go test ./internal/store -run 'TestRecurrence|TestOccurrence'`; увидеть отсутствие новых типов/поведения.
- [x] Реализовать чистые вычисления и `validateRecurrence(Task) error`, встроить в общую валидацию. Не разворачивать историю от начала серии; проверить исключения отдельно от обычного диапазона.
- [x] Повторить тесты; ожидание PASS.

## Task 2: Хранение, API и фоновые напоминания

**Files:** `internal/store/{store.go,backup.go,notifications.go,occurrences.go,recurrence_store_test.go,reminders_test.go}`, `app.go`.

**Interfaces:** `Store.Occurrences(from,to string) ([]Occurrence,error)`, `Store.Occurrence(taskID,date string) (Occurrence,error)`, `Store.SaveException(taskID string, ex TaskException) error`, `Store.ResetException(taskID,date string) error`. `SaveTaskWithConfirmation(Task, discardExceptions bool)` обеспечивает подтверждение очистки; существующий `SaveTask` делегирует с false. App экспортирует соответствующие методы, после изменений вызывает `changed()`. `Notification.OccurrenceDate string` для перехода из inbox. Task 1 предоставляет все вычисления.

- [x] Написать проверки миграции v2 с receipts, независимости slices и recurrence pointer, reopen, backup/restore v1/v2/v3, future-version rejection; выполнение/перенос/удаление/сброс; подтверждение удаления исключений при изменении правила.
- [x] Написать reminder-тесты: независимые даты/done/skipped, перенос извне окна, абсолютный календарный reminder, большие offsets, DST, restart dedupe, старые одноразовые receipts не повторяются.
- [x] Запустить `go test ./internal/store`; ожидать FAIL нового контракта.
- [x] Реализовать миграцию и deep clone; явную очистку исключений только с подтверждением; API проверяет принадлежность даты серии. Добавить общий расчёт due экземпляра и обратный диапазон по каждому reminder, отдельную проверку переносов; сохранить старый hash для разовых задач.
- [x] Запустить `go test -race ./internal/store ./internal/reminders`; ожидание PASS. Сгенерировать `make bindings` после App API.

## Task 3: Формы, календарь и inbox

**Files:** `frontend/src/{types.ts,api.ts,Calendar.tsx,RecurrenceEditor.tsx,OccurrenceDialog.tsx,App.tsx,Notifications.tsx,styles.css}`, `frontend/src/{Recurrence.integration.test.tsx,Reminders.integration.test.tsx,App.test.tsx}`, `frontend/e2e/desktop.spec.ts`.

**Interfaces:** `api.occurrences(from,to)`, `api.occurrence(taskID,date)`, `api.saveException(taskID,ex)`, `api.resetException(taskID,date)`, `api.saveTaskWithConfirmation(task,discard)`; TS типы соответствуют Go. Inbox передаёт `occurrenceDate` вместе с `taskId`. FullCalendar event ID — Occurrence.ID, связь с серией через extendedProps.

- [x] Написать UI-тесты создания пресетов/выбранных дней/until; отдельной карточки дня, сохранения выполнения/переноса/удаления; изменения серии с подтверждением, сбоя сохранения, позднего API-ответа; перехода из inbox на правильный экземпляр и сообщения об удалённом.
- [x] Запустить `cd frontend && vp test run`; ожидание FAIL нового поведения.
- [x] Реализовать RecurrenceEditor и OccurrenceDialog в существующем визуальном стиле. Сохранить существующую форму разовых задач; редактор серии показывает общий охват и исключения. Календарь загружает только активный диапазон, защищается generation counter/cleanup. Drag/resize серии вызывает saveException.
- [x] Обновить fake Wails bridge browser tests точным новым контрактом; добавить browser-сценарий создания серии/работы с экземпляром.
- [x] Запустить React и browser tests; ожидание PASS. Проверить typecheck и формат.

## Task 4: Документация, интеграция и review

**Files:** `README.md`, `AGENTS.md`, `internal/store/AGENTS.md`, `frontend/AGENTS.md`, документы плана/дизайна.

**Interfaces:** Использует итоговые контракты Tasks 1–3 без новых API.

- [x] Обновить пользовательское описание и значимые локальные инварианты: version 3, календарный timezone, исключения, единый расчёт Go. Пометить дизайн согласованным.
- [x] Запустить `make check` и `cd frontend && vp exec playwright test`; ожидание все проверки PASS. Проверить `git diff --check` и diff scope.
- [x] Запросить независимый code review полного рабочего diff по spec/plan; исправить существенные находки с регрессионными проверками.
- [x] Отметить выполненные пункты и сообщить результат; Windows runtime-приёмку явно отделить от automated tests/build.

## Решения при исполнении

План исполняется inline в текущем сеансе: пользователь согласовал поведение и реализацию. Повторное согласование внутреннего способа исполнения не требуется. Коммиты не создаются; review охватывает незакоммиченные изменения.
