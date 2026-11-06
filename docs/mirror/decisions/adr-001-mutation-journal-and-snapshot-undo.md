# ADR-001: Mutation journal and snapshot-based undo

> **Status:** accepted · **Date:** 2026-11-06 · English mirror of the Russian canonical

**In short:** every bridge mutation snapshots affected files first; `undo_last_bridge_edit` restores the pre-edit state; the audit trail is JSONL in extension storage.

**Rejected:** git stash/checkout (invasive to the user's git) and inverse WorkspaceEdit computation (fragile for multi-edits).

**Related:** T-3 · T-5 · `src/journal.ts` · roadmap Phase 1.1

## Context

The mutating tools of the bridge (move/copy/delete/create/write/replace/rename_symbol/organize/format/code_action) change the agent's working tree directly. Before 0.1.2 a failed step could only be reverted by the agent manually via git (`git checkout`) — with a dirty index or a stash this is dangerous, and "snapshot before edit" was not something the agent could do: the loop *edit → verify → revert* was broken (task T-3). Some mutations (rename_symbol, organize_imports) touch files that are known only after the provider returns the WorkspaceEdit.

## Options

### A. Git mechanics (stash / checkout / a temp commit)

- Pros: nothing to store, git reverts natively.
- Cons: invasive — touches the user's index/stash; conflicts with the user's parallel work; the repo may be dirty or absent.

### B. Inverse edit computation (inverting the WorkspaceEdit)

- Pros: point edits, no content stored.
- Cons: inverting multi-edits of one file requires coordinate transformation — easy to get wrong; rename_symbol returns edits with "after" positions, so rebuilding the inverse is non-trivial.

### C. "How it was" snapshots + whole-file restore (chosen)

- Pros: trivially exact (restore by bytes); move_file reverts via an inverse renameFile — the IDE **re-updates** imports on the way back; snapshots double as the audit trail.
- Cons: memory for content (5 MB/file limit — larger files get no snapshot and say so honestly); the journal lives in the window's memory — a window restart clears the undo stack (the JSONL audit survives).

## Decision

**Option C.** `src/journal.ts`: before a mutation the tool snapshots the affected files (for rename_symbol/code_action — from `edit.entries()` **before** applying); `commit(tool, summary, {snapshots, inverseMoves})` appends an entry to the journal and a JSONL audit record in `globalStorage/journal.jsonl` (without file contents). `undo_last_bridge_edit` reverts the last open mutation: inverse moves → restore/delete files. `git_diff` and `edit_journal` give the agent "what changed / what can be reverted".

## Rationale

- Whole-file restore excludes inversion mistakes; the undo code is linear and testable.
- The inverse `renameFile` re-uses the bridge's strongest asset (the IDE updates imports both ways).
- Rule for future mutations (invariant): a new mutating tool must call `journal.snapshot(...)` before and `journal.commit(...)` after — otherwise it has no undo.

## Consequences

**Positive:**
- The loop *edit → diagnostics → revert* is closed inside the bridge (T-3 also delivers most of T-5 — the audit journal came for free).

**Negative / risks:**
- Files >5 MB get no snapshot (the undo output lists them honestly).
- Empty folders are not restored on undo of a deletion (only files are).
- The undo stack is per-window; human edits between a mutation and its undo will be overwritten by the snapshot restore — agents must call undo right after their own bad step (the agent skill fixes this contract).
