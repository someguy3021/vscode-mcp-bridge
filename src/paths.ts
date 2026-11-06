import * as path from "node:path";
import * as vscode from "vscode";

/**
 * Пути в аргументах тулз: абсолютные или от корня workspace.
 * Windows-бэкслеши и лишние кавычки нормализуем — агентам свойственно.
 */
export function resolvePath(input: string): vscode.Uri {
  const trimmed = input.trim().replace(/^["']|["']$/g, "");
  const isAbsolute = /^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith("\\\\") || trimmed.startsWith("/");
  if (isAbsolute) return vscode.Uri.file(path.normalize(trimmed));
  const ws = vscode.workspace.workspaceFolders?.[0];
  if (!ws) throw new Error("в workspace нет открытых папок, относительный путь не к чему привязать");
  return vscode.Uri.joinPath(ws.uri, ...trimmed.split(/[\\/]+/).filter((s) => s.length > 0));
}

/** fsPath относительно корня workspace, если возможно — для читаемого вывода агенту. */
export function relPath(uri: vscode.Uri): string {
  const fs = uri.fsPath;
  const ws = vscode.workspace.workspaceFolders?.[0];
  if (ws && fs.toLowerCase().startsWith(ws.uri.fsPath.toLowerCase() + path.sep)) {
    return fs.slice(ws.uri.fsPath.length + 1).replace(/\\/g, "/");
  }
  return fs.replace(/\\/g, "/");
}

export const DEFAULT_EXCLUDE =
  "**/{node_modules,.git,dist,out,build,target,coverage,.venv,venv,__pycache__,bin,obj}/**";
