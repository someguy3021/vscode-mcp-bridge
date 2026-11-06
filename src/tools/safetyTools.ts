import * as vscode from "vscode";
import { z } from "zod";
import { relPath, resolvePath } from "../paths";
import { filterDiffByPath, truncate } from "../pure";
import { errMsg, fail, ok, ToolCtx } from "./types";

type GitRepo = {
  rootUri: vscode.Uri;
  diffWithHEAD(): Thenable<string>;
  diffWith(ref: string): Thenable<string>;
};

/** Чтение для безопасности (git_diff, edit_journal) + откат (undo_last_bridge_edit). */
export function registerSafetyTools({ server, enabled, journal }: ToolCtx): void {
  if (enabled.analysis) {
    server.tool(
      "git_diff",
      "Working-tree diff vs HEAD (or a given ref) through the built-in git extension; optionally filtered to one path.",
      {
        path: z.string().optional().describe("Filter the diff to files under this path"),
        ref: z.string().optional().describe("Diff against this ref instead of HEAD (e.g. 'main')"),
        max_lines: z.number().int().positive().optional().describe("Output cap, default 400 lines"),
      },
      async ({ path: p, ref, max_lines }) => {
        try {
          const git = vscode.extensions.getExtension("vscode.git")?.exports?.getAPI?.(1) as
            | { repositories?: GitRepo[] }
            | undefined;
          const repos = git?.repositories ?? [];
          if (!repos.length) return fail("в workspace нет git-репозиториев (или git-расширение недоступно)");
          let repo = repos[0] as GitRepo;
          if (p) {
            const target = resolvePath(p).fsPath.toLowerCase();
            const found = repos.find((r) => {
              const root = r.rootUri.fsPath.toLowerCase();
              return target.startsWith(root + "\\") || target.startsWith(root + "/");
            });
            if (found) repo = found;
          }
          const raw = ref ? await repo.diffWith(ref) : await repo.diffWithHEAD();
          if (!raw) return ok("(диффа нет — рабочее дерево чисто)");
          const text = p ? filterDiffByPath(raw, p) : raw;
          if (!text) return ok("(по этому пути изменений нет)");
          return ok(truncate(text, max_lines ?? 400));
        } catch (e) {
          return fail(errMsg(e));
        }
      },
    );

    server.tool(
      "edit_journal",
      "Audit trail of recent bridge mutations (id, time, tool, summary) — read-only, without file contents.",
      {
        limit: z.number().int().positive().optional().describe("How many recent entries, default 10"),
      },
      async ({ limit }) => {
        const items = journal.list(limit ?? 10);
        if (!items.length) return ok("(журнал пуст)");
        const lines = items.map(
          (e) => `#${e.id}${e.undone ? " [откачено]" : ""} ${e.ts} ${e.tool}: ${e.summary}`,
        );
        return ok(lines.join("\n"));
      },
    );
  }

  if (enabled.edit) {
    server.tool(
      "undo_last_bridge_edit",
      "Undo the most recent bridge mutation (move/copy/delete/create/write/replace/rename_symbol/organize/format/code_action) via pre-edit snapshots; on move-back the IDE re-updates imports.",
      {},
      async () => {
        try {
          return ok(await journal.undoLast());
        } catch (e) {
          return fail(errMsg(e));
        }
      },
    );
  }
}
