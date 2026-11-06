import * as vscode from "vscode";
import { z } from "zod";
import { DEFAULT_EXCLUDE, relPath, resolvePath } from "../paths";
import { truncate } from "../pure";
import { errMsg, fail, ok, ToolCtx } from "./types";

const SYMBOL_KINDS: Record<number, string> = {
  0: "File", 1: "Module", 2: "Namespace", 3: "Package", 4: "Class", 5: "Method", 6: "Property",
  7: "Field", 8: "Constructor", 9: "Enum", 10: "Interface", 11: "Function", 12: "Variable",
  13: "Constant", 14: "String", 15: "Number", 16: "Boolean", 17: "Array", 18: "Object", 19: "Key",
  20: "Null", 21: "EnumMember", 22: "Struct", 23: "Event", 24: "Operator", 25: "TypeParameter",
};

const SEVERITIES = ["Error", "Warning", "Info", "Hint"];

function positionArg(line: number, column: number): vscode.Position {
  return new vscode.Position(line, column);
}

async function requireDoc(p: string): Promise<vscode.TextDocument> {
  return vscode.workspace.openTextDocument(resolvePath(p));
}

function flattenSymbols(syms: readonly vscode.DocumentSymbol[], depth = 0, out: string[] = [], cap = 300): string[] {
  for (const s of syms) {
    if (out.length >= cap) {
      out.push("… (обрезано)");
      return out;
    }
    out.push(`${"  ".repeat(depth)}${SYMBOL_KINDS[s.kind] ?? "Symbol"} ${s.name} :${s.range.start.line + 1}`);
    flattenSymbols(s.children, depth + 1, out, cap);
  }
  return out;
}

/** Анализ «только читать»: диагностика, символы, навигация, поиск. */
export function registerAnalysisTools({ server, enabled, port }: ToolCtx): void {
  if (!enabled.analysis) return;

  server.tool(
    "get_diagnostics",
    "VS Code diagnostics (errors/warnings from all language providers) for one file or the whole workspace.",
    {
      path: z.string().optional().describe("File path; omit for the whole workspace"),
    },
    async ({ path: p }) => {
      try {
        const entries: Array<[vscode.Uri, readonly vscode.Diagnostic[]]> = p
          ? [[resolvePath(p), vscode.languages.getDiagnostics(resolvePath(p))]]
          : await vscode.languages.getDiagnostics();
        const lines: string[] = [];
        let errors = 0;
        let warnings = 0;
        for (const [uri, diags] of entries) {
          for (const d of diags) {
            if (d.severity === vscode.DiagnosticSeverity.Error) errors++;
            if (d.severity === vscode.DiagnosticSeverity.Warning) warnings++;
            const sev = SEVERITIES[d.severity] ?? "Info";
            const src = d.source ? ` (${d.source})` : "";
            lines.push(`${relPath(uri)}:${d.range.start.line + 1}:${d.range.start.character + 1} ${sev}: ${d.message.replace(/\s+/g, " ")}${src}`);
            if (lines.length >= 200) break;
          }
          if (lines.length >= 200) break;
        }
        const head = `итог: ${errors} ошибок, ${warnings} предупреждений`;
        return ok(lines.length ? `${head}\n${truncate(lines.join("\n"), 200)}` : head);
      } catch (e) {
        return fail(errMsg(e));
      }
    },
  );

  server.tool(
    "search_symbols",
    "Search workspace symbols by name (fuzzy, via the workspace symbol provider).",
    {
      query: z.string().describe("Symbol name substring/fuzzy query"),
      max_results: z.number().int().positive().optional().describe("Cap, default 50"),
    },
    async ({ query, max_results }) => {
      try {
        const syms = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
          "vscode.executeWorkspaceSymbolProvider",
          query,
        );
        const capped = (syms ?? []).slice(0, max_results ?? 50);
        const lines = capped.map(
          (s) => `${SYMBOL_KINDS[s.kind] ?? "Symbol"} ${s.containerName ? s.containerName + "." : ""}${s.name} — ${relPath(s.location.uri)}:${s.location.range.start.line + 1}`,
        );
        return ok(lines.length ? truncate(lines.join("\n"), 100) : "(ничего)");
      } catch (e) {
        return fail(errMsg(e));
      }
    },
  );

  server.tool(
    "document_symbols",
    "Hierarchical outline (classes/methods/functions) of a file.",
    { path: z.string().describe("File path") },
    async ({ path: p }) => {
      try {
        const uri = resolvePath(p);
        const syms = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
          "vscode.executeDocumentSymbolProvider",
          uri,
        );
        if (!syms?.length) return ok("(нет символов — файл пуст или провайдер не подключён)");
        return ok(truncate(flattenSymbols(syms).join("\n"), 300));
      } catch (e) {
        return fail(errMsg(e));
      }
    },
  );

  server.tool(
    "go_to_definition",
    "Definition locations for the symbol at the given 0-based position.",
    {
      path: z.string().describe("File path"),
      line: z.number().int().min(0).describe("0-based line"),
      column: z.number().int().min(0).describe("0-based column"),
    },
    async ({ path: p, line, column }) => {
      try {
        const uri = resolvePath(p);
        await requireDoc(p);
        const locs = await vscode.commands.executeCommand<vscode.Location[] | vscode.Location | undefined>(
          "vscode.executeDefinitionProvider",
          uri,
          positionArg(line, column),
        );
        const arr = Array.isArray(locs) ? locs : locs ? [locs] : [];
        const lines = arr.map((l) => `${relPath(l.uri)}:${l.range.start.line + 1}:${l.range.start.character + 1}`);
        return ok(lines.length ? lines.join("\n") : "(определение не найдено)");
      } catch (e) {
        return fail(errMsg(e));
      }
    },
  );

  server.tool(
    "find_references",
    "All references to the symbol at the given 0-based position (across the workspace).",
    {
      path: z.string().describe("File path"),
      line: z.number().int().min(0).describe("0-based line"),
      column: z.number().int().min(0).describe("0-based column"),
      include_declaration: z.boolean().optional().describe("Include the declaration itself, default true"),
    },
    async ({ path: p, line, column, include_declaration }) => {
      try {
        const uri = resolvePath(p);
        await requireDoc(p);
        const locs = await vscode.commands.executeCommand<vscode.Location[]>(
          "vscode.executeReferenceProvider",
          uri,
          positionArg(line, column),
          { includeDeclaration: include_declaration ?? true },
        );
        const lines = (locs ?? []).map((l) => `${relPath(l.uri)}:${l.range.start.line + 1}:${l.range.start.character + 1}`);
        return ok(lines.length ? truncate(lines.join("\n"), 200) : "(ссылок нет)");
      } catch (e) {
        return fail(errMsg(e));
      }
    },
  );

  server.tool(
    "get_hover",
    "Hover info (types, docs) for the symbol at the given 0-based position.",
    {
      path: z.string().describe("File path"),
      line: z.number().int().min(0).describe("0-based line"),
      column: z.number().int().min(0).describe("0-based column"),
    },
    async ({ path: p, line, column }) => {
      try {
        const uri = resolvePath(p);
        await requireDoc(p);
        const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
          "vscode.executeHoverProvider",
          uri,
          positionArg(line, column),
        );
        const parts: string[] = [];
        for (const h of hovers ?? []) {
          for (const c of h.contents) {
            parts.push(typeof c === "string" ? c : c.value);
          }
        }
        const text = parts.join("\n---\n").slice(0, 1500);
        return ok(text || "(пусто)");
      } catch (e) {
        return fail(errMsg(e));
      }
    },
  );

  server.tool(
    "search_text",
    "Search text/regex across workspace files (respects standard exclude dirs).",
    {
      query: z.string().describe("Search pattern"),
      is_regex: z.boolean().optional().describe("Treat query as a regex, default false"),
      case_sensitive: z.boolean().optional().describe("Case-sensitive, default false"),
      max_results: z.number().int().positive().optional().describe("Cap, default 100"),
    },
    async ({ query, is_regex, case_sensitive, max_results }) => {
      try {
        // findTextInFiles — proposed-API, поэтому сканируем сами: findFiles + построчный
        // поиск с капами на число файлов, размер файла и число результатов.
        const cap = max_results ?? 100;
        const re = is_regex
          ? new RegExp(query, case_sensitive ? "" : "i")
          : null;
        const needle = case_sensitive ? query : query.toLowerCase();
        const files = await vscode.workspace.findFiles("**/*", DEFAULT_EXCLUDE, 3000);
        const results: string[] = [];
        outer: for (const uri of files) {
          const data = await vscode.workspace.fs.readFile(uri);
          if (data.byteLength > 1024 * 1024) continue;
          const text = Buffer.from(data).toString("utf8");
          const lines = text.split("\n");
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i] ?? "";
            const hit = re
              ? re.test(line)
              : case_sensitive
                ? line.includes(query)
                : line.toLowerCase().includes(needle);
            if (hit) {
              results.push(`${relPath(uri)}:${i + 1}: ${line.trim().slice(0, 200)}`);
              if (results.length >= cap) break outer;
            }
          }
        }
        return ok(results.length ? truncate(results.join("\n"), cap) : "(ничего)");
      } catch (e) {
        return fail(errMsg(e));
      }
    },
  );

  server.tool(
    "search_files",
    "Find files by glob (e.g. '**/*.test.ts').",
    {
      pattern: z.string().describe("Glob pattern"),
      max_results: z.number().int().positive().optional().describe("Cap, default 200"),
    },
    async ({ pattern, max_results }) => {
      try {
        const found = await vscode.workspace.findFiles(pattern, DEFAULT_EXCLUDE, max_results ?? 200);
        return ok(found.map(relPath).sort().join("\n") || "(пусто)");
      } catch (e) {
        return fail(errMsg(e));
      }
    },
  );

  server.tool(
    "server_info",
    "Info about the bridge itself: workspace, VS Code version, port, enabled tool categories.",
    {},
    async () => {
      const ws = vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath).join(", ") ?? "(нет папок)";
      const cfg = (await vscode.workspace.getConfiguration("vscode-mcp-bridge").get<Record<string, boolean>>("enabledTools")) ?? {};
      const cats = Object.entries(cfg)
        .map(([k, v]) => `${k}:${v ? "on" : "off"}`)
        .join(", ");
      return ok(`workspace: ${ws}\nvscode: ${vscode.version}\nport: ${port}\ntools: ${cats}`);
    },
  );
}
