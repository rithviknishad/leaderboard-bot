import { describe, it, expect, vi, beforeEach } from "vitest";
import worker, { Env } from "./index";

describe("Leaderboard Bot Worker", () => {
  let env: Env;
  const WEBHOOK_SECRET = "test-webhook-secret";

  // Helper function to generate valid GitHub webhook signature
  async function generateSignature(
    payload: string,
    secret: string
  ): Promise<string> {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const signatureBytes = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(payload)
    );

    const hash = Array.from(new Uint8Array(signatureBytes))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return `sha256=${hash}`;
  }

  beforeEach(() => {
    env = {
      AUTOMATION_REPO_TRIGGER_TOKEN: "test-token-123",
      GITHUB_WEBHOOK_SECRET: WEBHOOK_SECRET,
    };
    vi.clearAllMocks();
  });

  it('should return "ok" for GET requests', async () => {
    const request = new Request("https://example.com", {
      method: "GET",
    });

    const response = await worker.fetch(request, env);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toBe("ok");
  });

  it("should return 400 if x-github-event header is missing", async () => {
    const request = new Request("https://example.com", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const response = await worker.fetch(request, env);
    const text = await response.text();

    expect(response.status).toBe(400);
    expect(text).toBe("missing x-github-event header");
  });

  it("should return 401 if x-hub-signature-256 header is missing", async () => {
    const request = new Request("https://example.com", {
      method: "POST",
      headers: {
        "x-github-event": "installation",
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });

    const response = await worker.fetch(request, env);
    const text = await response.text();

    expect(response.status).toBe(401);
    expect(text).toBe("missing x-hub-signature-256 header");
  });

  it("should return 401 if signature is invalid", async () => {
    const payload = JSON.stringify({ action: "created" });

    const request = new Request("https://example.com", {
      method: "POST",
      headers: {
        "x-github-event": "installation",
        "x-hub-signature-256": "sha256=invalid-signature",
        "content-type": "application/json",
      },
      body: payload,
    });

    const response = await worker.fetch(request, env);
    const text = await response.text();

    expect(response.status).toBe(401);
    expect(text).toBe("invalid signature");
  });

  it("should ignore non-installation events", async () => {
    const payload = JSON.stringify({ ref: "refs/heads/main" });
    const signature = await generateSignature(payload, WEBHOOK_SECRET);

    const request = new Request("https://example.com", {
      method: "POST",
      headers: {
        "x-github-event": "push",
        "x-hub-signature-256": signature,
        "content-type": "application/json",
      },
      body: payload,
    });

    const response = await worker.fetch(request, env);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toBe("event ignored");
  });

  it("should dispatch installation events to GitHub API", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    global.fetch = mockFetch;

    const installationPayload = {
      action: "created",
      installation: {
        id: 12345,
        account: {
          login: "test-org",
          type: "Organization",
        },
      },
      repositories: [
        {
          id: 1,
          name: "test-repo",
          full_name: "test-org/test-repo",
        },
      ],
    };

    const payload = JSON.stringify(installationPayload);
    const signature = await generateSignature(payload, WEBHOOK_SECRET);

    const request = new Request("https://example.com", {
      method: "POST",
      headers: {
        "x-github-event": "installation",
        "x-hub-signature-256": signature,
        "content-type": "application/json",
      },
      body: payload,
    });

    const response = await worker.fetch(request, env);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toBe("dispatched: 204");

    // Verify the fetch call to GitHub API
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/ohcnetwork/leaderboard-bot/dispatches",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "token test-token-123",
          accept: "application/vnd.github+json",
          "content-type": "application/json",
        }),
      })
    );

    // Verify the dispatch payload
    const callArgs = mockFetch.mock.calls[0];
    const dispatchBody = JSON.parse(callArgs[1].body as string);
    expect(dispatchBody).toEqual({
      event_type: "leaderboard-bot-installed",
      client_payload: {
        github_event: "installation",
        payload: installationPayload,
      },
    });
  });

  it("should handle installation_repositories events", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    global.fetch = mockFetch;

    const installationRepoPayload = {
      action: "added",
      installation: {
        id: 12345,
        account: {
          login: "test-org",
          type: "Organization",
        },
      },
      repositories_added: [
        {
          id: 2,
          name: "new-repo",
          full_name: "test-org/new-repo",
        },
      ],
    };

    const payload = JSON.stringify(installationRepoPayload);
    const signature = await generateSignature(payload, WEBHOOK_SECRET);

    const request = new Request("https://example.com", {
      method: "POST",
      headers: {
        "x-github-event": "installation_repositories",
        "x-hub-signature-256": signature,
        "content-type": "application/json",
      },
      body: payload,
    });

    const response = await worker.fetch(request, env);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toBe("dispatched: 204");
    expect(mockFetch).toHaveBeenCalled();
  });

  it("should return 500 if AUTOMATION_REPO_TRIGGER_TOKEN is missing", async () => {
    const emptyEnv: Env = {
      AUTOMATION_REPO_TRIGGER_TOKEN: "",
      GITHUB_WEBHOOK_SECRET: WEBHOOK_SECRET,
    };

    const payload = JSON.stringify({ action: "created" });
    const signature = await generateSignature(payload, WEBHOOK_SECRET);

    const request = new Request("https://example.com", {
      method: "POST",
      headers: {
        "x-github-event": "installation",
        "x-hub-signature-256": signature,
        "content-type": "application/json",
      },
      body: payload,
    });

    const response = await worker.fetch(request, emptyEnv);
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).toBe("missing AUTOMATION_REPO_TRIGGER_TOKEN");
  });

  it("should handle GitHub API errors gracefully", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    global.fetch = mockFetch;

    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const payload = JSON.stringify({ action: "created" });
    const signature = await generateSignature(payload, WEBHOOK_SECRET);

    const request = new Request("https://example.com", {
      method: "POST",
      headers: {
        "x-github-event": "installation",
        "x-hub-signature-256": signature,
        "content-type": "application/json",
      },
      body: payload,
    });

    const response = await worker.fetch(request, env);
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).toBe("dispatch failed: 401");
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("should return 401 if GITHUB_WEBHOOK_SECRET is not configured", async () => {
    const envWithoutSecret: Env = {
      AUTOMATION_REPO_TRIGGER_TOKEN: "test-token-123",
      GITHUB_WEBHOOK_SECRET: "",
    };

    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const payload = JSON.stringify({ action: "created" });

    const request = new Request("https://example.com", {
      method: "POST",
      headers: {
        "x-github-event": "installation",
        "x-hub-signature-256": "sha256=somehash",
        "content-type": "application/json",
      },
      body: payload,
    });

    const response = await worker.fetch(request, envWithoutSecret);
    const text = await response.text();

    expect(response.status).toBe(401);
    expect(text).toBe("invalid signature");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "GITHUB_WEBHOOK_SECRET is not configured"
    );

    consoleErrorSpy.mockRestore();
  });
});
