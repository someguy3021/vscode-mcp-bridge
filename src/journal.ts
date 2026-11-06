import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

export interface FileSnapshot {
  fsPath: string;
  existed: boolean;
  /** base64 прежнего содержимого; нет — файл был слишком велик для снапшота */
  base64?: string;
  skippedLarge?: boolean;
}

export interface InverseMove {
  /** куда вернуть файл при откате */
  from: string;
  /** откуда вернуть (где он оказался после тулзы) */
  to: string;
}

export interface JournalEntry {
  id: number;
  ts: string;
  tool: string;
  summary: string;
  snapshots: FileSnapshot[];
  inverseMoves: InverseMove[];
  undone: boolean;
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;

/**
 * Журнал мутаций моста: перед правкой снимаем «как было» (содержимое файлов,
 * факты существования, обратные переезды) — откат восстанавливает ровно то
 * состояние, что было до тулзы; при возврате move_file IDE снова обновляет
 * импорты. Параллельно пишется аудит (без содержимого файлов) в
 * globalStorage/journal.jsonl — это же данные для review агентом.
 */
export class Journal {
  private entries: JournalEntry[] = [];
  private nextId = 1;
  private readonly jsonlPath: string;

  constructor(globalStorageUri: vscode.Uri) {
    this.jsonlPath = path.join(globalStorageUri.fsPath, "journal.jsonl");
    fs.mkdirSync(path.dirname(this.jsonlPath), { recursive: true });
  }

  async snapshot(uris: vscode.Uri[]): Promise<FileSnapshot[]> {
    const out: FileSnapshot[] = [];
    for (const uri of uris) {
      try {
        const data = await vscode.workspace.fs.readFile(uri);
        if (data.byteLength > MAX_FILE_BYTES) {
          out.push({ fsPath: uri.fsPath, existed: true, skippedLarge: true });
        } else {
          out.push({ fsPath: uri.fsPath, existed: true, base64: Buffer.from(data).toString("base64") });
        }
      } catch {
        out.push({ fsPath: uri.fsPath, existed: false });
      }
    }
    return out;
  }

  async commit(
    tool: string,
    summary: string,
    data: { snapshots: FileSnapshot[]; inverseMoves?: InverseMove[] },
  ): Promise<JournalEntry> {
    const entry: JournalEntry = {
      id: this.nextId++,
      ts: new Date().toISOString(),
      tool,
      summary,
      snapshots: data.snapshots,
      inverseMoves: data.inverseMoves ?? [],
      undone: false,
    };
    this.entries.push(entry);
    this.appendAudit(entry);
    return entry;
  }

  private appendAudit(entry: JournalEntry): void {
    const audit = {
      id: entry.id,
      ts: entry.ts,
      tool: entry.tool,
      summary: entry.summary,
      files: entry.snapshots.map((s) => s.fsPath),
      moves: entry.inverseMoves,
      undone: entry.undone,
    };
    try {
      fs.appendFileSync(this.jsonlPath, JSON.stringify(audit) + "\n");
    } catch {
      /* аудит не должен ронять саму мутацию */
    }
  }

  list(limit: number): Array<Pick<JournalEntry, "id" | "ts" | "tool" | "summary" | "undone">> {
    return this.entries.slice(-limit).reverse().map(({ id, ts, tool, summary, undone }) => ({ id, ts, tool, summary, undone }));
  }

  get lastOpen(): JournalEntry | undefined {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      if (e && !e.undone) return e;
    }
    return undefined;
  }

  async undoLast(): Promise<string> {
    const entry = this.lastOpen;
    if (!entry) return "журнал пуст или всё откачено — нечего откатывать";

    const notes: string[] = [];
    for (const mv of entry.inverseMoves) {
      const we = new vscode.WorkspaceEdit();
      we.renameFile(vscode.Uri.file(mv.to), vscode.Uri.file(mv.from), { overwrite: true });
      if (!(await vscode.workspace.applyEdit(we))) notes.push(`не удалось вернуть ${mv.to} → ${mv.from}`);
    }
    for (const s of entry.snapshots) {
      const uri = vscode.Uri.file(s.fsPath);
      if (!s.existed) {
        try {
          await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: false });
        } catch {
          /* файла уже нет — цель достигнута */
        }
      } else if (s.base64) {
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(s.fsPath)));
        await vscode.workspace.fs.writeFile(uri, Buffer.from(s.base64, "base64"));
      } else {
        notes.push(`${s.fsPath}: файл слишком велик для снапшота — содержимое не восстановлено`);
      }
    }
    entry.undone = true;
    this.appendAudit({ ...entry, tool: entry.tool + " [UNDO]", summary: `откат #${entry.id}: ${entry.summary}` });

    const skipped = entry.snapshots.filter((s) => s.skippedLarge).length;
    if (skipped) notes.push(`файлов без снапшота (велики): ${skipped}`);
    return `откатил «${entry.tool}» (#${entry.id}): ${entry.summary}${notes.length ? "\n" + notes.join("\n") : ""}`;
  }
}
