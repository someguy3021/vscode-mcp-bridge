import { describe, expect, it } from "vitest";
import { isAllowedHost, isAllowedOrigin, isAllowedToken } from "../security";

describe("isAllowedOrigin", () => {
  it("не-браузерный клиент (Origin отсутствует) — пропуск", () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
  });
  it("loopback origins — пропуск", () => {
    expect(isAllowedOrigin("http://localhost:3000")).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:3101")).toBe(true);
    expect(isAllowedOrigin("http://[::1]:5173")).toBe(true);
    expect(isAllowedOrigin("http://localhost")).toBe(true);
  });
  it("внешние и подозрительные origin — отказ", () => {
    expect(isAllowedOrigin("https://evil.com")).toBe(false);
    expect(isAllowedOrigin("http://evil.com:3101")).toBe(false);
    expect(isAllowedOrigin("null")).toBe(false);
    expect(isAllowedOrigin("")).toBe(false);
    expect(isAllowedOrigin("http://localhost.evil.com")).toBe(false);
    expect(isAllowedOrigin("http://127.0.0.1.evil.com")).toBe(false);
  });
});

describe("isAllowedHost", () => {
  it("только loopback на нашем порту", () => {
    expect(isAllowedHost("127.0.0.1:3101", 3101)).toBe(true);
    expect(isAllowedHost("localhost:3101", 3101)).toBe(true);
    expect(isAllowedHost("[::1]:3101", 3101)).toBe(true);
    expect(isAllowedHost("LOCALHOST:3101", 3101)).toBe(true);
  });
  it("чужой хост или порт — отказ (DNS rebinding)", () => {
    expect(isAllowedHost("evil.com:3101", 3101)).toBe(false);
    expect(isAllowedHost("127.0.0.1:9999", 3101)).toBe(false);
    expect(isAllowedHost(undefined, 3101)).toBe(false);
    expect(isAllowedHost("", 3101)).toBe(false);
  });
});

describe("isAllowedToken", () => {
  it("пустой токен — фильтр выключен", () => {
    expect(isAllowedToken(undefined, "")).toBe(true);
    expect(isAllowedToken("Bearer whatever", "")).toBe(true);
  });
  it("заданный токен — только точный Bearer", () => {
    expect(isAllowedToken("Bearer s3cret", "s3cret")).toBe(true);
    expect(isAllowedToken(undefined, "s3cret")).toBe(false);
    expect(isAllowedToken("Bearer wrong", "s3cret")).toBe(false);
    expect(isAllowedToken("s3cret", "s3cret")).toBe(false);
  });
});
