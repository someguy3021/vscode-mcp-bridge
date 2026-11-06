# VS Code MCP Bridge

Turns a running VS Code instance into a local [Model Context Protocol](https://modelcontextprotocol.io) (MCP) **server**, so any external AI agent — CLI coders, orchestrators, your own tooling — can use the IDE's *real* refactoring intelligence instead of regex surgery on files.

**Why:** shell-driven mass refactors (moving 90 files / ~500 import sites with `sed`/`grep`) fail in cascading, hard-to-reverse ways. VS Code's language providers do this correctly and atomically. This extension exposes exactly that ability over MCP: file moves that update imports, LSP symbol rename, organize-imports, diagnostics, and workspace search — in **one server**, on **one loopback port**.

Inspired by and crediting [juehang/vscode-mcp-server](https://github.com/juehang/vscode-mcp-server) (WorkspaceEdit file ops, tool categories) and [CodingWithCalvin/VSC-MCPServer](https://github.com/CodingWithCalvin/VSC-MCPServer) (LSP tools, Origin/DNS-rebinding protection). This extension combines both feature sets with a hardened request pipeline, a stateless transport, and no express dependency.

## Tools

| Category (default) | Tools |
|---|---|
| `file` (on) | `list_files`, `read_file`, `create_file`, `move_file` *(WorkspaceEdit — imports updated by the IDE)*, `copy_file`, `delete_file`, `open_file` |
| `edit` (on) | `write_file`, `replace_in_file` *(exact-match, refuses ambiguous replaces)*, `undo_last_bridge_edit` *(snapshot-based undo of any bridge mutation)* |
| `analysis` (on) | `get_diagnostics`, `search_symbols`, `document_symbols`, `go_to_definition`, `find_references`, `call_hierarchy`, `type_hierarchy`, `get_hover`, `search_text`, `search_files`, `git_diff`, `edit_journal`, `server_info` |
| `refactor` (on) | `rename_symbol` *(LSP rename across the project)*, `organize_imports`, `format_document`, `get_code_actions`, `apply_code_action` |
| `command` (**off**) | `execute_command` — arbitrary VS Code commands; effectively RCE into your IDE, enable deliberately |

The typical agent workflow for a big move/rename:

1. `find_references` / `call_hierarchy` / `search_symbols` — scope the blast radius.
2. `move_file` per path (IDE rewrites imports), or `rename_symbol` per identifier; `get_code_actions` + `apply_code_action` for quickfixes and structural refactors.
3. `get_diagnostics` after every step — red flags surface *inside* VS Code, not in CI.
4. `git_diff` to review exactly what changed; a bad step reverts with `undo_last_bridge_edit`.
5. `organize_imports` + `format_document` as the finishing pass.

Every mutating tool snapshots affected files before the change (audit trail: `edit_journal` + `journal.jsonl` in extension storage).

## Security model

The server binds to `127.0.0.1` only and applies three independent checks to every request:

- **Host validation** — `Host` must be `127.0.0.1:<port>` / `localhost:<port>` / `[::1]:<port>`; blocks [DNS rebinding](https://en.wikipedia.org/wiki/DNS_rebinding).
- **Origin validation** — browser-originated requests must present a loopback `Origin` (`http://localhost:*`, `http://127.0.0.1:*`, `http://[::1]:*`); non-browser clients (MCP clients, `curl`) send no `Origin` and are allowed; `Origin: null` and anything off-loopback are rejected with `403`. CORS preflight is never answered, so browser pages cannot read responses either.
- **Optional bearer token** — set `vscode-mcp-bridge.token` and clients must send `Authorization: Bearer <token>`.

Remaining honest caveats: there is no per-tool allowlist beyond categories, and any *local process* that spoofs loopback headers can call the API (true of every localhost MCP bridge without auth — use the token when that matters). One VS Code window owns the port; a second window will report `EADDRINUSE` and show an error state.

## Configuration

```jsonc
// VS Code settings.json
"vscode-mcp-bridge.port": 3101,
"vscode-mcp-bridge.autoStart": true,
"vscode-mcp-bridge.token": "",
"vscode-mcp-bridge.enabledTools": { "file": true, "edit": true, "analysis": true, "refactor": true, "command": false }
```

Recommended companion setting so file moves update imports without prompting:

```jsonc
"typescript.updateImportsOnFileMove.enabled": "always"
```

(Path may differ for Vue/Volar projects: `volar.updateImportsOnFileMove.enabled`.)

Status bar item `MCP:<port>` shows the server state; click toggles it. Changing any `vscode-mcp-bridge.*` setting restarts the server.

## Client setup

Point any MCP client at the streamable HTTP endpoint:

```json
{
  "mcp": {
    "servers": {
      "vscode-bridge": { "type": "http", "url": "http://127.0.0.1:3101/mcp", "timeoutMs": 60000 }
    }
  }
}
```

For clients that only speak stdio: `npx mcp-remote http://127.0.0.1:3101/mcp`.

The server is live only while VS Code is open with your project; start the agent session *after* opening VS Code.

## Agent skill

`skill/SKILL.md` teaches coding agents when and how to use the bridge (the refactor loop, tool inventory, gotchas). Install it into your harness's skill directory:

```bash
cp skill/SKILL.md ~/.agents/skills/vscode-mcp-bridge/SKILL.md   # zcode / Claude-style harnesses
```

The canonical copy lives in this repository — re-copy after upgrades.

## Requirements

- VS Code ≥ 1.99
- Node.js 22+ to build/package

## Development

```bash
pnpm install
pnpm typecheck      # tsc --noEmit, strict
pnpm test           # vitest (pure logic: security validators, text matching)
pnpm build          # esbuild bundle -> dist/extension.js
pnpm run package    # vsce package -> vscode-mcp-bridge-<ver>.vsix
```

Package manager is pinned via the `packageManager` field (pnpm ≥ 10; Corepack picks it up automatically). Install the produced `.vsix` via `code --install-extension <file>.vsix`. CI (`.github/workflows/build.yml`) runs typecheck → tests → build → package on every push and attaches the `.vsix` as an artifact.

## License

[MIT](./LICENSE)
