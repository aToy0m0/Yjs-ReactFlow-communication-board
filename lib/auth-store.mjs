import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const SESSION_COOKIE_NAME = "renraku_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
export const COLLABORATION_TOKEN_MAX_AGE_SECONDS = 60 * 5;

const LOGIN_FAILURE_LIMIT = 5;
const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;

let database;

function normalizeAddress(address) {
  return address.trim().toLowerCase();
}

export function displayNameFromAddress(address) {
  return normalizeAddress(address).split("@")[0];
}

function passwordHash(password) {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

function passwordMatches(password, stored) {
  const [algorithm, encodedSalt, encodedHash] = stored.split("$");
  if (algorithm !== "scrypt" || !encodedSalt || !encodedHash) throw new Error("保存されているパスワード形式が不正です。");
  const expected = Buffer.from(encodedHash, "base64url");
  const actual = scryptSync(password, Buffer.from(encodedSalt, "base64url"), expected.length);
  return timingSafeEqual(expected, actual);
}

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

function getDatabase() {
  if (database) return database;
  const dataDirectory = join(process.cwd(), "data");
  mkdirSync(dataDirectory, { recursive: true });
  database = new DatabaseSync(join(dataDirectory, "mingleboard.sqlite"));
  database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      address TEXT PRIMARY KEY COLLATE NOCASE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_sessions (
      token_hash TEXT PRIMARY KEY,
      user_address TEXT NOT NULL REFERENCES users(address) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS user_sessions_user_address ON user_sessions(user_address);
    CREATE INDEX IF NOT EXISTS user_sessions_expires_at ON user_sessions(expires_at);
    CREATE TABLE IF NOT EXISTS collaboration_tokens (
      token_hash TEXT PRIMARY KEY,
      user_address TEXT NOT NULL REFERENCES users(address) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS collaboration_tokens_expires_at ON collaboration_tokens(expires_at);
    CREATE TABLE IF NOT EXISTS login_rate_limits (
      address TEXT PRIMARY KEY COLLATE NOCASE,
      failure_count INTEGER NOT NULL,
      window_started_at TEXT NOT NULL,
      blocked_until TEXT
    );
  `);
  const userColumns = database.prepare("PRAGMA table_info(users)").all();
  if (!userColumns.some((column) => column.name === "is_admin")) database.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0");
  if (!userColumns.some((column) => column.name === "must_change_password")) database.exec("ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0");
  const now = new Date().toISOString();
  database.prepare("DELETE FROM user_sessions WHERE expires_at <= ?").run(now);
  database.prepare("DELETE FROM collaboration_tokens WHERE expires_at <= ?").run(now);

  const count = Number(database.prepare("SELECT COUNT(*) AS count FROM users").get().count);
  const bootstrapAddress = process.env.RENRAKU_BOOTSTRAP_ADDRESS?.trim();
  const bootstrapName = process.env.RENRAKU_BOOTSTRAP_DISPLAY_NAME?.trim();
  const bootstrapPassword = process.env.RENRAKU_BOOTSTRAP_PASSWORD;
  if (count === 0 && bootstrapAddress && bootstrapPassword) {
    const createdAt = new Date().toISOString();
    database.prepare("INSERT INTO users (address, display_name, password_hash, is_admin, must_change_password, created_at, updated_at) VALUES (?, ?, ?, 1, 0, ?, ?)")
      .run(normalizeAddress(bootstrapAddress), bootstrapName || displayNameFromAddress(bootstrapAddress), passwordHash(bootstrapPassword), createdAt, createdAt);
  }
  const currentCount = Number(database.prepare("SELECT COUNT(*) AS count FROM users").get().count);
  const adminCount = Number(database.prepare("SELECT COUNT(*) AS count FROM users WHERE is_admin = 1").get().count);
  if (currentCount > 0 && adminCount === 0) database.exec("UPDATE users SET is_admin = 1 WHERE address = (SELECT address FROM users ORDER BY created_at, address LIMIT 1)");
  return database;
}

export function listUsers() {
  return getDatabase().prepare("SELECT address, display_name AS displayName, is_admin AS isAdmin, must_change_password AS mustChangePassword, created_at AS createdAt, updated_at AS updatedAt FROM users ORDER BY address").all()
    .map((row) => ({ address: String(row.address), displayName: String(row.displayName), isAdmin: Boolean(row.isAdmin), mustChangePassword: Boolean(row.mustChangePassword), createdAt: String(row.createdAt), updatedAt: String(row.updatedAt) }));
}

export function createUser({ address, displayName, password, isAdmin = false }) {
  const now = new Date().toISOString();
  getDatabase().prepare("INSERT INTO users (address, display_name, password_hash, is_admin, must_change_password, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)")
    .run(normalizeAddress(address), displayName?.trim() || displayNameFromAddress(address), passwordHash(password), Number(isAdmin), now, now);
  return getUser(address);
}

export function getUser(address) {
  const row = getDatabase().prepare("SELECT address, display_name AS displayName, is_admin AS isAdmin, must_change_password AS mustChangePassword, created_at AS createdAt, updated_at AS updatedAt FROM users WHERE address = ?").get(normalizeAddress(address));
  return row ? { address: String(row.address), displayName: String(row.displayName), isAdmin: Boolean(row.isAdmin), mustChangePassword: Boolean(row.mustChangePassword), createdAt: String(row.createdAt), updatedAt: String(row.updatedAt) } : null;
}

export function updateUser({ address, displayName, isAdmin }) {
  const normalized = normalizeAddress(address);
  const db = getDatabase();
  const now = new Date().toISOString();
  const current = getUser(normalized);
  if (!current) throw new Error("指定されたユーザーは存在しません。");
  if (current.isAdmin && isAdmin === false) {
    const adminCount = Number(db.prepare("SELECT COUNT(*) AS count FROM users WHERE is_admin = 1").get().count);
    if (adminCount <= 1) throw new Error("管理者は最低1人必要です。");
  }
  db.prepare("UPDATE users SET display_name = ?, is_admin = COALESCE(?, is_admin), updated_at = ? WHERE address = ?")
    .run(displayName.trim(), isAdmin === undefined ? null : Number(isAdmin), now, normalized);
  return getUser(normalized);
}

export function changePassword({ address, currentPassword, newPassword }) {
  const normalized = normalizeAddress(address);
  if (!authenticateUser(normalized, currentPassword)) throw new Error("現在のパスワードが違います。");
  const db = getDatabase();
  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE address = ?").run(passwordHash(newPassword), now, normalized);
    db.prepare("DELETE FROM user_sessions WHERE user_address = ?").run(normalized);
    db.prepare("DELETE FROM collaboration_tokens WHERE user_address = ?").run(normalized);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getUser(normalized);
}

export function deleteUser(address) {
  const result = getDatabase().prepare("DELETE FROM users WHERE address = ?").run(normalizeAddress(address));
  if (result.changes === 0) throw new Error("指定されたユーザーは存在しません。");
}

export function authenticateUser(address, password) {
  const row = getDatabase().prepare("SELECT address, display_name AS displayName, is_admin AS isAdmin, must_change_password AS mustChangePassword, password_hash AS passwordHash FROM users WHERE address = ?").get(normalizeAddress(address));
  if (!row || !passwordMatches(password, row.passwordHash)) return null;
  return { address: String(row.address), displayName: String(row.displayName), isAdmin: Boolean(row.isAdmin), mustChangePassword: Boolean(row.mustChangePassword) };
}

export function loginRateLimit(address) {
  const normalized = normalizeAddress(address);
  const db = getDatabase();
  const now = Date.now();
  const row = db.prepare("SELECT failure_count AS failureCount, window_started_at AS windowStartedAt, blocked_until AS blockedUntil FROM login_rate_limits WHERE address = ?").get(normalized);
  if (!row) return { blocked: false, retryAfterSeconds: 0 };
  const blockedUntil = row.blockedUntil ? new Date(String(row.blockedUntil)).getTime() : 0;
  if (blockedUntil > now) return { blocked: true, retryAfterSeconds: Math.ceil((blockedUntil - now) / 1000) };
  const windowStartedAt = new Date(String(row.windowStartedAt)).getTime();
  if (now - windowStartedAt >= LOGIN_FAILURE_WINDOW_MS || blockedUntil) {
    db.prepare("DELETE FROM login_rate_limits WHERE address = ?").run(normalized);
  }
  return { blocked: false, retryAfterSeconds: 0 };
}

export function recordLoginFailure(address) {
  const normalized = normalizeAddress(address);
  const db = getDatabase();
  const now = new Date();
  const row = db.prepare("SELECT failure_count AS failureCount, window_started_at AS windowStartedAt, blocked_until AS blockedUntil FROM login_rate_limits WHERE address = ?").get(normalized);
  const activeWindow = row && now.getTime() - new Date(String(row.windowStartedAt)).getTime() < LOGIN_FAILURE_WINDOW_MS;
  const failureCount = activeWindow ? Number(row.failureCount) + 1 : 1;
  const windowStartedAt = activeWindow ? String(row.windowStartedAt) : now.toISOString();
  const blockedUntil = failureCount >= LOGIN_FAILURE_LIMIT ? new Date(now.getTime() + LOGIN_BLOCK_MS).toISOString() : null;
  db.prepare(`INSERT INTO login_rate_limits (address, failure_count, window_started_at, blocked_until) VALUES (?, ?, ?, ?)
    ON CONFLICT(address) DO UPDATE SET failure_count = excluded.failure_count, window_started_at = excluded.window_started_at, blocked_until = excluded.blocked_until`)
    .run(normalized, failureCount, windowStartedAt, blockedUntil);
  return blockedUntil ? { blocked: true, retryAfterSeconds: Math.ceil(LOGIN_BLOCK_MS / 1000) } : { blocked: false, retryAfterSeconds: 0 };
}

export function clearLoginFailures(address) {
  getDatabase().prepare("DELETE FROM login_rate_limits WHERE address = ?").run(normalizeAddress(address));
}

export function createSession(address) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000);
  getDatabase().prepare("INSERT INTO user_sessions (token_hash, user_address, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .run(tokenHash(token), normalizeAddress(address), expiresAt.toISOString(), now.toISOString());
  return { token, expiresAt };
}

export function getSessionUser(token) {
  if (!token) return null;
  const row = getDatabase().prepare(`SELECT u.address, u.display_name AS displayName, u.is_admin AS isAdmin, u.must_change_password AS mustChangePassword
    FROM user_sessions s JOIN users u ON u.address = s.user_address
    WHERE s.token_hash = ? AND s.expires_at > ?`).get(tokenHash(token), new Date().toISOString());
  return row ? { address: String(row.address), displayName: String(row.displayName), isAdmin: Boolean(row.isAdmin), mustChangePassword: Boolean(row.mustChangePassword) } : null;
}

export function createCollaborationToken(address) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + COLLABORATION_TOKEN_MAX_AGE_SECONDS * 1000);
  const db = getDatabase();
  db.prepare("DELETE FROM collaboration_tokens WHERE expires_at <= ?").run(now.toISOString());
  db.prepare("INSERT INTO collaboration_tokens (token_hash, user_address, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .run(tokenHash(token), normalizeAddress(address), expiresAt.toISOString(), now.toISOString());
  return { token, expiresAt };
}

export function validateCollaborationToken(token) {
  if (!token) return null;
  const row = getDatabase().prepare(`SELECT u.address, u.display_name AS displayName, u.is_admin AS isAdmin, u.must_change_password AS mustChangePassword
    FROM collaboration_tokens c JOIN users u ON u.address = c.user_address
    WHERE c.token_hash = ? AND c.expires_at > ? AND u.must_change_password = 0`).get(tokenHash(token), new Date().toISOString());
  return row ? { address: String(row.address), displayName: String(row.displayName), isAdmin: Boolean(row.isAdmin), mustChangePassword: Boolean(row.mustChangePassword) } : null;
}

export function deleteSession(token) {
  if (token) getDatabase().prepare("DELETE FROM user_sessions WHERE token_hash = ?").run(tokenHash(token));
}

export function sessionTokenFromCookie(cookieHeader) {
  if (!cookieHeader) return "";
  const entry = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`));
  return entry ? decodeURIComponent(entry.slice(SESSION_COOKIE_NAME.length + 1)) : "";
}

export function getRequestUser(request) {
  return getSessionUser(sessionTokenFromCookie(request.headers.get("cookie")));
}

export function resetAuthStoreForTests() {
  database?.close();
  database = undefined;
}
