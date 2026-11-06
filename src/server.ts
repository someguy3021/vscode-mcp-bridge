import * as vscode from "vscode";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isAllowedHost, isAllowedOrigin, isAllowedToken } from "./security";
import { registerTools } from "./tools";
import { EnabledTools, errMsg } from "./tools/types";
import { Journal } from "./journal";

const MAX_BODY_BYTES = 4 * 1024 * 1024;

/**
 * Stateless Streamable HTTP: на каждый POST — свои McpServer+transport
 * (паттерн stateless из примеров SDK). SDK не требует initialize перед
 * tools/*: каждый запрос самодостаточен, общего состояния нет и нечего
 * «отравлять». enableJsonResponse — ответ обычным JSON с закрытием
 * соединения: без этой опции SDK держит SSE-стрим открытым, и обрыв
 * клиента ломает последующие ответы.
 */
export class BridgeServer {
  private httpServer?: ReturnType<typeof createServer>;
  private running_ = false;

  get running(): boolean {
    return this.running_;
  }

  async start(
    port: number,
    token: string,
    enabled: EnabledTools,
    log: vscode.OutputChannel,
    journal: Journal,
  ): Promise<void> {
    const httpServer = createServer((req, res) => this.handle(req, res, port, token, enabled, log, journal));
    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(port, "127.0.0.1", () => resolve());
    });
    this.httpServer = httpServer;
    this.running_ = true;
    const cats = Object.entries(enabled).filter(([, v]) => v).map(([k]) => k).join(", ") || "нет";
    log.appendLine(`[bridge] слушаю http://127.0.0.1:${port}/mcp (категории: ${cats})`);
  }

  async stop(log: vscode.OutputChannel): Promise<void> {
    const s = this.httpServer;
    this.httpServer = undefined;
    this.running_ = false;
    if (!s) return;
    await new Promise<void>((resolve) => s.close(() => resolve()));
    log.appendLine("[bridge] остановлен");
  }

  /** Синхронный best-effort для deactivate — await там невозможен. */
  disposeSync(): void {
    this.httpServer?.close();
    this.httpServer = undefined;
    this.running_ = false;
  }

  private handle(
    req: IncomingMessage,
    res: ServerResponse,
    port: number,
    token: string,
    enabled: EnabledTools,
    log: vscode.OutputChannel,
    journal: Journal,
  ): void {
    try {
      const reject = (code: number, message: string): void => {
        if (res.writableEnded) return;
        res.writeHead(code, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
      };

      log.appendLine(
        `[mcp] ${req.method} ${req.url} from ${req.socket.remoteAddress} (host=${req.headers.host ?? "?"}, origin=${req.headers.origin ?? "нет"})`,
      );

      if (!isAllowedHost(req.headers.host, port)) return reject(403, "host not allowed");
      if (!isAllowedOrigin(req.headers.origin)) return reject(403, "origin not allowed");
      if (!isAllowedToken(req.headers.authorization, token)) return reject(401, "unauthorized");

      const url = (req.url ?? "/").split("?")[0];
      if (url !== "/mcp") return reject(404, "not found: use /mcp");
      if (req.method !== "POST") {
        // SSE-стрим наружу и CORS-preflight браузерам не даём вовсе.
        res.writeHead(405, { Allow: "POST" });
        return void res.end();
      }

      const chunks: Buffer[] = [];
      let size = 0;
      let aborted = false;
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY_BYTES) {
          aborted = true;
          reject(413, "payload too large");
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on("error", () => {
        /* клиент оборвал соединение — ответ уже не уйдёт */
      });
      req.on("end", () => {
        if (aborted) return;
        let body: unknown;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          return reject(400, "invalid JSON");
        }
        void this.dispatch(body, req, res, port, enabled, log, journal).catch((e) => {
          log.appendLine(`[mcp] dispatch error: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
          reject(500, "internal error");
        });
      });
    } catch (e) {
      const stack = e instanceof Error ? e.stack ?? e.message : String(e);
      log.appendLine(`[mcp] handle() threw: ${stack}`);
      if (!res.writableEnded) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "handle() threw" }, id: null }));
      }
    }
  }

  private async dispatch(
    body: unknown,
    req: IncomingMessage,
    res: ServerResponse,
    port: number,
    enabled: EnabledTools,
    log: vscode.OutputChannel,
    journal: Journal,
  ): Promise<void> {
    const mcp = new McpServer(
      { name: "vscode-mcp-bridge", version: __EXT_VERSION__ },
      { capabilities: { tools: { listChanged: false } } },
    );
    registerTools({ server: mcp, enabled, log, port, journal });

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void mcp.close();
    });
    await mcp.connect(transport);
    await transport.handleRequest(req, res, body);
  }
}
