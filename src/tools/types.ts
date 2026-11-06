import type * as vscode from "vscode";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export type ToolCategory = "file" | "edit" | "analysis" | "refactor" | "command";
export type EnabledTools = Record<ToolCategory, boolean>;

export interface ToolCtx {
  server: McpServer;
  enabled: EnabledTools;
  log: vscode.OutputChannel;
  port: number;
}

/** Стандартные обёртки ответа MCP-тулзы (text content). */
export function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export function fail(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
