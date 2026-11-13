export interface HomeboxUserInfo {
  userId?: string;
  username?: string;
}

export class HomeboxApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "HomeboxApiError";
    this.status = status;
    this.body = body;
  }
}

export type HomeboxQueryValue =
  | string
  | number
  | boolean
  | readonly string[]
  | undefined;

export interface HomeboxRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  tenant?: string;
  query?: Record<string, HomeboxQueryValue>;
  body?: unknown;
}

/**
 * Authenticated HTTP client for the Homebox `/api/v1` REST API.
 */
export class HomeboxClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  async request<T = unknown>(
    path: string,
    options: HomeboxRequestOptions = {},
  ): Promise<T> {
    const url = new URL(path, this.baseUrl);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value === undefined) {
          continue;
        }
        if (Array.isArray(value)) {
          for (const item of value) {
            url.searchParams.append(key, String(item));
          }
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
    };
    if (options.tenant) {
      headers["X-Tenant"] = options.tenant;
    }
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const res = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    const text = await res.text();
    let parsed: unknown = undefined;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = text;
      }
    }

    if (!res.ok) {
      const detail =
        typeof parsed === "object" &&
        parsed !== null &&
        "error" in parsed &&
        typeof (parsed as { error?: unknown }).error === "string"
          ? (parsed as { error: string }).error
          : res.statusText || `HTTP ${res.status}`;
      throw new HomeboxApiError(
        res.status,
        `Homebox API error (${res.status}): ${detail}`,
        parsed,
      );
    }

    return parsed as T;
  }

  getCurrentUser(tenant?: string): Promise<unknown> {
    return this.request("/api/v1/users/self", { tenant });
  }

  listGroups(tenant?: string): Promise<unknown> {
    return this.request("/api/v1/groups/all", { tenant });
  }

  listEntities(
    params: {
      q?: string;
      page?: number;
      pageSize?: number;
      labels?: string[];
      locations?: string[];
      parentIds?: string[];
      entityType?: string;
      assetId?: string;
      orderBy?: string;
      includeArchived?: boolean;
      tenant?: string;
    } = {},
  ): Promise<unknown> {
    const { tenant, ...query } = params;
    return this.request("/api/v1/entities", { tenant, query });
  }

  getEntity(id: string, tenant?: string): Promise<unknown> {
    return this.request(`/api/v1/entities/${encodeURIComponent(id)}`, {
      tenant,
    });
  }

  createEntity(
    body: Record<string, unknown>,
    tenant?: string,
  ): Promise<unknown> {
    return this.request("/api/v1/entities", {
      method: "POST",
      body,
      tenant,
    });
  }

  updateEntity(
    id: string,
    body: Record<string, unknown>,
    tenant?: string,
  ): Promise<unknown> {
    return this.request(`/api/v1/entities/${encodeURIComponent(id)}`, {
      method: "PUT",
      body,
      tenant,
    });
  }

  patchEntity(
    id: string,
    body: Record<string, unknown>,
    tenant?: string,
  ): Promise<unknown> {
    return this.request(`/api/v1/entities/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body,
      tenant,
    });
  }

  deleteEntity(id: string, tenant?: string): Promise<unknown> {
    return this.request(`/api/v1/entities/${encodeURIComponent(id)}`, {
      method: "DELETE",
      tenant,
    });
  }

  getEntityTree(
    params: { withItems?: boolean; tenant?: string } = {},
  ): Promise<unknown> {
    const { tenant, ...query } = params;
    return this.request("/api/v1/entities/tree", { tenant, query });
  }

  getEntityPath(id: string, tenant?: string): Promise<unknown> {
    return this.request(`/api/v1/entities/${encodeURIComponent(id)}/path`, {
      tenant,
    });
  }

  getEntityFields(tenant?: string): Promise<unknown> {
    return this.request("/api/v1/entities/fields", { tenant });
  }

  getEntityFieldValues(
    params: { field?: string; tenant?: string } = {},
  ): Promise<unknown> {
    const { tenant, ...query } = params;
    return this.request("/api/v1/entities/fields/values", { tenant, query });
  }
}

export async function verifyHomeboxApiKey(
  homeboxUrl: string,
  apiKey: string,
): Promise<HomeboxUserInfo | null> {
  const url = new URL("/api/v1/users/self", homeboxUrl);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as {
      id?: string;
      username?: string;
      item?: { id?: string; username?: string };
    };
    return {
      userId: body.item?.id ?? body.id,
      username: body.item?.username ?? body.username,
    };
  } catch {
    return null;
  }
}

export type LoginAndMintResult =
  | { ok: true; apiKey: string }
  | { ok: false; status: number; message: string };

export async function loginAndMintHomeboxApiKey(
  homeboxUrl: string,
  params: { username: string; password: string; clientName: string },
): Promise<LoginAndMintResult> {
  const loginUrl = new URL("/api/v1/users/login", homeboxUrl);
  let sessionToken: string | undefined;

  try {
    const loginRes = await fetch(loginUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        username: params.username,
        password: params.password,
        stayLoggedIn: false,
      }),
    });

    if (!loginRes.ok) {
      if (loginRes.status === 401 || loginRes.status === 403) {
        return {
          ok: false,
          status: 401,
          message: "Invalid Homebox username or password.",
        };
      }
      return {
        ok: false,
        status: 502,
        message: "Homebox login failed. Please try again.",
      };
    }

    const loginBody = (await loginRes.json()) as { token?: string };
    const rawToken = loginBody.token?.trim();
    if (!rawToken) {
      return {
        ok: false,
        status: 502,
        message: "Homebox login did not return a session token.",
      };
    }
    sessionToken = rawToken.replace(/^Bearer\s+/i, "");
  } catch {
    return {
      ok: false,
      status: 502,
      message: "Unable to reach Homebox login service.",
    };
  }

  const mintUrl = new URL("/api/v1/users/self/api-keys", homeboxUrl);
  try {
    const mintRes = await fetch(mintUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        name: `homebox-mcp (${params.clientName})`,
      }),
    });

    if (!mintRes.ok) {
      return {
        ok: false,
        status: 502,
        message: "Authenticated with Homebox, but failed to mint an API key.",
      };
    }

    const mintBody = (await mintRes.json()) as {
      key?: string;
      token?: string;
      item?: { key?: string; token?: string };
    };
    const apiKey = (
      mintBody.key ??
      mintBody.token ??
      mintBody.item?.key ??
      mintBody.item?.token
    )?.trim();

    if (!apiKey) {
      return {
        ok: false,
        status: 502,
        message: "Homebox did not return a minted API key.",
      };
    }

    return { ok: true, apiKey };
  } catch {
    return {
      ok: false,
      status: 502,
      message: "Unable to reach Homebox API key service.",
    };
  }
}
