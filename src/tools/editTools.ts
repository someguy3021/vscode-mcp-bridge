import * as vscode from "vscode";
import { z } from "zod";
import { countOccurrences } from "../pure";
import { relPath, resolvePath } from "../paths";
import { errMsg, fail, ok, ToolCtx } from "./types";

/**
 * Контентные правки. replace_in_file требует точного совпадения старого текста
 * и по умолчанию ровно одного вхождения — защита от «заменил не там».
 */
export function registerEditTools({ server, enabled }: ToolCtx): void {
  if (!enabled.edit) return;

  server.tool(
    "write_file",
    "Overwrite a file with the given full content (raw write, no diffing).",
    {
      path: z.string().describe("File path"),
      content: z.string().describe("Full new content"),
    },
    async ({ path: p, content }) => {
      try {
        const uri = resolvePath(p);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf8"));
        return ok(`записан ${relPath(uri)} (${Buffer.byteLength(content, "utf8")} байт)`);
      } catch (e) {
        return fail(errMsg(e));
      }
    },
  );

  server.tool(
    "replace_in_file",
    "Replace exact old_text with new_text. Fails unless the number of occurrences matches expect (default: exactly one) — no blind regex surgery.",
    {
      path: z.string().describe("File path"),
      old_text: z.string().min(2).describe("Exact text to find (verbatim, incl. indentation)"),
      new_text: z.string().describe("Replacement text"),
      expect: z.number().int().positive().optional().describe("Expected occurrence count, default 1"),
      save: z.boolean().optional().describe("Save the file after the edit, default true"),
    },
    async ({ path: p, old_text, new_text, expect, save }) => {
      try {
        const uri = resolvePath(p);
        const doc = await vscode.workspace.openTextDocument(uri);
        const text = doc.getText();
        const found = countOccurrences(text, old_text);
        const expected = expect ?? 1;
        if (found !== expected) {
          return fail(`ожидалось ${expected} вхождение(й), найдено ${found} — уточни old_text или ожидание`);
        }
        const idx = text.indexOf(old_text);
        const range = new vscode.Range(doc.positionAt(idx), doc.positionAt(idx + old_text.length));
        const we = new vscode.WorkspaceEdit();
        we.replace(uri, range, new_text);
        const applied = await vscode.workspace.applyEdit(we);
        if (!applied) return fail("правка не применена");
        if (save ?? true) await doc.save();
        return ok(`правка применена в ${relPath(uri)} (строки ${range.start.line + 1}–${range.end.line + 1})`);
      } catch (e) {
        return fail(errMsg(e));
      }
    },
  );
}
