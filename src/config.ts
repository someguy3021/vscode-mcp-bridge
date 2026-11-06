import * as vscode from "vscode";
import type { EnabledTools, ToolCategory } from "./tools/types";

export interface BridgeConfig {
  port: number;
  autoStart: boolean;
  token: string;
  enabledTools: EnabledTools;
}

const DEFAULT_TOOLS: EnabledTools = {
  file: true,
  edit: true,
  analysis: true,
  refactor: true,
  command: false,
};

export function readConfig(): BridgeConfig {
  const c = vscode.workspace.getConfiguration("vscode-mcp-bridge");
  const raw = c.get<Partial<Record<ToolCategory, boolean>>>("enabledTools", {});
  return {
    port: c.get<number>("port", 3101),
    autoStart: c.get<boolean>("autoStart", true),
    token: c.get<string>("token", ""),
    enabledTools: { ...DEFAULT_TOOLS, ...raw },
  };
}
