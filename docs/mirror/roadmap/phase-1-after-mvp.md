# Roadmap — Phase 1: after-MVP

> **Status:** IN PROGRESS · **Updated:** 2026-11-06 · English mirror of the Russian canonical

**In short:** from "a working bridge with 21 tools" to an instrument with which an agent runs a
mass refactor end-to-end and verifies itself.

**Goal:** the agent performs the chain "scope the radius → move/rename → verify (diagnostics +
diff + tests) → revert on failure" without human hand-holding; the bridge is observable (mutation
journal, status tooling) and does not degrade on a second window / multi-root workspaces.

Phase boundaries:
- Accepted as sufficient (0.1.x): file/edit/analysis/refactor tools, security gates, per-request server, pnpm/CI build.
- Deliberately postponed: shell tool (decision — open question), marketplace publishing (Phase 2), non-VS Code forks support.

## Stages

### 1.1 — The reliable refactoring loop

- [x] `get_code_actions` + `apply_code_action`: VS Code quickfixes and structural refactors (extract/inline/move) over the bridge — 0.1.2, T-1
- [x] `call_hierarchy` / `type_hierarchy`: who calls the symbol (blast radius before edits) — 0.1.2, T-2
- [x] Revert: `git_diff` (via the vscode.git API) + `undo_last_bridge_edit` (snapshots, ADR-001) — 0.1.2, T-3
- [ ] Tests in the loop: run the test controller / VS Code tasks, report red/green to the agent (deferred — `deferred` tag on T-4)

### 1.2 — Observability and safety

- [ ] Bridge mutation audit trail (JSONL: who/what/when/how to revert)
- [ ] `bridge_status`: a self-diagnostics tool for agents (port, owner window, categories, workspace trust)
- [ ] Tool-level allowlist on top of categories (a setting)

### 1.3 — Scale

- [ ] Multi-window: a discovery protocol (window→port registry) or a dynamic port — pending the open question
- [ ] Multi-root workspaces: root-qualified paths in every tool
- [ ] `search_text` on the built-in search (ripgrep/`findTextInFiles` when available) with fallback to the scan

### 1.4 — Distribution

- [ ] Release CI: tag → vsix build → GitHub Releases (public repo)
- [ ] The marketplace decision (open question) → if yes: publisher, listing, screenshots

## Done-when criteria

1. The key scenario "90 files / 500 import sites" is run by the agent end-to-end: `find_references` → `move_file`×N → `get_diagnostics` → `git_diff` → tests green; the human only reviews the result.
2. A failed step is reverted by the agent with one tool (not by hand through git).
3. A second open VS Code window does not break the first window's bridge; a multi-root project is addressed unambiguously.
4. Every bridge mutation leaves a record readable by an agent without devst.

## Deliberate non-goals of the phase

- Shell execution through the bridge (agents have their own shell; the attack surface is not justified — revisit on request)
- A management GUI for the bridge (the status bar is enough)
- Support for non-VS Code editors
