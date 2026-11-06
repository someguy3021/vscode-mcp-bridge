/**
 * Чистые строковые утилиты без зависимостей — общие для тулз и тестов.
 */

/** Число непересекающихся вхождений needle в haystack (0 при пустой игле). */
export function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

/** Обрезать длинный вывод до лимита с пометкой. */
export function truncate(text: string, maxLines: number, maxCharsPerLine = 300): string {
  const lines = text.split("\n");
  const capped = lines.slice(0, maxLines).map((l) => (l.length > maxCharsPerLine ? l.slice(0, maxCharsPerLine) + "…" : l));
  if (lines.length > maxLines) capped.push(`… (+${lines.length - maxLines} строк, обрезано)`);
  return capped.join("\n");
}

/**
 * Оставить из unified-diff только секции файлов, чей путь содержит pathSub
 * (регистронезависимо; принимает и относительный, и абсолютный Windows-путь —
 * абсолютный матчится по хвосту из двух последних сегментов).
 */
export function filterDiffByPath(diff: string, pathSub: string): string {
  const norm = (s: string): string => s.replace(/\\/g, "/").replace(/^["']/g, "").toLowerCase();
  const needle = norm(pathSub);
  const tail = needle.split("/").filter(Boolean).slice(-2).join("/");
  const sections: string[] = [];
  let current: string[] | null = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      if (current) sections.push(current.join("\n"));
      current = [line];
      continue;
    }
    if (current) current.push(line);
  }
  if (current) sections.push(current.join("\n"));
  return sections
    .filter((s) => {
      const plusLine = s.split("\n").find((l) => l.startsWith("+++ ")) ?? "";
      const header = norm(plusLine || s.split("\n")[0] || "");
      return header.includes(needle) || (tail.length > 0 && header.endsWith(tail));
    })
    .join("\n");
}
