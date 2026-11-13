import { chmodSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteStore } from "../src/storage/sqlite.js";

describe("SqliteStore", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("sets 0o700 on parent directory and 0o600 on database file for file-backed stores", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "homebox-sqlite-perm-"));
    tempDirs.push(rootDir);

    const dbDir = join(rootDir, "nested-db-dir");
    const dbPath = join(dbDir, "homebox-mcp.db");

    const store = new SqliteStore(dbPath);
    try {
      const dirMode = statSync(dbDir).mode & 0o777;
      const fileMode = statSync(dbPath).mode & 0o777;
      expect(dirMode).toBe(0o700);
      expect(fileMode).toBe(0o600);
    } finally {
      store.close();
    }
  });

  it("enforces 0o700 and 0o600 even if directory and file already existed with looser permissions", () => {
    const dbDir = mkdtempSync(join(tmpdir(), "homebox-sqlite-existing-"));
    tempDirs.push(dbDir);
    chmodSync(dbDir, 0o755);

    const dbPath = join(dbDir, "existing.db");
    const firstStore = new SqliteStore(dbPath);
    firstStore.close();
    chmodSync(dbDir, 0o755);
    chmodSync(dbPath, 0o644);

    const secondStore = new SqliteStore(dbPath);
    try {
      expect(statSync(dbDir).mode & 0o777).toBe(0o700);
      expect(statSync(dbPath).mode & 0o777).toBe(0o600);
    } finally {
      secondStore.close();
    }
  });

  it("supports :memory: databases without touching filesystem permissions", () => {
    const store = new SqliteStore(":memory:");
    store.close();
  });

  it("prunes expired pending auth requests, expired/used authorization codes, and expired/revoked tokens", () => {
    const store = new SqliteStore(":memory:");
    try {
      const now = 1_700_000_000;

      // Pending auth requests: one expired (<= now), one active (> now)
      store.savePendingAuthRequest({
        requestId: "req-expired",
        csrfToken: "csrf-1",
        clientId: "client-1",
        redirectUri: "http://localhost/cb",
        codeChallenge: "challenge-1",
        state: null,
        scopes: ["homebox"],
        resource: null,
        expiresAt: now,
      });
      store.savePendingAuthRequest({
        requestId: "req-active",
        csrfToken: "csrf-2",
        clientId: "client-1",
        redirectUri: "http://localhost/cb",
        codeChallenge: "challenge-2",
        state: null,
        scopes: ["homebox"],
        resource: null,
        expiresAt: now + 60,
      });

      // Authorization codes: one expired, one used, one active & unused
      store.saveAuthorizationCode({
        codeHash: "code-expired",
        clientId: "client-1",
        redirectUri: "http://localhost/cb",
        codeChallenge: "c1",
        scopes: ["homebox"],
        resource: null,
        encryptedHomeboxKey: "enc",
        homeboxUserId: null,
        expiresAt: now - 1,
      });
      store.saveAuthorizationCode({
        codeHash: "code-used",
        clientId: "client-1",
        redirectUri: "http://localhost/cb",
        codeChallenge: "c2",
        scopes: ["homebox"],
        resource: null,
        encryptedHomeboxKey: "enc",
        homeboxUserId: null,
        expiresAt: now + 300,
      });
      expect(store.consumeAuthorizationCode("code-used", "client-1", now - 10)).toBe(
        true,
      );
      store.saveAuthorizationCode({
        codeHash: "code-active",
        clientId: "client-1",
        redirectUri: "http://localhost/cb",
        codeChallenge: "c3",
        scopes: ["homebox"],
        resource: null,
        encryptedHomeboxKey: "enc",
        homeboxUserId: null,
        expiresAt: now + 300,
      });

      // Grants and tokens: expired, revoked, and active
      store.createGrantWithTokens({
        grantId: "grant-expired",
        clientId: "client-1",
        scopes: ["homebox"],
        resource: null,
        encryptedHomeboxKey: "enc",
        homeboxUserId: null,
        accessTokenHash: "at-expired",
        accessTokenExpiresAt: now,
        refreshTokenHash: "rt-expired",
        refreshTokenExpiresAt: now - 5,
        createdAt: now - 100,
      });
      store.createGrantWithTokens({
        grantId: "grant-revoked",
        clientId: "client-1",
        scopes: ["homebox"],
        resource: null,
        encryptedHomeboxKey: "enc",
        homeboxUserId: null,
        accessTokenHash: "at-revoked",
        accessTokenExpiresAt: now + 3600,
        refreshTokenHash: "rt-revoked",
        refreshTokenExpiresAt: now + 3600,
        createdAt: now - 100,
      });
      store.revokeToken("at-revoked", "client-1", now - 5, "access_token");
      store.revokeToken("rt-revoked", "client-1", now - 5, "refresh_token");

      store.createGrantWithTokens({
        grantId: "grant-active",
        clientId: "client-1",
        scopes: ["homebox"],
        resource: null,
        encryptedHomeboxKey: "enc",
        homeboxUserId: null,
        accessTokenHash: "at-active",
        accessTokenExpiresAt: now + 3600,
        refreshTokenHash: "rt-active",
        refreshTokenExpiresAt: now + 3600,
        createdAt: now - 100,
      });

      const deleted = store.pruneExpired(now);
      expect(deleted).toEqual({
        pendingAuthRequests: 1,
        authorizationCodes: 2,
        accessTokens: 2,
        refreshTokens: 2,
      });

      expect(store.getPendingAuthRequest("req-expired")).toBeUndefined();
      expect(store.getPendingAuthRequest("req-active")).toBeDefined();

      expect(store.getAuthorizationCode("code-expired")).toBeUndefined();
      expect(store.getAuthorizationCode("code-used")).toBeUndefined();
      expect(store.getAuthorizationCode("code-active")).toBeDefined();

      expect(store.getActiveAccessToken("at-active", now)).toBeDefined();
      expect(
        store.rotateRefreshToken({
          oldRefreshTokenHash: "rt-active",
          clientId: "client-1",
          now,
          newAccessTokenHash: "at-rotated",
          newAccessTokenExpiresAt: now + 3600,
          newRefreshTokenHash: "rt-rotated",
          newRefreshTokenExpiresAt: now + 7200,
        }),
      ).toBeDefined();
    } finally {
      store.close();
    }
  });
});
