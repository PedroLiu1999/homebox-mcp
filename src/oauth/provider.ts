import type { Response } from "express";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import {
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
  OAuthClientMetadata,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

export class HomeboxOAuthProvider implements OAuthServerProvider {
  readonly clientsStore: OAuthRegisteredClientsStore = {
    async getClient(_clientId: string): Promise<OAuthClientInformationFull | undefined> {
      return undefined;
    },
    async registerClient(
      _client: OAuthClientMetadata,
    ): Promise<OAuthClientInformationFull> {
      throw new ServerError("Dynamic client registration not yet implemented");
    },
  };

  async authorize(
    _client: OAuthClientInformationFull,
    _params: AuthorizationParams,
    _res: Response,
  ): Promise<void> {
    throw new ServerError("Authorization not yet implemented");
  }

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    _authorizationCode: string,
  ): Promise<string> {
    throw new ServerError("Authorization code challenge not yet implemented");
  }

  async exchangeAuthorizationCode(
    _client: OAuthClientInformationFull,
    _authorizationCode: string,
  ): Promise<OAuthTokens> {
    throw new ServerError("Token exchange not yet implemented");
  }

  async exchangeRefreshToken(
    _client: OAuthClientInformationFull,
    _refreshToken: string,
  ): Promise<OAuthTokens> {
    throw new ServerError("Refresh token exchange not yet implemented");
  }

  async verifyAccessToken(_token: string): Promise<AuthInfo> {
    throw new InvalidTokenError("Invalid or unknown access token");
  }

  async revokeToken(
    _client: OAuthClientInformationFull,
    _request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    throw new ServerError("Token revocation not yet implemented");
  }
}
