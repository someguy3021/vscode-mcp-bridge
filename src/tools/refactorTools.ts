import * as vscode from "vscode";
import { z } from "zod";
import { relPath, resolvePath } from "../paths";
import { errMsg, fail, ok, ToolCtx } from "./types";

async function applyCodeActions(actions: readonly vscode.CodeAction[]): Promise<number> {
  let applied = 0;
  for (const a of actions) {
    if (a.edit && (await vscode.workspace.applyEdit(a.edit))) applied++;
    if (a.command) {
      await vscode.commands.executeCommand(a.command.command, ...(a.command.arguments ?? []));
      applied++;
    }
  }
  return applied;
}

function normalizeActions(raw: (vscode.Command | vscode.CodeAction)[] | undefined): vscode.CodeAction[] {
  return (raw ?? []).filter((a): a is vscode.CodeAction => "title" in a);
}

/**
 * Рефакторинги силами самих language-провайдеров VS Code — тот самый
 * «IDE-ассистированный» путь, недоступный bash-скриптам.
 */
export function registerRefactorTools({ server, enabled, journal }: ToolCtx): void {
  if (!enabled.refactor) return;

  server.tool(
    "rename_symbol",
    "Rename the symbol (variable/function/class/…) at the given 0-based position across the project using the language provider (LSP rename). Returns how many files were touched.",
    {
      path: z.string().describe("File containing the symbol"),
      line: z.number().int().min(0).describe("0-based line"),
      column: z.number().int().min(0).describe("0-based column"),
      new_name: z.string().min(1).describe("New identifier name"),
      save_all: z.boolean().optional().describe("Save all touched files after the rename, default true"),
    },
    async ({ path: p, line, column, new_name, save_all }) => {
      try {
        const uri = resolvePath(p);
        await vscode.workspace.openTextDocument(uri);
        const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit | undefined>(
          "vscode.executeDocumentRenameProvider",
          uri,
          new vscode.Position(line, column),
          new_name,
        );
        if (!edit) return fail("rename-провайдер не вернул правку — позиция не на символе?");
        const touched = edit.entries().length;
        const snaps = await journal.snapshot(edit.entries().map(([u]) => u));
        const applied = await vscode.workspace.applyEdit(edit);
        if (!applied) return fail("правки переименования не применились");
        if (save_all ?? true) await vscode.workspace.saveAll(false);
        await journal.commit("rename_symbol", `→ ${new_name}: файлов ${touched}`, { snapshots: snaps });
        return ok(`переименовал в ${new_name}: файлов затронуто ${touched} (провайдер языка обновил импорты/ссылки)`);
      } catch (e) {
        return fail(errMsg(e));
      }
    },
  );

  server.tool(
    "organize_imports",
    "Run the language provider's 'Organize Imports' (remove unused, sort, merge) on a file.",
    {
      path: z.string().describe("File path"),
      save: z.boolean().optional().describe("Save after organizing, default true"),
    },
    async ({ path: p, save }) => {
      try {
        const uri = resolvePath(p);
        const doc = await vscode.workspace.openTextDocument(uri);
        const actions = await vscode.commands.executeCommand<(vscode.Command | vscode.CodeAction)[]>(
          "vscode.executeCodeActionProvider",
          uri,
          new vscode.Range(0, 0, doc.lineCount, 0),
          vscode.CodeActionKind.SourceOrganizeImports,
        );
        const actionable = normalizeActions(actions);
        if (!actionable.length) return fail("organize-imports экшн недоступен для этого файла");
        const snaps = await journal.snapshot([uri]);
        const applied = await applyCodeActions(actionable);
        if (save ?? true) await doc.save();
        await journal.commit("organize_imports", `${relPath(uri)}: применено ${applied}`, { snapshots: snaps });
        return ok(`organize imports: применено правок/команд ${applied} в ${relPath(uri)}`);
      } catch (e) {
        return fail(errMsg(e));
      }
    },
  );

  server.tool(
    "format_document",
    "Format a whole file with its default formatter (prettier, built-in formatter, …).",
    {
      path: z.string().describe("File path"),
      save: z.boolean().optional().describe("Save after formatting, default true"),
    },
    async ({ path: p, save }) => {
      try {
        const uri = resolvePath(p);
        const doc = await vscode.workspace.openTextDocument(uri);
        const edits = await vscode.commands.executeCommand<vscode.TextEdit[] | undefined>(
          "vscode.executeFormatDocumentProvider",
          uri,
        );
        if (!edits?.length) return fail("формат-провайдер недоступен или правок не дал");
        const snaps = await journal.snapshot([uri]);
        const we = new vscode.WorkspaceEdit();
        we.set(uri, edits);
        const applied = await vscode.workspace.applyEdit(we);
        if (!applied) return fail("форматирование не применилось");
        if (save ?? true) await doc.save();
        await journal.commit("format_document", `${relPath(uri)}: ${edits.length} правок`, { snapshots: snaps });
        return ok(`отформатирован ${relPath(uri)} (${edits.length} правок)`);
      } catch (e) {
        return fail(errMsg(e));
      }
    },
  );

  server.tool(
    "get_code_actions",
    "List VS Code code actions available at a range: quickfixes (from diagnostics) and refactors (extract/inline/move/wrap…). Exact titles from this list go to apply_code_action.",
    {
      path: z.string().describe("File path"),
      line: z.number().int().min(0).describe("0-based line"),
      column: z.number().int().min(0).describe("0-based column"),
      end_line: z.number().int().min(0).optional().describe("0-based end line for a selection, default = line"),
      end_column: z.number().int().min(0).optional().describe("0-based end column, default = column"),
    },
    async ({ path: p, line, column, end_line, end_column }) => {
      try {
        const uri = resolvePath(p);
        await vscode.workspace.openTextDocument(uri);
        const range = new vscode.Range(line, column, end_line ?? line, end_column ?? column);
        const actions = await vscode.commands.executeCommand<(vscode.Command | vscode.CodeAction)[]>(
          "vscode.executeCodeActionProvider",
          uri,
          range,
        );
        const list = normalizeActions(actions);
        if (!list.length) return ok("(экшенов нет — диапазон не на проблеме/символе)");
        const lines = list.map((a, i) => `[${i}] ${a.kind?.value ? a.kind.value + " | " : ""}${a.title}`);
        return ok(lines.join("\n"));
      } catch (e) {
        return fail(errMsg(e));
      }
    },
  );

  server.tool(
    "apply_code_action",
    "Re-fetch code actions at the range and apply the first one whose title contains the given text (case-insensitive). Take exact titles from get_code_action. Snapshotted — undo_last_bridge_edit reverts.",
    {
      path: z.string().describe("File path"),
      line: z.number().int().min(0).describe("0-based line"),
      column: z.number().int().min(0).describe("0-based column"),
      end_line: z.number().int().min(0).optional().describe("0-based end line, default = line"),
      end_column: z.number().int().min(0).optional().describe("0-based end column, default = column"),
      title: z.string().min(2).describe("Title (or unique substring) from get_code_actions"),
      save: z.boolean().optional().describe("Save touched files, default true"),
    },
    async ({ path: p, line, column, end_line, end_column, title, save }) => {
      try {
        const uri = resolvePath(p);
        const doc = await vscode.workspace.openTextDocument(uri);
        const range = new vscode.Range(line, column, end_line ?? line, end_column ?? column);
        const actions = normalizeActions(
          await vscode.commands.executeCommand<(vscode.Command | vscode.CodeAction)[]>(
            "vscode.executeCodeActionProvider",
            uri,
            range,
          ),
        );
        const needle = title.toLowerCase();
        const found = actions.find((a) => a.title.toLowerCase().includes(needle));
        if (!found) {
          const available = actions.map((a) => a.title).slice(0, 10).join(" · ");
          return fail(`экшн по «${title}» не найден. Доступные: ${available || "(нет)"}`);
        }
        const touched = found.edit ? found.edit.entries().map(([u]) => u) : [];
        const snaps = await journal.snapshot(touched.length ? touched : [uri]);
        const applied = await applyCodeActions([found]);
        if (!applied) return fail("экшн не применился (провайдер отказал)");
        if (save ?? true) await doc.save();
        await journal.commit("apply_code_action", `«${found.title}» в ${relPath(uri)}`, { snapshots: snaps });
        return ok(`применил «${found.title}» (${applied} правок/команд) в ${relPath(uri)}`);
      } catch (e) {
        return fail(errMsg(e));
      }
    },
  );
}
