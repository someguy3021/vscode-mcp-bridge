import * as vscode from "vscode";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isAllowedHost, isAllowedOrigin, isAllowedToken } from "./security";
import { registerTools } from "./tools";
import { EnabledTools, errMsg } from "./tools/types";

const MAX_BODY_BYTES = 4 * 1024 * 1024;

/**
 * Streamable HTTP без сессий (sessionIdGenerator: undefined): клиент делает
 * initialize один раз, дальше шлёт обычные JSON-RPC POST-ы. Сервер и транспорт
 * — общие на всё время работы окна; ответы маршрутизируются на конкретный
 * req/res парой handleRequest.
 */
export class BridgeServer {
  private httpServer?: ReturnType<typeof createServer>;
  private transport?: StreamableHTTPServerTransport;
  private running_ = false;

  get running(): boolean {
    return this.running_;
  }

  async start(port: number, token: string, enabled: EnabledTools, log: vscode.OutputChannel): Promise<void> {
    const mcp = new McpServer(
      { name: "vscode-mcp-bridge", version: "0.1.0" },
      { capabilities: { tools: { listChanged: false } } },
    );
    registerTools({ server: mcp, enabled, log, port });

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await mcp.connect(transport);

    const httpServer = createServer((req, res) => this.handle(req, res, port, token, transport, log));
    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(port, "127.0.0.1", () => resolve());
    });

    this.httpServer = httpServer;
    this.transport = transport;
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
    await this.transport?.close();
    this.transport = undefined;
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
    transport: StreamableHTTPServerTransport,
    log: vscode.OutputChannel,
  ): void {
    const reject = (code: number, message: string): void => {
      if (res.writableEnded) return;
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
    };

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
      void transport.handleRequest(req, res, body).catch((e) => {
        log.appendLine(`[mcp] handleRequest error: ${errMsg(e)}`);
        reject(500, "internal error");
      });
    });
  }
}
