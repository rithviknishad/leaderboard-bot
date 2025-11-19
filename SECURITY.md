# Security

This document outlines the security measures implemented in the Leaderboard Bot Cloudflare Worker.

## Webhook Signature Verification

The worker implements **HMAC-SHA256 signature verification** for all incoming GitHub webhook requests. This ensures that only authentic requests from GitHub are processed.

### How It Works

1. **GitHub Signs the Request**: When GitHub sends a webhook, it includes an `X-Hub-Signature-256` header containing an HMAC-SHA256 hash of the request body, computed using your webhook secret.

2. **Worker Verifies the Signature**: The worker:
   - Extracts the signature from the `X-Hub-Signature-256` header
   - Computes its own HMAC-SHA256 hash of the request body using the configured secret
   - Compares the two hashes using a timing-safe comparison to prevent timing attacks
   - Rejects the request if signatures don't match

3. **Request Processing**: Only requests with valid signatures are processed further.

### Implementation Details

```typescript
// Signature format: "sha256=<hex-encoded-hash>"
const signature = req.headers.get('x-hub-signature-256');

// Verify using Web Crypto API
const isValid = await verifySignature(body, signature, env.GITHUB_WEBHOOK_SECRET);
```

### Security Features

- **HMAC-SHA256**: Industry-standard cryptographic hash function
- **Timing-Safe Comparison**: Prevents timing attacks by comparing hashes in constant time
- **Web Crypto API**: Uses Cloudflare's built-in crypto.subtle for secure key operations
- **Mandatory Verification**: All POST requests must include a valid signature

## Configuration

### Setting the Webhook Secret

1. **In GitHub App Settings**:
   - Navigate to your GitHub App settings
   - Under "Webhook", generate a secure random string for the webhook secret
   - Save the secret

2. **In Cloudflare Worker**:
   ```bash
   pnpm wrangler secret put GITHUB_WEBHOOK_SECRET
   ```
   - Paste the same secret you configured in GitHub

**Important**: The secrets must match exactly for signature verification to work.

### Generating a Secure Secret

Use a cryptographically secure random string generator:

```bash
# Using OpenSSL (recommended)
openssl rand -hex 32

# Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Using Python
python3 -c "import secrets; print(secrets.token_hex(32))"
```

## Response Codes

The worker returns specific HTTP status codes for security-related issues:

- **401 Unauthorized**: Signature verification failed or required headers missing
  - `missing x-hub-signature-256 header`
  - `invalid signature`
  
- **400 Bad Request**: Malformed request
  - `missing x-github-event header`

- **500 Internal Server Error**: Configuration issues
  - `missing AUTOMATION_REPO_TRIGGER_TOKEN`
  - `missing GITHUB_WEBHOOK_SECRET`

## Best Practices

1. **Never commit secrets**: Secrets are managed via Wrangler CLI, never in code
2. **Rotate secrets periodically**: Update both GitHub and Wrangler secrets together
3. **Monitor failed verifications**: Check logs for repeated 401 errors
4. **Use HTTPS only**: Cloudflare Workers enforce HTTPS by default
5. **Validate event types**: Worker only processes specific event types

## Testing Signature Verification

The test suite includes comprehensive tests for signature verification:

- Valid signature acceptance
- Invalid signature rejection
- Missing signature header rejection
- Missing secret configuration handling
- Timing-safe comparison validation

Run tests with:
```bash
pnpm test
```

## Threat Model

### Protected Against

✅ **Unauthorized webhook requests**: Only requests with valid signatures are processed  
✅ **Replay attacks**: Each request has a unique signature based on the body  
✅ **Timing attacks**: Constant-time comparison prevents timing-based signature guessing  
✅ **Man-in-the-middle**: HTTPS encryption protects data in transit  

### Not Protected Against

⚠️ **Compromised webhook secret**: If the secret is leaked, attackers can forge valid requests  
⚠️ **Compromised GitHub account**: Attackers with access to your GitHub App can modify webhook settings  

## Incident Response

If you suspect your webhook secret has been compromised:

1. **Immediately rotate the secret**:
   - Generate a new secret in GitHub App settings
   - Update Wrangler secret: `pnpm wrangler secret put GITHUB_WEBHOOK_SECRET`

2. **Review logs** for suspicious activity:
   - Check Cloudflare Worker logs for unusual patterns
   - Review GitHub webhook delivery logs

3. **Audit repository access**:
   - Check for unauthorized repository_dispatch events
   - Review automation repository workflow runs

## References

- [GitHub Webhook Security](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)
- [HMAC-SHA256 Specification](https://datatracker.ietf.org/doc/html/rfc2104)
- [Cloudflare Web Crypto API](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)

