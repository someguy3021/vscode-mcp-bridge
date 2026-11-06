import * as path from "node:path";
import * as vscode from "vscode";
import { z } from "zod";
import { DEFAULT_EXCLUDE, relPath, resolvePath } from "../paths";
import { errMsg, fail, ok, ToolCtx } from "./types";

/**
 * Файловые тулзы. Ключевая — move_file: переезд через WorkspaceEdit.renameFile,
 * поэтому language-extensions (TS/Volar/Python…) получают onDidRenameFile и
 * правят импорты/ссылки сами. Это то, чего не может bash-скрипт.
 * Все мутации предварительно снапшотятся в журнал — undo_last_bridge_edit откатит.
 */
export function registerFileTools({ server, enabled, journal }: ToolCtx): void {
  if (!enabled.file) return;

  server.tool(
    "list_files",
    "List workspace files (glob-based, standard junk dirs excluded).",
    {
      dir: z.string().optional().describe("Subdirectory to list (absolute or workspace-relative). Default: workspace root"),
      pattern: z.string().optional().describe("Glob relative to the workspace root, default '**/*'"),
      max_results: z.number().int().positive().max(5000).optional().describe("Cap, default 1000"),
    },
    async ({ dir, pattern, max_results }) => {
      try {
        const base = dir ? resolvePath(dir) : vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!base) return fail("в workspace нет открытых папок");
        const baseRel = relPath(base).replace(/\\/g, "/");
        const include = pattern
          ? baseRel === vscode.workspace.workspaceFolders?.[0]?.name || baseRel.endsWith(":")
            ? pattern
            : `${baseRel}/${pattern}`
          : baseRel
            ? `${baseRel}/**`
            : "**/*";
        const found = await vscode.workspace.findFiles(include, DEFAULT_EXCLUDE, max_results ?? 1000);
        return ok(found.map(relPath).sort().join("\n") || "(пусто)");
      } catch (e) {
        return fail(errMsg(e));
      }
    },
  );

  server.tool(
    "read_file",
    "Read a UTF-8 text file from the open workspace.",
    {
      path: z.string().describe("File path (absolute or workspace-relative)"),
      max_bytes: z.number().int().positive().optional().describe("Size cap, default 524288 (512 KB)"),
    },
    async ({ path: p, max_bytes }) => {
      try {
        const uri = resolvePath(p);
        const data = await vscode.workspace.fs.readFile(uri);
        const cap = max_bytes ?? 512 * 1024;
        if (data.byteLength > cap) return fail(`${data.byteLength} байт > лимита ${cap}; читай кусками через диапазон или увеличь max_bytes`);
        const buf = Buffer.from(data);
        if (buf.includes(0)) return fail("похоже на бинарный файл — текстовое чтение невозможно");
        return ok(buf.toString("utf8"));
      } catch (e) {
        return fail(errMsg(e));
      }
    },
  );

  server.tool(
    "create_file",
    "Create (or overwrite) a file with the given content. Parent directories are created.",
    {
      path: z.string().describe("File path (absolute or workspace-relative)"),
      content: z.string().describe("Full file content"),
    },
    async ({ path: p, content }) => {
      try {
        const uri = resolvePath(p);
        const snaps = await journal.snapshot([uri]);
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(uri.fsPath)));
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf8"));
        await journal.commit("create_file", `создан ${relPath(uri)}`, { snapshots: snaps });
        return ok(`создан ${relPath(uri)} (${Buffer.byteLength(content, "utf8")} байт)`);
      } catch (e) {
        return fail(errMsg(e));
      }
    },
  );

  server.tool(
    "move_file",
    "Move or rename a file/folder with IDE-assisted reference updates: goes through WorkspaceEdit.renameFile, so language extensions (TypeScript, Volar, …) update imports on the way. This is the reliable alternative to sed/grep rewrites.",
    {
      from: z.string().describe("Current path (absolute or workspace-relative)"),
      to: z.string().describe("New path (absolute or workspace-relative)"),
      overwrite: z.boolean().optional().describe("Overwrite the target if it exists, default false"),
    },
    async ({ from, to, overwrite }) => {
      try {
        const src = resolvePath(from);
        const dst = resolvePath(to);
        const snaps = await journal.snapshot([src, dst]);
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(dst.fsPath)));
        const we = new vscode.WorkspaceEdit();
        we.renameFile(src, dst, { overwrite: overwrite ?? false });
        const applied = await vscode.workspace.applyEdit(we);
        if (!applied) return fail("переезд не применён (штатный rename-провайдер отказал)");
        await journal.commit("move_file", `${relPath(src)} → ${relPath(dst)}`, {
          snapshots: snaps,
          inverseMoves: [{ from: src.fsPath, to: dst.fsPath }],
        });
        return ok(`переехал ${relPath(src)} → ${relPath(dst)}; импорты обновлены IDE там, где провайдеры это поддерживают`);
      } catch (e) {
        return fail(errMsg(e));
      }
    },
  );

  server.tool(
    "copy_file",
    "Copy a file (or folder recursively).",
    {
      from: z.string().describe("Source path"),
      to: z.string().describe("Destination path"),
      overwrite: z.boolean().optional().describe("Overwrite the target if it exists, default false"),
    },
    async ({ from, to, overwrite }) => {
      try {
        const src = resolvePath(from);
        const dst = resolvePath(to);
        const snaps = await journal.snapshot([dst]);
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(dst.fsPath)));
        await vscode.workspace.fs.copy(src, dst, { overwrite: overwrite ?? false });
        await journal.commit("copy_file", `копия ${relPath(src)} → ${relPath(dst)}`, { snapshots: snaps });
        return ok(`скопирован ${relPath(src)} → ${relPath(dst)}`);
      } catch (e) {
        return fail(errMsg(e));
      }
    },
  );

  server.tool(
    "delete_file",
    "Delete a file or folder (recursive). Irreversible — no recycle bin, but the bridge journal keeps a snapshot for undo_last_bridge_edit.",
    {
      path: z.string().describe("Path to delete"),
      recursive: z.boolean().optional().describe("Delete folders recursively, default true"),
    },
    async ({ path: p, recursive }) => {
      try {
        const uri = resolvePath(p);
        const targets = [uri];
        try {
          const stat = await vscode.workspace.fs.stat(uri);
          if (stat.type & vscode.FileType.Directory) {
            const rel = relPath(uri).replace(/\\/g, "/");
            if (rel && !rel.endsWith(":")) {
              const inner = await vscode.workspace.findFiles(`${rel}/**`, undefined, 5000);
              if (inner.length) targets.push(...inner);
            }
          }
        } catch {
          /* stat не удался — пусть delete вернёт ошибку как раньше */
        }
        const snaps = await journal.snapshot(targets);
        await vscode.workspace.fs.delete(uri, { recursive: recursive ?? true, useTrash: false });
        await journal.commit("delete_file", `удалён ${relPath(uri)} (файлов в снапшоте: ${snaps.length})`, { snapshots: snaps });
        return ok(`удалён ${relPath(uri)} (снапшот: ${snaps.length} файл(ов) — откат через undo_last_bridge_edit)`);
      } catch (e) {
        return fail(errMsg(e));
      }
    },
  );

  server.tool(
    "open_file",
    "Open a file in the VS Code editor (visible tab) — useful to hand the result to the human.",
    {
      path: z.string().describe("File path"),
      line: z.number().int().min(0).optional().describe("0-based line to reveal, default 0"),
    },
    async ({ path: p, line }) => {
      try {
        const uri = resolvePath(p);
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: false, selection: new vscode.Range(line ?? 0, 0, line ?? 0, 0) });
        return ok(`открыт ${relPath(uri)}`);
      } catch (e) {
        return fail(errMsg(e));
      }
    },
  );
}
