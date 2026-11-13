import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";

export interface PendingAuthRequestRecord {
  requestId: string;
  csrfToken: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
  scopes: string[];
  resource: string | null;
  expiresAt: number;
}

export interface AuthorizationCodeRecord {
  codeHash: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: string[];
  resource: string | null;
  encryptedHomeboxKey: string;
  homeboxUserId: string | null;
  expiresAt: number;
  usedAt: number | null;
}

export class SqliteStore {
  readonly db: DatabaseSync;

  constructor(databasePath: string) {
    if (databasePath !== ":memory:") {
      mkdirSync(dirname(databasePath), { recursive: true });
    }
    this.db = new DatabaseSync(databasePath);
    if (databasePath !== ":memory:") {
      this.db.exec("PRAGMA journal_mode = WAL;");
    }
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS oauth_clients (
        client_id TEXT PRIMARY KEY,
        metadata_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pending_auth_requests (
        request_id TEXT PRIMARY KEY,
        csrf_token TEXT NOT NULL,
        client_id TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        code_challenge TEXT NOT NULL,
        state TEXT,
        scopes_json TEXT NOT NULL,
        resource TEXT,
        expires_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS authorization_codes (
        code_hash TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        code_challenge TEXT NOT NULL,
        scopes_json TEXT NOT NULL,
        resource TEXT,
        encrypted_homebox_key TEXT NOT NULL,
        homebox_user_id TEXT,
        expires_at INTEGER NOT NULL,
        used_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS oauth_grants (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        scopes_json TEXT NOT NULL,
        resource TEXT,
        encrypted_homebox_key TEXT NOT NULL,
        homebox_user_id TEXT,
        created_at INTEGER NOT NULL,
        revoked_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS oauth_access_tokens (
        token_hash TEXT PRIMARY KEY,
        grant_id TEXT NOT NULL REFERENCES oauth_grants(id),
        expires_at INTEGER NOT NULL,
        revoked_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
        token_hash TEXT PRIMARY KEY,
        grant_id TEXT NOT NULL REFERENCES oauth_grants(id),
        expires_at INTEGER NOT NULL,
        used_at INTEGER,
        revoked_at INTEGER
      );
    `);
  }

  getClient(clientId: string): OAuthClientInformationFull | undefined {
    const row = this.db
      .prepare("SELECT metadata_json FROM oauth_clients WHERE client_id = ?")
      .get(clientId) as { metadata_json: string } | undefined;
    if (!row) {
      return undefined;
    }
    return JSON.parse(row.metadata_json) as OAuthClientInformationFull;
  }

  saveClient(client: OAuthClientInformationFull): OAuthClientInformationFull {
    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare(
        "INSERT INTO oauth_clients (client_id, metadata_json, created_at) VALUES (?, ?, ?)",
      )
      .run(client.client_id, JSON.stringify(client), now);
    return client;
  }

  savePendingAuthRequest(req: PendingAuthRequestRecord): void {
    this.db
      .prepare(
        `INSERT INTO pending_auth_requests (
          request_id, csrf_token, client_id, redirect_uri, code_challenge, state, scopes_json, resource, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        req.requestId,
        req.csrfToken,
        req.clientId,
        req.redirectUri,
        req.codeChallenge,
        req.state,
        JSON.stringify(req.scopes),
        req.resource,
        req.expiresAt,
      );
  }

  getPendingAuthRequest(requestId: string): PendingAuthRequestRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT request_id, csrf_token, client_id, redirect_uri, code_challenge, state, scopes_json, resource, expires_at
         FROM pending_auth_requests WHERE request_id = ?`,
      )
      .get(requestId) as
      | {
          request_id: string;
          csrf_token: string;
          client_id: string;
          redirect_uri: string;
          code_challenge: string;
          state: string | null;
          scopes_json: string;
          resource: string | null;
          expires_at: number;
        }
      | undefined;

    if (!row) {
      return undefined;
    }

    return {
      requestId: row.request_id,
      csrfToken: row.csrf_token,
      clientId: row.client_id,
      redirectUri: row.redirect_uri,
      codeChallenge: row.code_challenge,
      state: row.state,
      scopes: JSON.parse(row.scopes_json) as string[],
      resource: row.resource,
      expiresAt: row.expires_at,
    };
  }

  deletePendingAuthRequest(requestId: string): void {
    this.db
      .prepare("DELETE FROM pending_auth_requests WHERE request_id = ?")
      .run(requestId);
  }

  saveAuthorizationCode(record: Omit<AuthorizationCodeRecord, "usedAt">): void {
    this.db
      .prepare(
        `INSERT INTO authorization_codes (
          code_hash, client_id, redirect_uri, code_challenge, scopes_json, resource,
          encrypted_homebox_key, homebox_user_id, expires_at, used_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        record.codeHash,
        record.clientId,
        record.redirectUri,
        record.codeChallenge,
        JSON.stringify(record.scopes),
        record.resource,
        record.encryptedHomeboxKey,
        record.homeboxUserId,
        record.expiresAt,
      );
  }

  getAuthorizationCode(codeHash: string): AuthorizationCodeRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT code_hash, client_id, redirect_uri, code_challenge, scopes_json, resource,
                encrypted_homebox_key, homebox_user_id, expires_at, used_at
         FROM authorization_codes WHERE code_hash = ?`,
      )
      .get(codeHash) as
      | {
          code_hash: string;
          client_id: string;
          redirect_uri: string;
          code_challenge: string;
          scopes_json: string;
          resource: string | null;
          encrypted_homebox_key: string;
          homebox_user_id: string | null;
          expires_at: number;
          used_at: number | null;
        }
      | undefined;

    if (!row) {
      return undefined;
    }

    return {
      codeHash: row.code_hash,
      clientId: row.client_id,
      redirectUri: row.redirect_uri,
      codeChallenge: row.code_challenge,
      scopes: JSON.parse(row.scopes_json) as string[],
      resource: row.resource,
      encryptedHomeboxKey: row.encrypted_homebox_key,
      homeboxUserId: row.homebox_user_id,
      expiresAt: row.expires_at,
      usedAt: row.used_at,
    };
  }

  consumeAuthorizationCode(
    codeHash: string,
    clientId: string,
    now: number,
  ): boolean {
    const result = this.db
      .prepare(
        `UPDATE authorization_codes
         SET used_at = ?
         WHERE code_hash = ? AND client_id = ? AND used_at IS NULL AND expires_at > ?`,
      )
      .run(now, codeHash, clientId, now);
    return Number(result.changes) === 1;
  }

  createGrantWithTokens(params: {
    grantId: string;
    clientId: string;
    scopes: string[];
    resource: string | null;
    encryptedHomeboxKey: string;
    homeboxUserId: string | null;
    accessTokenHash: string;
    accessTokenExpiresAt: number;
    refreshTokenHash: string;
    refreshTokenExpiresAt: number;
    createdAt: number;
  }): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          `INSERT INTO oauth_grants (
            id, client_id, scopes_json, resource, encrypted_homebox_key, homebox_user_id, created_at, revoked_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
        )
        .run(
          params.grantId,
          params.clientId,
          JSON.stringify(params.scopes),
          params.resource,
          params.encryptedHomeboxKey,
          params.homeboxUserId,
          params.createdAt,
        );

      this.db
        .prepare(
          `INSERT INTO oauth_access_tokens (token_hash, grant_id, expires_at, revoked_at)
           VALUES (?, ?, ?, NULL)`,
        )
        .run(
          params.accessTokenHash,
          params.grantId,
          params.accessTokenExpiresAt,
        );

      this.db
        .prepare(
          `INSERT INTO oauth_refresh_tokens (token_hash, grant_id, expires_at, used_at, revoked_at)
           VALUES (?, ?, ?, NULL, NULL)`,
        )
        .run(
          params.refreshTokenHash,
          params.grantId,
          params.refreshTokenExpiresAt,
        );

      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  getActiveAccessToken(tokenHash: string, now: number):
    | {
        clientId: string;
        scopes: string[];
        expiresAt: number;
        encryptedHomeboxKey: string;
      }
    | undefined {
    const row = this.db
      .prepare(
        `SELECT g.client_id, g.scopes_json, t.expires_at, g.encrypted_homebox_key
         FROM oauth_access_tokens t
         JOIN oauth_grants g ON g.id = t.grant_id
         WHERE t.token_hash = ?
           AND t.revoked_at IS NULL
           AND g.revoked_at IS NULL
           AND t.expires_at > ?`,
      )
      .get(tokenHash, now) as
      | {
          client_id: string;
          scopes_json: string;
          expires_at: number;
          encrypted_homebox_key: string;
        }
      | undefined;

    if (!row) {
      return undefined;
    }

    return {
      clientId: row.client_id,
      scopes: JSON.parse(row.scopes_json) as string[],
      expiresAt: row.expires_at,
      encryptedHomeboxKey: row.encrypted_homebox_key,
    };
  }

  close(): void {
    this.db.close();
  }
}
