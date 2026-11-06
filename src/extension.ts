import * as vscode from "vscode";
import { readConfig, BridgeConfig } from "./config";
import { Journal } from "./journal";
import { BridgeServer } from "./server";
import { StatusBar } from "./statusBar";

/** Живой сервер текущего окна — нужен deactivate(), который не умеет await. */
let activeServer: BridgeServer | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel("VS Code MCP Bridge");
  const statusBar = new StatusBar();
  const server = new BridgeServer();
  activeServer = server;
  const journal = new Journal(context.globalStorageUri);
  let config: BridgeConfig = readConfig();

  const start = async (): Promise<void> => {
    if (server.running) return;
    config = readConfig();
    try {
      await server.start(config.port, config.token, config.enabledTools, log, journal);
      statusBar.setRunning(config.port, vscode.workspace.name ?? "(no folder)");
    } catch (e) {
      statusBar.setError();
      const msg = e instanceof Error ? e.message : String(e);
      log.appendLine(`[bridge] старт не удался: ${msg}`);
      if (msg.includes("EADDRINUSE")) {
        log.appendLine("[bridge] порт занят — мост, скорее всего, уже работает в другом окне VS Code");
        void vscode.window.showInformationMessage(
          `MCP Bridge: порт ${config.port} занят — мост уже запущен в другом окне VS Code.`,
        );
      }
    }
  };

  const stop = async (): Promise<void> => {
    await server.stop(log);
    statusBar.setStopped();
  };

  context.subscriptions.push(
    log,
    statusBar.item,
    { dispose: () => void server.stop(log) },
    vscode.commands.registerCommand("vscode-mcp-bridge.start", () => void start()),
    vscode.commands.registerCommand("vscode-mcp-bridge.stop", () => void stop()),
    vscode.commands.registerCommand("vscode-mcp-bridge.toggle", () => void (server.running ? stop() : start())),
    vscode.commands.registerCommand("vscode-mcp-bridge.showInfo", () => {
      const where = vscode.workspace.name ?? "(папка не открыта)";
      void vscode.window.showInformationMessage(
        server.running
          ? `MCP Bridge: http://127.0.0.1:${config.port}/mcp — «${where}»`
          : "MCP Bridge: остановлен (команда «MCP Bridge: Toggle Server» или клик по статус-бару)",
      );
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration("vscode-mcp-bridge")) return;
      log.appendLine("[bridge] настройки изменились — перезапускаю");
      void (async () => {
        await stop();
        await start();
      })();
    }),
  );

  if (config.autoStart) {
    void start();
  } else {
    log.appendLine("[bridge] autoStart выключен — запусти командой «MCP Bridge: Start Server»");
  }
}

/** Горячая переустановка/выключение расширения: закрываем сокет синхронно,
 *  иначе сервер-сирота держит порт и следующий инстанс падает с EADDRINUSE. */
export function deactivate(): void {
  activeServer?.disposeSync();
  activeServer = undefined;
}
