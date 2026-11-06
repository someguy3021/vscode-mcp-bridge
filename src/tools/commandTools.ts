import * as vscode from "vscode";
import { z } from "zod";
import { truncate } from "../pure";
import { errMsg, fail, ok, ToolCtx } from "./types";

/**
 * Категория command по умолчанию ВЫКЛЮЧЕНА: произвольные команды VS Code —
 * это, по сути, Remote Code Execution в рабочий процесс IDE. Включай осознанно.
 */
export function registerCommandTools({ server, enabled }: ToolCtx): void {
  if (!enabled.command) return;

  server.tool(
    "execute_command",
    "Run an arbitrary VS Code command by id (e.g. 'workbench.action.tasks.runTask'). Enable the 'command' tool category first.",
    {
      command_id: z.string().describe("VS Code command id"),
      args_json: z.string().optional().describe("JSON array of arguments, e.g. '[\"build\"]'"),
    },
    async ({ command_id, args_json }) => {
      try {
        let args: unknown[] = [];
        if (args_json !== undefined) {
          const parsed: unknown = JSON.parse(args_json);
          if (!Array.isArray(parsed)) return fail("args_json должен быть JSON-массивом");
          args = parsed;
        }
        const result = await vscode.commands.executeCommand<unknown>(command_id, ...args);
        const text =
          result === undefined
            ? "(команда выполнилась, результата нет)"
            : truncate(JSON.stringify(result, null, 1) ?? String(result), 50);
        return ok(text);
      } catch (e) {
        return fail(errMsg(e));
      }
    },
  );
}
