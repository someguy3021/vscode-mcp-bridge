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
