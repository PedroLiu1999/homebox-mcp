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

export interface HomeboxRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  tenant?: string;
  query?: Record<string, string | number | boolean | undefined>;
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
        if (value !== undefined) {
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
