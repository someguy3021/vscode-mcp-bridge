/**
 * Чистые валидаторы входящих HTTP-запросов. Без vscode и node-импортов —
 * покрываются юнит-тестами напрямую.
 *
 * Модель угроз: страница в браузере (или другой локальный процесс) пытается
 * дёрнуть сервер агента за спиной пользователя. Отсюда три пояса:
 *  1. Origin — браузерные запросы обязаны идти с loopback-origin;
 *  2. Host — защита от DNS-rebinding (evil.com -> 127.0.0.1);
 *  3. опциональный bearer-токен для «я знаю, что делаю».
 * Не-браузерные клиенты (curl, MCP-клиенты) Origin не шлют — им ок.
 */

const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/** undefined = не-браузерный клиент (разрешено); "null" = sandboxed iframe и т.п. (запрещено). */
export function isAllowedOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  return LOOPBACK_ORIGIN.test(origin);
}

/** Host-заголовок обязан указывать на loopback и наш порт (DNS-rebinding protection). */
export function isAllowedHost(host: string | undefined, port: number): boolean {
  if (!host) return false;
  const h = host.toLowerCase();
  return h === `127.0.0.1:${port}` || h === `localhost:${port}` || h === `[::1]:${port}`;
}

export function isAllowedToken(authHeader: string | undefined, token: string): boolean {
  if (!token) return true; // токен не задан — фильтр выключен
  return authHeader === `Bearer ${token}`;
}
