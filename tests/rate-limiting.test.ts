import { afterEach, describe, expect, it } from "vitest";
import { startTestServer, type TestHarness } from "./helpers/test-server.js";

describe("Per-IP rate limiting", () => {
  let harness: TestHarness | undefined;

  afterEach(async () => {
    if (harness) {
      await harness.close();
      harness = undefined;
    }
  });

  it("rate-limits POST /authorize/login to 10 requests per 15 minutes per IP with 429 and standard headers, isolating by X-Forwarded-For", async () => {
    harness = await startTestServer();

    const sendLogin = (ip: string) =>
      fetch(`${harness!.baseUrl}/authorize/login`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-forwarded-for": ip,
        },
        body: new URLSearchParams({
          request_id: "nonexistent",
          csrf_token: "invalid",
          api_key: "hb_test",
        }),
      });

    for (let i = 0; i < 10; i++) {
      const res = await sendLogin("203.0.113.10");
      expect(res.status).not.toBe(429);
      expect(res.headers.get("ratelimit")).toBeTruthy();
      expect(res.headers.get("ratelimit-policy")).toBeTruthy();
      expect(res.headers.get("x-ratelimit-limit")).toBeNull();
    }

    const blocked = await sendLogin("203.0.113.10");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("ratelimit")).toBeTruthy();
    expect(blocked.headers.get("ratelimit-policy")).toBeTruthy();

    // Different client IP should have its own quota
    const otherIp = await sendLogin("203.0.113.11");
    expect(otherIp.status).not.toBe(429);
  });

  it("rate-limits /register to 10 requests per hour per IP with 429 and standard headers, isolating by X-Forwarded-For", async () => {
    harness = await startTestServer();

    const sendRegister = (ip: string) =>
      fetch(`${harness!.baseUrl}/register`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": ip,
        },
        body: JSON.stringify({
          client_name: "Rate Limit Test Client",
          redirect_uris: ["http://127.0.0.1:9999/callback"],
          token_endpoint_auth_method: "none",
        }),
      });

    for (let i = 0; i < 10; i++) {
      const res = await sendRegister("198.51.100.1");
      expect(res.status).not.toBe(429);
      expect(res.headers.get("ratelimit")).toBeTruthy();
      expect(res.headers.get("ratelimit-policy")).toContain("q=10; w=3600");
    }

    const blocked = await sendRegister("198.51.100.1");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("ratelimit")).toBeTruthy();

    const otherIp = await sendRegister("198.51.100.2");
    expect(otherIp.status).not.toBe(429);
  });

  it("rate-limits /token to 30 requests per 15 minutes per IP with 429 and standard headers, isolating by X-Forwarded-For", async () => {
    harness = await startTestServer();

    const sendToken = (ip: string) =>
      fetch(`${harness!.baseUrl}/token`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-forwarded-for": ip,
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: "nonexistent",
          code: "invalid",
          code_verifier: "invalid",
        }),
      });

    for (let i = 0; i < 30; i++) {
      const res = await sendToken("192.0.2.10");
      expect(res.status).not.toBe(429);
      expect(res.headers.get("ratelimit")).toBeTruthy();
      expect(res.headers.get("ratelimit-policy")).toContain("q=30; w=900");
    }

    const blocked = await sendToken("192.0.2.10");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("ratelimit")).toBeTruthy();

    const otherIp = await sendToken("192.0.2.11");
    expect(otherIp.status).not.toBe(429);
  });

  it("rate-limits /mcp to 120 requests per minute per IP with 429 and standard headers, isolating by X-Forwarded-For", async () => {
    harness = await startTestServer();

    const sendMcp = (ip: string) =>
      fetch(`${harness!.baseUrl}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": ip,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      });

    for (let i = 0; i < 120; i++) {
      const res = await sendMcp("203.0.113.50");
      expect(res.status).not.toBe(429);
      expect(res.headers.get("ratelimit")).toBeTruthy();
      expect(res.headers.get("ratelimit-policy")).toContain("q=120; w=60");
    }

    const blocked = await sendMcp("203.0.113.50");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("ratelimit")).toBeTruthy();

    const otherIp = await sendMcp("203.0.113.51");
    expect(otherIp.status).not.toBe(429);
  });

  it("exempts /health from rate limiting", async () => {
    harness = await startTestServer();

    for (let i = 0; i < 150; i++) {
      const res = await fetch(`${harness.baseUrl}/health`, {
        headers: { "x-forwarded-for": "203.0.113.99" },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("ratelimit")).toBeNull();
      expect(res.headers.get("ratelimit-policy")).toBeNull();
    }
  });
});
