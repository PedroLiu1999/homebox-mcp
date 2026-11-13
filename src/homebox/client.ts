import type {
  HomeboxBillOfMaterialsReport,
  HomeboxCreateItemFromTemplateRequest,
  HomeboxEntity,
  HomeboxEntityCreateRequest,
  HomeboxEntityListParams,
  HomeboxEntityListResponse,
  HomeboxEntityPatchRequest,
  HomeboxEntityPathNode,
  HomeboxEntityTreeNode,
  HomeboxEntityType,
  HomeboxEntityTypeUpsertRequest,
  HomeboxEntityUpdateRequest,
  HomeboxFieldValueEntry,
  HomeboxGroupListResponse,
  HomeboxGroupStatistics,
  HomeboxMaintenanceEntry,
  HomeboxMaintenanceStatus,
  HomeboxMaintenanceUpsertRequest,
  HomeboxStatus,
  HomeboxTag,
  HomeboxTagUpsertRequest,
  HomeboxTemplate,
  HomeboxTemplateUpsertRequest,
  HomeboxUserSelfResponse,
} from "./types.js";

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

  getStatus(tenant?: string): Promise<HomeboxStatus> {
    return this.request<HomeboxStatus>("/api/v1/status", { tenant });
  }

  getCurrentUser(tenant?: string): Promise<HomeboxUserSelfResponse> {
    return this.request<HomeboxUserSelfResponse>("/api/v1/users/self", {
      tenant,
    });
  }

  listGroups(tenant?: string): Promise<HomeboxGroupListResponse> {
    return this.request<HomeboxGroupListResponse>("/api/v1/groups/all", {
      tenant,
    });
  }

  getGroupStatistics(tenant?: string): Promise<HomeboxGroupStatistics> {
    return this.request<HomeboxGroupStatistics>("/api/v1/groups/statistics", {
      tenant,
    });
  }

  listEntities(
    params: HomeboxEntityListParams = {},
  ): Promise<HomeboxEntityListResponse> {
    const { tenant, ...query } = params;
    return this.request<HomeboxEntityListResponse>("/api/v1/entities", {
      tenant,
      query,
    });
  }

  getEntity(id: string, tenant?: string): Promise<HomeboxEntity> {
    return this.request<HomeboxEntity>(
      `/api/v1/entities/${encodeURIComponent(id)}`,
      {
        tenant,
      },
    );
  }

  createEntity(
    body: HomeboxEntityCreateRequest,
    tenant?: string,
  ): Promise<HomeboxEntity> {
    return this.request<HomeboxEntity>("/api/v1/entities", {
      method: "POST",
      body,
      tenant,
    });
  }

  updateEntity(
    id: string,
    body: HomeboxEntityUpdateRequest,
    tenant?: string,
  ): Promise<HomeboxEntity> {
    return this.request<HomeboxEntity>(
      `/api/v1/entities/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        body,
        tenant,
      },
    );
  }

  patchEntity(
    id: string,
    body: HomeboxEntityPatchRequest,
    tenant?: string,
  ): Promise<HomeboxEntity> {
    return this.request<HomeboxEntity>(
      `/api/v1/entities/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        body,
        tenant,
      },
    );
  }

  deleteEntity(id: string, tenant?: string): Promise<void> {
    return this.request<void>(`/api/v1/entities/${encodeURIComponent(id)}`, {
      method: "DELETE",
      tenant,
    });
  }

  getEntityTree(
    params: { withItems?: boolean; tenant?: string } = {},
  ): Promise<HomeboxEntityTreeNode[]> {
    const { tenant, ...query } = params;
    return this.request<HomeboxEntityTreeNode[]>("/api/v1/entities/tree", {
      tenant,
      query,
    });
  }

  getEntityPath(id: string, tenant?: string): Promise<HomeboxEntityPathNode[]> {
    return this.request<HomeboxEntityPathNode[]>(
      `/api/v1/entities/${encodeURIComponent(id)}/path`,
      {
        tenant,
      },
    );
  }

  getEntityFields(tenant?: string): Promise<string[]> {
    return this.request<string[]>("/api/v1/entities/fields", { tenant });
  }

  getEntityFieldValues(
    params: { field?: string; tenant?: string } = {},
  ): Promise<HomeboxFieldValueEntry[] | string[]> {
    const { tenant, ...query } = params;
    return this.request<HomeboxFieldValueEntry[] | string[]>(
      "/api/v1/entities/fields/values",
      { tenant, query },
    );
  }

  listTags(tenant?: string): Promise<HomeboxTag[]> {
    return this.request<HomeboxTag[]>("/api/v1/tags", { tenant });
  }

  getTag(id: string, tenant?: string): Promise<HomeboxTag> {
    return this.request<HomeboxTag>(
      `/api/v1/tags/${encodeURIComponent(id)}`,
      { tenant },
    );
  }

  createTag(
    body: HomeboxTagUpsertRequest,
    tenant?: string,
  ): Promise<HomeboxTag> {
    return this.request<HomeboxTag>("/api/v1/tags", {
      method: "POST",
      tenant,
      body,
    });
  }

  updateTag(
    id: string,
    body: HomeboxTagUpsertRequest,
    tenant?: string,
  ): Promise<HomeboxTag> {
    return this.request<HomeboxTag>(`/api/v1/tags/${encodeURIComponent(id)}`, {
      method: "PUT",
      tenant,
      body,
    });
  }

  deleteTag(id: string, tenant?: string): Promise<void> {
    return this.request<void>(`/api/v1/tags/${encodeURIComponent(id)}`, {
      method: "DELETE",
      tenant,
    });
  }

  listEntityTypes(tenant?: string): Promise<HomeboxEntityType[]> {
    return this.request<HomeboxEntityType[]>("/api/v1/entity-types", {
      tenant,
    });
  }

  createEntityType(
    body: HomeboxEntityTypeUpsertRequest,
    tenant?: string,
  ): Promise<HomeboxEntityType> {
    return this.request<HomeboxEntityType>("/api/v1/entity-types", {
      method: "POST",
      tenant,
      body,
    });
  }

  updateEntityType(
    id: string,
    body: HomeboxEntityTypeUpsertRequest,
    tenant?: string,
  ): Promise<HomeboxEntityType> {
    return this.request<HomeboxEntityType>(
      `/api/v1/entity-types/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        tenant,
        body,
      },
    );
  }

  deleteEntityType(id: string, tenant?: string): Promise<void> {
    return this.request<void>(
      `/api/v1/entity-types/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        tenant,
      },
    );
  }

  listTemplates(tenant?: string): Promise<HomeboxTemplate[]> {
    return this.request<HomeboxTemplate[]>("/api/v1/templates", { tenant });
  }

  getTemplate(id: string, tenant?: string): Promise<HomeboxTemplate> {
    return this.request<HomeboxTemplate>(
      `/api/v1/templates/${encodeURIComponent(id)}`,
      { tenant },
    );
  }

  createTemplate(
    body: HomeboxTemplateUpsertRequest,
    tenant?: string,
  ): Promise<HomeboxTemplate> {
    return this.request<HomeboxTemplate>("/api/v1/templates", {
      method: "POST",
      tenant,
      body,
    });
  }

  updateTemplate(
    id: string,
    body: HomeboxTemplateUpsertRequest,
    tenant?: string,
  ): Promise<HomeboxTemplate> {
    return this.request<HomeboxTemplate>(
      `/api/v1/templates/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        tenant,
        body,
      },
    );
  }

  deleteTemplate(id: string, tenant?: string): Promise<void> {
    return this.request<void>(`/api/v1/templates/${encodeURIComponent(id)}`, {
      method: "DELETE",
      tenant,
    });
  }

  createItemFromTemplate(
    id: string,
    body: HomeboxCreateItemFromTemplateRequest,
    tenant?: string,
  ): Promise<HomeboxEntity> {
    return this.request<HomeboxEntity>(
      `/api/v1/templates/${encodeURIComponent(id)}/create-item`,
      {
        method: "POST",
        tenant,
        body,
      },
    );
  }

  listMaintenance(
    params: { status?: HomeboxMaintenanceStatus; tenant?: string } = {},
  ): Promise<HomeboxMaintenanceEntry[]> {
    const { tenant, status } = params;
    return this.request<HomeboxMaintenanceEntry[]>("/api/v1/maintenance", {
      tenant,
      query: status ? { status } : undefined,
    });
  }

  listEntityMaintenance(
    entityId: string,
    params: { status?: HomeboxMaintenanceStatus; tenant?: string } = {},
  ): Promise<HomeboxMaintenanceEntry[]> {
    const { tenant, status } = params;
    return this.request<HomeboxMaintenanceEntry[]>(
      `/api/v1/entities/${encodeURIComponent(entityId)}/maintenance`,
      {
        tenant,
        query: status ? { status } : undefined,
      },
    );
  }

  createEntityMaintenance(
    entityId: string,
    body: HomeboxMaintenanceUpsertRequest,
    tenant?: string,
  ): Promise<HomeboxMaintenanceEntry> {
    return this.request<HomeboxMaintenanceEntry>(
      `/api/v1/entities/${encodeURIComponent(entityId)}/maintenance`,
      {
        method: "POST",
        tenant,
        body,
      },
    );
  }

  updateMaintenance(
    id: string,
    body: HomeboxMaintenanceUpsertRequest,
    tenant?: string,
  ): Promise<HomeboxMaintenanceEntry> {
    return this.request<HomeboxMaintenanceEntry>(
      `/api/v1/maintenance/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        tenant,
        body,
      },
    );
  }

  deleteMaintenance(id: string, tenant?: string): Promise<void> {
    return this.request<void>(
      `/api/v1/maintenance/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        tenant,
      },
    );
  }

  getBillOfMaterials(tenant?: string): Promise<HomeboxBillOfMaterialsReport> {
    return this.request<HomeboxBillOfMaterialsReport>(
      "/api/v1/reporting/bill-of-materials",
      { tenant },
    );
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
