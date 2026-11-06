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

/**
 * Рефакторинги силами самих language-провайдеров VS Code — тот самый
 * «IDE-ассистированный» путь, недоступный bash-скриптам.
 */
export function registerRefactorTools({ server, enabled }: ToolCtx): void {
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
        const files = edit.entries().length;
        const applied = await vscode.workspace.applyEdit(edit);
        if (!applied) return fail("правки переименования не применились");
        if (save_all ?? true) await vscode.workspace.saveAll(false);
        return ok(`переименовал в ${new_name}: файлов затронуто ${files} (провайдер языка обновил импорты/ссылки)`);
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
        const actionable = (actions ?? []).filter(
          (a): a is vscode.CodeAction => "edit" in a || "command" in a,
        );
        if (!actionable.length) return fail("organize-imports экшн недоступен для этого файла");
        const applied = await applyCodeActions(actionable);
        if (save ?? true) await doc.save();
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
        const we = new vscode.WorkspaceEdit();
        we.set(uri, edits);
        const applied = await vscode.workspace.applyEdit(we);
        if (!applied) return fail("форматирование не применилось");
        if (save ?? true) await doc.save();
        return ok(`отформатирован ${relPath(uri)} (${edits.length} правок)`);
      } catch (e) {
        return fail(errMsg(e));
      }
    },
  );
}
