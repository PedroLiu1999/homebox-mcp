import type { Request, Response } from "express";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import {
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidTokenError,
  ServerError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  encryptSecret,
  generateOpaqueToken,
  hashToken,
  timingSafeEqualStrings,
} from "../crypto.js";
import {
  loginAndMintHomeboxApiKey,
  verifyHomeboxApiKey,
} from "../homebox/client.js";
import type { SqliteStore } from "../storage/sqlite.js";
import { renderAuthorizePage } from "./authorize-page.js";

const PENDING_AUTH_TTL_SECONDS = 600;
const AUTH_CODE_TTL_SECONDS = 300;
const ACCESS_TOKEN_TTL_SECONDS = 3600;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 3600;

const DISALLOWED_REDIRECT_SCHEMES = new Set([
  "javascript:",
  "data:",
  "vbscript:",
  "file:",
]);

function validateRedirectUris(redirectUris: string[]): void {
  if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
    throw new InvalidClientMetadataError(
      "redirect_uris must be a non-empty array",
    );
  }
  for (const uri of redirectUris) {
    let parsed: URL;
    try {
      parsed = new URL(uri);
    } catch {
      throw new InvalidClientMetadataError(`Invalid redirect_uri: ${uri}`);
    }
    if (DISALLOWED_REDIRECT_SCHEMES.has(parsed.protocol.toLowerCase())) {
      throw new InvalidClientMetadataError(
        `Disallowed redirect_uri scheme: ${parsed.protocol}`,
      );
    }
  }
}

export interface HomeboxOAuthProviderOptions {
  store: SqliteStore;
  homeboxUrl: string;
  encryptionKey: Buffer;
}

export class HomeboxOAuthProvider implements OAuthServerProvider {
  readonly clientsStore: OAuthRegisteredClientsStore;
  private readonly store: SqliteStore;
  private readonly homeboxUrl: string;
  private readonly encryptionKey: Buffer;

  constructor(options: HomeboxOAuthProviderOptions) {
    this.store = options.store;
    this.homeboxUrl = options.homeboxUrl;
    this.encryptionKey = options.encryptionKey;
    this.clientsStore = {
      getClient: async (
        clientId: string,
      ): Promise<OAuthClientInformationFull | undefined> => {
        return this.store.getClient(clientId);
      },
      registerClient: async (
        client: OAuthClientInformationFull,
      ): Promise<OAuthClientInformationFull> => {
        validateRedirectUris(client.redirect_uris);
        return this.store.saveClient(client);
      },
    };
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    const requestId = generateOpaqueToken(24);
    const csrfToken = generateOpaqueToken(24);
    const now = Math.floor(Date.now() / 1000);

    this.store.savePendingAuthRequest({
      requestId,
      csrfToken,
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      state: params.state ?? null,
      scopes: params.scopes ?? [],
      resource: params.resource?.href ?? null,
      expiresAt: now + PENDING_AUTH_TTL_SECONDS,
    });

    const html = renderAuthorizePage({
      requestId,
      csrfToken,
      clientName: client.client_name ?? client.client_id,
      scopes: params.scopes ?? [],
    });

    res.status(200).type("html").send(html);
  }

  async handleAuthorizeLogin(req: Request, res: Response): Promise<void> {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const requestId =
      typeof body.request_id === "string" ? body.request_id : "";
    const csrfToken =
      typeof body.csrf_token === "string" ? body.csrf_token : "";

    if (!requestId || !csrfToken) {
      res.status(403).type("text/plain").send("Missing CSRF or request token");
      return;
    }

    const pending = this.store.getPendingAuthRequest(requestId);
    const now = Math.floor(Date.now() / 1000);
    if (
      !pending ||
      pending.expiresAt <= now ||
      !timingSafeEqualStrings(pending.csrfToken, csrfToken)
    ) {
      res.status(403).type("text/plain").send("Invalid or expired CSRF token");
      return;
    }

    const client = this.store.getClient(pending.clientId);
    const clientName = client?.client_name ?? pending.clientId;
    const rawApiKey =
      typeof body.api_key === "string" ? body.api_key.trim() : "";
    const username =
      typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    const sendError = (status: number, errorMessage: string): void => {
      const html = renderAuthorizePage({
        requestId: pending.requestId,
        csrfToken: pending.csrfToken,
        clientName,
        scopes: pending.scopes,
        errorMessage,
      });
      res.status(status).type("html").send(html);
    };

    let resolvedApiKey: string;
    let homeboxUserId: string | null = null;

    if (rawApiKey) {
      if (!rawApiKey.startsWith("hb_")) {
        sendError(400, "Please enter a valid Homebox API key (starts with hb_).");
        return;
      }

      const userInfo = await verifyHomeboxApiKey(this.homeboxUrl, rawApiKey);
      if (!userInfo) {
        sendError(401, "Invalid Homebox API key. Verification failed.");
        return;
      }

      resolvedApiKey = rawApiKey;
      homeboxUserId = userInfo.userId ?? null;
    } else if (username && password) {
      const mintResult = await loginAndMintHomeboxApiKey(this.homeboxUrl, {
        username,
        password,
        clientName,
      });
      if (!mintResult.ok) {
        sendError(mintResult.status, mintResult.message);
        return;
      }

      resolvedApiKey = mintResult.apiKey;
    } else {
      sendError(
        400,
        "Please enter your Homebox username and password, or a valid Homebox API key (starts with hb_).",
      );
      return;
    }

    this.store.deletePendingAuthRequest(pending.requestId);

    const code = generateOpaqueToken(32);
    const encryptedHomeboxKey = encryptSecret(
      resolvedApiKey,
      this.encryptionKey,
    );
    this.store.saveAuthorizationCode({
      codeHash: hashToken(code),
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
      codeChallenge: pending.codeChallenge,
      scopes: pending.scopes,
      resource: pending.resource,
      encryptedHomeboxKey,
      homeboxUserId,
      expiresAt: now + AUTH_CODE_TTL_SECONDS,
    });

    const redirectUrl = new URL(pending.redirectUri);
    redirectUrl.searchParams.set("code", code);
    if (pending.state) {
      redirectUrl.searchParams.set("state", pending.state);
    }
    res.redirect(302, redirectUrl.href);
  }

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const record = this.store.getAuthorizationCode(hashToken(authorizationCode));
    const now = Math.floor(Date.now() / 1000);
    if (
      !record ||
      record.clientId !== client.client_id ||
      record.usedAt !== null ||
      record.expiresAt <= now
    ) {
      throw new InvalidGrantError("Invalid or expired authorization code");
    }
    return record.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
  ): Promise<OAuthTokens> {
    const codeHash = hashToken(authorizationCode);
    const record = this.store.getAuthorizationCode(codeHash);
    const now = Math.floor(Date.now() / 1000);

    if (
      !record ||
      record.clientId !== client.client_id ||
      record.usedAt !== null ||
      record.expiresAt <= now
    ) {
      throw new InvalidGrantError("Invalid or expired authorization code");
    }

    if (redirectUri !== undefined && redirectUri !== record.redirectUri) {
      throw new InvalidGrantError("redirect_uri mismatch");
    }

    const consumed = this.store.consumeAuthorizationCode(
      codeHash,
      client.client_id,
      now,
    );
    if (!consumed) {
      throw new InvalidGrantError("Authorization code already used or expired");
    }

    const grantId = generateOpaqueToken(24);
    const accessToken = generateOpaqueToken(32);
    const refreshToken = generateOpaqueToken(32);

    this.store.createGrantWithTokens({
      grantId,
      clientId: client.client_id,
      scopes: record.scopes,
      resource: record.resource,
      encryptedHomeboxKey: record.encryptedHomeboxKey,
      homeboxUserId: record.homeboxUserId,
      accessTokenHash: hashToken(accessToken),
      accessTokenExpiresAt: now + ACCESS_TOKEN_TTL_SECONDS,
      refreshTokenHash: hashToken(refreshToken),
      refreshTokenExpiresAt: now + REFRESH_TOKEN_TTL_SECONDS,
      createdAt: now,
    });

    return {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
      ...(record.scopes.length > 0 ? { scope: record.scopes.join(" ") } : {}),
    };
  }

  async exchangeRefreshToken(
    _client: OAuthClientInformationFull,
    _refreshToken: string,
  ): Promise<OAuthTokens> {
    throw new ServerError("Refresh token exchange not yet implemented");
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const now = Math.floor(Date.now() / 1000);
    const active = this.store.getActiveAccessToken(hashToken(token), now);
    if (!active) {
      throw new InvalidTokenError("Invalid or expired access token");
    }
    return {
      token,
      clientId: active.clientId,
      scopes: active.scopes,
      expiresAt: active.expiresAt,
    };
  }

  async revokeToken(
    _client: OAuthClientInformationFull,
    _request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    throw new ServerError("Token revocation not yet implemented");
  }
}
