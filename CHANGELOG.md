# Changelog

## 0.1.2 — 2026-11-06

Закрытие этапа «надёжный рефакторинг-цикл» (T-1…T-3 в репе планирования):

- `get_code_actions` / `apply_code_action`: quickfix'ы и структурные рефакторы VS Code (extract/inline/move) через мост; применение — по title из списка.
- `call_hierarchy` (incoming/outgoing) и `type_hierarchy` (supertypes/subtypes): blast radius до правки.
- Журнал мутаций: снапшоты «как было» перед каждой мутацией + `undo_last_bridge_edit` (обратный move_file снова обновляет импорты; большие файлы >5 МБ — без снапшота, честно сообщается).
- `git_diff` (vs HEAD/ref, фильтр по пути) и `edit_journal` (аудит-список мутаций; полный JSONL — в globalStorage).
- Тулз теперь 28.

## 0.1.1 — 2026-11-06

- Сборка переведена с npm на pnpm (lockfile `pnpm-lock.yaml`, `packageManager` pin, CI на pnpm/action-setup).

## 0.1.0 — 2026-11-06

Первый релиз.

- MCP-сервер (Streamable HTTP, stateless) внутри VS Code, привязка к 127.0.0.1.
- Безопасность: валидация Origin (только loopback), Host-проверка против DNS-rebinding,
  опциональный bearer-токен, отказ в CORS-preflight браузерам.
- Категории тулз (file / edit / analysis / refactor / command), настраиваются в settings.
- Файловые операции через WorkspaceEdit: move_file с автообновлением импортов.
- LSP-тулзы: rename_symbol, organize_imports, format_document.
- Анализ: diagnostics, symbols, references, definition, hover, text/file search.
