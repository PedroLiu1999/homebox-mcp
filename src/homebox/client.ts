export interface HomeboxUserInfo {
  userId?: string;
  username?: string;
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
