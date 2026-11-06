import { describe, expect, it } from "vitest";
import { countOccurrences, filterDiffByPath, truncate } from "../pure";

describe("filterDiffByPath", () => {
  const diff = [
    "diff --git a/src/a.ts b/src/a.ts",
    "index 111..222 100644",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1,2 +1,2 @@",
    "-const a = 1;",
    "+const a = 2;",
    "diff --git a/src/b.ts b/src/b.ts",
    "index 333..444 100644",
    "--- a/src/b.ts",
    "+++ b/src/b.ts",
    "@@ -1,2 +1,2 @@",
    "-const b = 1;",
    "+const b = 2;",
  ].join("\n");

  it("оставляет только секции совпавшего пути", () => {
    const out = filterDiffByPath(diff, "src/a.ts");
    expect(out).toContain("b/src/a.ts");
    expect(out).toContain("+const a = 2;");
    expect(out).not.toContain("const b = 2;");
  });
  it("абсолютный Windows-путь матчится по хвосту", () => {
    const out = filterDiffByPath(diff, "D:\\proj\\src\\a.ts");
    expect(out).toContain("const a = 2;");
    expect(out).not.toContain("const b = 2;");
  });
  it("нет совпадений — пусто", () => {
    expect(filterDiffByPath(diff, "nope/x.ts")).toBe("");
  });
});

describe("countOccurrences", () => {
  it("считает непересекающиеся вхождения", () => {
    expect(countOccurrences("aaa", "aa")).toBe(1);
    expect(countOccurrences("abcabc", "abc")).toBe(2);
    expect(countOccurrences("hello world", "o")).toBe(2);
  });
  it("края: пустая игла и отсутствие вхождений", () => {
    expect(countOccurrences("abc", "")).toBe(0);
    expect(countOccurrences("", "x")).toBe(0);
    expect(countOccurrences("foo", "bar")).toBe(0);
  });
  it("многострочный текст с точным повторением", () => {
    const src = "const a = 1;\nconst b = 2;\nconst a = 1;\n";
    expect(countOccurrences(src, "const a = 1;")).toBe(2);
  });
});

describe("truncate", () => {
  it("обрезает по строкам с пометкой", () => {
    const out = truncate(["1", "2", "3"].join("\n"), 2);
    expect(out).toContain("1");
    expect(out).not.toContain("3");
    expect(out).toContain("+1");
  });
  it("обрезает длинные строки", () => {
    const out = truncate("x".repeat(400), 1, 300);
    expect(out.length).toBeLessThan(320);
    expect(out.endsWith("…")).toBe(true);
  });
});
