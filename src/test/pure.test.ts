import { describe, expect, it } from "vitest";
import { countOccurrences, truncate } from "../pure";

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
