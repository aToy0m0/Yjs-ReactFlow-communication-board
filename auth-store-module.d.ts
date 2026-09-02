declare module "@/lib/auth-store.mjs" {
  export type AuthUser = { address: string; displayName: string; isAdmin: boolean; mustChangePassword: boolean };
  export type StoredUser = AuthUser & { createdAt: string; updatedAt: string };
  export const SESSION_COOKIE_NAME: string;
  export const SESSION_MAX_AGE_SECONDS: number;
  export const COLLABORATION_TOKEN_MAX_AGE_SECONDS: number;
  export function listUsers(): StoredUser[];
  export function displayNameFromAddress(address: string): string;
  export function createUser(input: { address: string; displayName?: string; password: string; isAdmin?: boolean }): StoredUser;
  export function getUser(address: string): StoredUser | null;
  export function updateUser(input: { address: string; displayName: string; isAdmin?: boolean }): StoredUser;
  export function changePassword(input: { address: string; currentPassword: string; newPassword: string }): StoredUser;
  export function deleteUser(address: string): void;
  export function authenticateUser(address: string, password: string): AuthUser | null;
  export function loginRateLimit(address: string): { blocked: boolean; retryAfterSeconds: number };
  export function recordLoginFailure(address: string): { blocked: boolean; retryAfterSeconds: number };
  export function clearLoginFailures(address: string): void;
  export function createSession(address: string): { token: string; expiresAt: Date };
  export function getSessionUser(token: string): AuthUser | null;
  export function createCollaborationToken(address: string): { token: string; expiresAt: Date };
  export function validateCollaborationToken(token: string): AuthUser | null;
  export function deleteSession(token: string): void;
  export function sessionTokenFromCookie(cookieHeader: string | null): string;
  export function getRequestUser(request: Request): AuthUser | null;
  export function resetAuthStoreForTests(): void;
}
