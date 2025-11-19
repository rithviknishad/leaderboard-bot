/**
 * Cloudflare Worker for handling GitHub App webhook events
 * Forwards installation events to the automation repository
 */

export interface Env {
  AUTOMATION_REPO_TRIGGER_TOKEN: string;
  GITHUB_WEBHOOK_SECRET: string;
}

interface GitHubInstallationPayload {
  action?: string;
  installation?: {
    id: number;
    account: {
      login: string;
      type: string;
    };
  };
  repositories?: Array<{
    id: number;
    name: string;
    full_name: string;
  }>;
  repositories_added?: Array<{
    id: number;
    name: string;
    full_name: string;
  }>;
  repositories_removed?: Array<{
    id: number;
    name: string;
    full_name: string;
  }>;
}

interface DispatchPayload {
  event_type: string;
  client_payload: {
    github_event: string;
    payload: GitHubInstallationPayload;
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env);
  },
};

/**
 * Verify GitHub webhook signature using HMAC-SHA256
 * @param payload - The raw request body
 * @param signature - The x-hub-signature-256 header value (format: "sha256=<hash>")
 * @param secret - The webhook secret configured in GitHub App settings
 * @returns true if signature is valid, false otherwise
 */
async function verifySignature(
  payload: string,
  signature: string,
  secret: string
): Promise<boolean> {
  if (!secret) {
    console.error("GITHUB_WEBHOOK_SECRET is not configured");
    return false;
  }

  // GitHub sends signature as "sha256=<hash>"
  const signatureHash = signature.replace("sha256=", "");

  // Create HMAC-SHA256 hash of the payload using the secret
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

  // Convert to hex string
  const computedHash = Array.from(new Uint8Array(signatureBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Constant-time comparison to prevent timing attacks
  return timingSafeEqual(computedHash, signatureHash);
}

/**
 * Timing-safe string comparison to prevent timing attacks
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

async function handle(req: Request, env: Env): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("ok");
  }

  const body = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  const event = req.headers.get("x-github-event");

  if (!event) {
    return new Response("missing x-github-event header", { status: 400 });
  }

  // Verify webhook signature
  if (!signature) {
    return new Response("missing x-hub-signature-256 header", { status: 401 });
  }

  const isValid = await verifySignature(
    body,
    signature,
    env.GITHUB_WEBHOOK_SECRET
  );
  if (!isValid) {
    return new Response("invalid signature", { status: 401 });
  }

  // Only handle installation.created or installation_repositories.added
  const payload: GitHubInstallationPayload = JSON.parse(body);
  if (!["installation", "installation_repositories"].includes(event)) {
    return new Response("event ignored", { status: 200 });
  }

  // Example: forward to automation repo as repository_dispatch
  // AUTOMATION_REPO_TRIGGER_TOKEN must be stored in worker secrets
  const token = env.AUTOMATION_REPO_TRIGGER_TOKEN;

  if (!token) {
    return new Response("missing AUTOMATION_REPO_TRIGGER_TOKEN", {
      status: 500,
    });
  }

  // Build dispatch payload with relevant info
  const dispatchBody: DispatchPayload = {
    event_type: "leaderboard-bot-installed",
    client_payload: {
      github_event: event,
      payload: payload,
    },
  };

  // POST to the automation repo's dispatch endpoint
  const owner = "rithviknishad";
  const repo = "leaderboard-bot";
  const url = `https://api.github.com/repos/${owner}/${repo}/dispatches`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `token ${token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": "leaderboard-bot-worker",
    },
    body: JSON.stringify(dispatchBody),
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    console.error(`GitHub API error: ${resp.status} - ${errorText}`);
    return new Response(`dispatch failed: ${resp.status}`, { status: 500 });
  }

  return new Response(`dispatched: ${resp.status}`, { status: 200 });
}
