# Changelog

## 0.1.0 — 2026-11-06

Первый релиз.

- MCP-сервер (Streamable HTTP, stateless) внутри VS Code, привязка к 127.0.0.1.
- Безопасность: валидация Origin (только loopback), Host-проверка против DNS-rebinding,
  опциональный bearer-токен, отказ в CORS-preflight браузерам.
- Категории тулз (file / edit / analysis / refactor / command), настраиваются в settings.
- Файловые операции через WorkspaceEdit: move_file с автообновлением импортов.
- LSP-тулзы: rename_symbol, organize_imports, format_document.
- Анализ: diagnostics, symbols, references, definition, hover, text/file search.
