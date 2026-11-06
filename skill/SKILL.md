---
name: vscode-mcp-bridge
description: Use VS Code itself as the coding toolset over MCP (server vscode-bridge, 28 tools, loopback http://127.0.0.1:3101/mcp) — IDE-grade rename_symbol, import-updating move_file, code actions (quickfix/extract/inline/move), call & type hierarchies, diagnostics, git_diff and undo of bridge mutations. Trigger for mass refactors, quickfixes, blast-radius checks and any precise code surgery in a project open in VS Code — instead of regex/sed editing. / Использовать при массовых рефакторингах и точных правках через IDE: переименование символов, переезды файлов с автообновлением импортов, code actions, иерархии вызовов/типов, диагностика, откат мутаций. VS Code должен быть открыт с проектом.
---

# VS Code MCP Bridge — agent skill

VS Code runs a local MCP server inside the IDE: **streamable HTTP, stateless, loopback only** —
`http://127.0.0.1:3101/mcp`. In zcode it is registered as server `vscode-bridge`, so tools appear
as `mcp__vscode-bridge__*`. The server lives in the VS Code **window that owns the port**: it acts
on the workspace open in that window.

## Preconditions (check before first tool call)

- VS Code must be **running with the project open**. No tools in your session → the server is
  down: open VS Code with the project, then restart the agent session (Settings → MCP shows
  `vscode-bridge` as failed until the server is up).
- One VS Code window owns the port; a second window cannot serve. Status bar shows `MCP:<port>`.
- Tool categories (settings `vscode-mcp-bridge.enabledTools`): `file`, `edit`, `analysis`,
  `refactor` are on by default; `command` (arbitrary VS Code commands) is off.

## Tool inventory (28)

| Goal | Tools |
|---|---|
| Scope the blast radius | `find_references`, `call_hierarchy` *(incoming = callers / outgoing = callees)*, `type_hierarchy`, `search_symbols`, `document_symbols`, `get_hover` |
| Refactor | `move_file` *(WorkspaceEdit — imports auto-update)*, `rename_symbol`, `organize_imports`, `format_document`, `get_code_actions` → `apply_code_action` |
| Verify | `get_diagnostics` *(file or workspace)*, `git_diff` *(vs HEAD/ref, path filter)* |
| Safety net | `undo_last_bridge_edit` *(reverts the last bridge mutation)*, `edit_journal` *(audit trail)* |
| Files | `read_file`, `write_file`, `create_file`, `replace_in_file`, `copy_file`, `delete_file`, `list_files`, `search_text`, `search_files`, `open_file`, `server_info` |

## The refactor loop — use this instead of sed/regex surgery

1. **Scope**: `find_references` / `call_hierarchy` / `search_symbols` — know the radius first.
2. **Mutate**, one step at a time: `move_file`, `rename_symbol`, or `get_code_actions` →
   `apply_code_action` (pass the exact title from the listing).
3. **Verify**: `get_diagnostics` on touched files — red flags surface inside VS Code, not in CI.
4. **Review & revert**: `git_diff` shows exactly what changed; a bad step reverts with
   `undo_last_bridge_edit` — call it immediately, before anyone edits files manually
   (the journal restores the pre-edit snapshot; on move-back the IDE re-updates imports again).
5. **Finish**: `organize_imports` + `format_document`.

## Gotchas

- All line/column arguments are **0-based** (LSP convention).
- `replace_in_file` fails unless `old_text` occurrence count equals `expect` (default 1) —
  that is the guard against wrong-place edits; refine `old_text` instead of raising `expect`.
- Files > 5 MB are not snapshotted — `undo_last_bridge_edit` reports them as unrestored.
- Mutating tools record an audit trail (`edit_journal`; full JSONL in extension storage).
- Security: server binds to 127.0.0.1 with Host/Origin validation. Do not port-forward 3101;
  do not enable the `command` category without a reason.
- After upgrading the extension (.vsix), a **full VS Code restart** is required to activate it
  (extension-host restart and reinstall cycles keep serving the stale version).
