import * as vscode from "vscode";

export class StatusBar {
  readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);

  constructor() {
    this.item.command = "vscode-mcp-bridge.toggle";
    this.setStopped();
    this.item.show();
  }

  setRunning(port: number, workspaceName: string): void {
    this.item.text = `$(radio-tower) MCP:${port}`;
    this.item.tooltip = `VS Code MCP Bridge — работает на 127.0.0.1:${port} (${workspaceName}). Клик — выключить.`;
    this.item.backgroundColor = undefined;
  }

  setStopped(): void {
    this.item.text = `$(circle-slash) MCP`;
    this.item.tooltip = "VS Code MCP Bridge — остановлен. Клик — запустить.";
    this.item.backgroundColor = undefined;
  }

  setError(): void {
    this.item.text = `$(error) MCP`;
    this.item.tooltip = "VS Code MCP Bridge — ошибка запуска (см. вывод «VS Code MCP Bridge»).";
    this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
  }
}
