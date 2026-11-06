# 01 — Bridge architecture overview

> **Status:** actual · **Updated:** 2026-11-06 (session 02) · English mirror of the Russian canonical

**In short:** how vscode-mcp-bridge is built — modules, invariants, request flow. Open this when
changing extension code or investigating bridge behavior in the field.

**Key facts:**
- One server, one port: 127.0.0.1:3101 (fixed; a second VS Code window cannot serve — the port is taken).
- Per-request stateless: every POST gets its own McpServer+transport; `enableJsonResponse: true` — replies are plain JSON. A shared transport is broken in SDK 1.32.x (requests after the first hang or return 500).
- Security: bind to 127.0.0.1 + Host validation (DNS rebinding) + Origin validation (browsers/`null` → 403) + optional bearer token; the `command` category is off by default.
- The MCP `serverInfo` version is injected at build time from package.json (esbuild `define`, `__EXT_VERSION__`).
- Build: pnpm; vsix via `pnpm run package` (= `vsce package --no-dependencies`, the bundle is self-contained).

**Related:** code canon `src/` · roadmap [../roadmap/phase-1-after-mvp.md](../roadmap/phase-1-after-mvp.md)

## How it works now

Request flow: agent → `POST http://127.0.0.1:3101/mcp` → security gates → per-request McpServer
(tools registered per enabled categories) → tool → vscode-API → JSON response.

| Module (`src/`) | Role |
|---|---|
| `extension.ts` | activation, lifecycle, restart on config change; `deactivate` closes the socket (otherwise an orphan keeps holding the port) |
| `server.ts` | node:http, security gates, 4 MB body limit, per-request dispatch |
| `security.ts` | pure Origin/Host/token validators (unit-tested) |
| `tools/index.ts` + `tools/*` | categories file/edit/analysis/refactor/command; the registry = `server.tool` calls |
| `tools/fileTools.ts` | `move_file` via `WorkspaceEdit.renameFile` — the IDE updates imports |
| `tools/refactorTools.ts` | `rename_symbol` (`vscode.executeDocumentRenameProvider`), organize_imports, format_document, code actions |
| `tools/analysisTools.ts` | diagnostics, symbols, references/definition/hover, call/type hierarchies, search (manual scan; `findTextInFiles` is a proposed API) |
| `tools/safetyTools.ts` | `git_diff`, `edit_journal`, `undo_last_bridge_edit` |
| `journal.ts` | pre-mutation snapshots + undo + JSONL audit (ADR-001) |
| `paths.ts` | absolute and workspace-relative paths; first workspace folder |

Invariants (do not break):
- loopback only, never expose the port;
- no child_process for mutations inside VS Code — everything through vscode-API;
- `deactivate()`/subscriptions must close the httpServer (the EADDRINUSE incident of 0.1.0).

## Key decisions

- [ADR-001](../decisions/adr-001-mutation-journal-and-snapshot-undo.md) — mutations are snapshotted before the change; `undo_last_bridge_edit` restores; audit in JSONL

## TODO / where this is heading

- [x] ~~ADR-001: mutation journal and undo~~ — done (ADR-001)
- [ ] ADR-002: document the per-request pattern + JSON mode retroactively (reason: SDK 1.32.x regression)
- [ ] ADR-003: multi-window model (discovery vs fixed port) — pending question T-12
