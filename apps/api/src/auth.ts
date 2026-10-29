import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

const scryptAsync = (password: string, salt: string, length: number): Promise<Buffer> =>
  new Promise((resolve, reject) => scrypt(password, salt, length, (error, derived) =>
    error ? reject(error) : resolve(derived as Buffer)));

export function normalizeEmail(value: unknown): string {
  if (typeof value !== "string") throw new Error("邮箱格式无效");
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("邮箱格式无效");
  return email;
}

export function validatePassword(value: unknown): string {
  if (typeof value !== "string" || value.length < 10 || value.length > 128) throw new Error("密码长度需为 10 到 128 个字符");
  return value;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${(await scryptAsync(password, salt, 64)).toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hex] = stored.split(":");
  if (!salt || !hex) return false;
  const expected = Buffer.from(hex, "hex");
  if (expected.length !== 64) return false;
  const actual = await scryptAsync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function digestSession(id: string, secret: string): string { return createHmac("sha256", secret).update(id).digest("hex"); }

export function createSession(db: DatabaseSync, accountId: string, secret: string): { id: string; expiresAt: number } {
  const id = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  db.prepare("INSERT INTO sessions (id, account_id, expires_at) VALUES (?, ?, ?)").run(digestSession(id, secret), accountId, expiresAt);
  return { id, expiresAt };
}

export function sessionAccount(db: DatabaseSync, cookie: string | undefined, secret: string): string | null {
  const id = cookie?.split(";").map(part => part.trim()).find(part => part.startsWith("avs_session="))?.slice("avs_session=".length);
  if (!id) return null;
  const row = db.prepare("SELECT account_id FROM sessions WHERE id = ? AND expires_at > ?").get(digestSession(id, secret), Date.now()) as { account_id: string } | undefined;
  return row?.account_id ?? null;
}

export function clearSession(db: DatabaseSync, cookie: string | undefined, secret: string): void {
  const id = cookie?.split(";").map(part => part.trim()).find(part => part.startsWith("avs_session="))?.slice("avs_session=".length);
  if (id) db.prepare("DELETE FROM sessions WHERE id = ?").run(digestSession(id, secret));
}
