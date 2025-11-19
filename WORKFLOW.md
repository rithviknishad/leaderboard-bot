# Installation Handler Workflow Guide

This document explains how the GitHub App installation handler workflow works and how to customize it for your needs.

## Overview

The installation handler workflow (`.github/workflows/handle-installation.yml`) automatically processes GitHub App installation events. When your app is installed on a repository, this workflow:

1. Receives the event from the Cloudflare Worker
2. Authenticates as the GitHub App
3. Sets up each installed repository

## Workflow Trigger

The workflow is triggered by `repository_dispatch` events with type `leaderboard-bot-installed`:

```yaml
on:
  repository_dispatch:
    types: [leaderboard-bot-installed]
```

These events are sent by the Cloudflare Worker when it receives installation webhooks from GitHub.

## Workflow Steps

### 1. Checkout and Setup

```yaml
- name: Checkout automation repository
  uses: actions/checkout@v4

- name: Setup Node.js
  uses: actions/setup-node@v4
  with:
    node-version: "24"
```

Checks out the automation repository and sets up Node.js for running scripts.

### 2. Read Payload

```yaml
- name: Read payload
  id: payload
  run: |
    echo "${{ toJson(github.event.client_payload) }}" > payload.json
    cat payload.json
```

Extracts and logs the event payload sent from the Cloudflare Worker.

### 3. Generate GitHub App JWT

```yaml
- name: Authenticate as GitHub App (create JWT)
  id: app-jwt
  uses: actions/github-script@v7
```

Creates a JSON Web Token (JWT) for authenticating as the GitHub App. This uses:
- `LEADERBOARD_APP_ID`: Your GitHub App's ID
- `LEADERBOARD_APP_PRIVATE_KEY`: Your GitHub App's private key

The JWT is valid for 10 minutes and is used to request installation access tokens.

### 4. Process Repositories

```yaml
- name: Process installation and setup repositories
  uses: actions/github-script@v7
```

This is the main step that:
- Creates an installation access token using the JWT
- Iterates through each installed repository
- Performs setup actions on each repository

## GitHub App Authentication Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Generate JWT using App ID + Private Key                  │
│    - Valid for 10 minutes                                    │
│    - Identifies the app, not a specific installation        │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Exchange JWT for Installation Access Token               │
│    - POST /app/installations/{id}/access_tokens             │
│    - Token is scoped to specific installation               │
│    - Has permissions granted to the app                     │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Use Installation Token to Access Repositories            │
│    - Read repository details                                │
│    - Create/update files                                    │
│    - Create pull requests                                   │
│    - Any other permitted actions                            │
└─────────────────────────────────────────────────────────────┘
```

## Customizing the Workflow

### Adding Repository Setup Logic

Find this section in the workflow:

```javascript
// TODO: Add your leaderboard setup logic here
// Examples:
// 1. Create/update leaderboard workflow file
// 2. Create leaderboard configuration file
// 3. Initialize leaderboard data
// 4. Create initial PR with setup
```

Replace it with your custom logic. Here are some examples:

#### Example 1: Create a Workflow File

```javascript
// Create a leaderboard workflow in the target repository
const workflowContent = `
name: Update Leaderboard
on:
  push:
    branches: [main]
jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Update leaderboard
        run: echo "Update leaderboard logic here"
`;

const workflowPath = '.github/workflows/leaderboard.yml';

try {
  // Check if file exists
  await installOctokit.repos.getContent({
    owner,
    repo: repoName,
    path: workflowPath
  });
  console.log(`  ℹ Workflow already exists at ${workflowPath}`);
} catch (error) {
  if (error.status === 404) {
    // Create the file
    await installOctokit.repos.createOrUpdateFileContents({
      owner,
      repo: repoName,
      path: workflowPath,
      message: 'Add leaderboard workflow',
      content: Buffer.from(workflowContent).toString('base64')
    });
    console.log(`  ✓ Created workflow at ${workflowPath}`);
  }
}
```

#### Example 2: Create Configuration File

```javascript
// Create leaderboard configuration
const config = {
  enabled: true,
  updateFrequency: 'daily',
  metrics: ['commits', 'pull_requests', 'issues'],
  displayTop: 10
};

const configPath = '.leaderboard.json';

await installOctokit.repos.createOrUpdateFileContents({
  owner,
  repo: repoName,
  path: configPath,
  message: 'Initialize leaderboard configuration',
  content: Buffer.from(JSON.stringify(config, null, 2)).toString('base64')
});

console.log(`  ✓ Created configuration at ${configPath}`);
```

#### Example 3: Create a Pull Request

```javascript
// Create a branch
const defaultBranch = repoData.default_branch;
const { data: ref } = await installOctokit.git.getRef({
  owner,
  repo: repoName,
  ref: `heads/${defaultBranch}`
});

const newBranch = 'setup/leaderboard';
await installOctokit.git.createRef({
  owner,
  repo: repoName,
  ref: `refs/heads/${newBranch}`,
  sha: ref.object.sha
});

// Create files on the new branch
// ... (create files as shown above, but on the new branch)

// Create pull request
await installOctokit.pulls.create({
  owner,
  repo: repoName,
  title: '🏆 Setup Leaderboard',
  head: newBranch,
  base: defaultBranch,
  body: `
## Leaderboard Setup

This PR sets up the leaderboard for this repository.

### What's included:
- Leaderboard workflow
- Configuration file
- Initial data structure

Please review and merge to activate the leaderboard.
  `.trim()
});

console.log(`  ✓ Created pull request for leaderboard setup`);
```

#### Example 4: Add Issue Comment

```javascript
// Create an issue to notify about installation
await installOctokit.issues.create({
  owner,
  repo: repoName,
  title: '🏆 Leaderboard App Installed',
  body: `
The Leaderboard app has been successfully installed on this repository!

## Next Steps

1. Review the configuration in \`.leaderboard.json\`
2. Customize the metrics you want to track
3. The leaderboard will update automatically

For more information, visit [documentation](https://github.com/ohcnetwork/leaderboard-bot).
  `.trim()
});

console.log(`  ✓ Created notification issue`);
```

## Event Types

The workflow handles two types of events:

### 1. Installation Event

Triggered when the app is first installed on repositories.

```json
{
  "github_event": "installation",
  "payload": {
    "action": "created",
    "installation": {
      "id": 12345,
      "account": { "login": "org-name" }
    },
    "repositories": [
      { "id": 1, "name": "repo1", "full_name": "org/repo1" }
    ]
  }
}
```

### 2. Installation Repositories Event

Triggered when repositories are added to an existing installation.

```json
{
  "github_event": "installation_repositories",
  "payload": {
    "action": "added",
    "installation": {
      "id": 12345,
      "account": { "login": "org-name" }
    },
    "repositories_added": [
      { "id": 2, "name": "repo2", "full_name": "org/repo2" }
    ]
  }
}
```

## Required Secrets

Configure these in your repository settings (Settings → Secrets and variables → Actions):

| Secret | Description | How to Get |
|--------|-------------|------------|
| `LEADERBOARD_APP_ID` | GitHub App ID | Found in your GitHub App settings page |
| `LEADERBOARD_APP_PRIVATE_KEY` | GitHub App private key (PEM format) | Generate in GitHub App settings → Private keys |

## Permissions

The workflow requires these permissions:

```yaml
permissions:
  contents: write        # To create/update files
  pull-requests: write   # To create pull requests
  id-token: write       # For OIDC authentication
  actions: read         # To read workflow information
```

## Debugging

### View Workflow Runs

1. Go to your repository on GitHub
2. Click "Actions" tab
3. Look for "Leaderboard App Installation Handler" workflow
4. Click on a specific run to see logs

### Common Issues

#### JWT Generation Fails

**Error**: `Error: secretOrPrivateKey must have a value`

**Solution**: Ensure `LEADERBOARD_APP_PRIVATE_KEY` is set correctly. The key should be in PEM format:

```
-----BEGIN RSA PRIVATE KEY-----
...
-----END RSA PRIVATE KEY-----
```

#### Installation Token Creation Fails

**Error**: `401 Unauthorized`

**Solution**: 
- Verify `LEADERBOARD_APP_ID` is correct
- Ensure the private key matches the app
- Check that the app is actually installed on the repositories

#### Repository Access Denied

**Error**: `404 Not Found` when accessing repository

**Solution**:
- Verify the app has access to the repository
- Check that the installation includes the repository
- Ensure the app has the required permissions

### Enable Debug Logging

Add this to see more detailed logs:

```yaml
env:
  ACTIONS_STEP_DEBUG: true
  ACTIONS_RUNNER_DEBUG: true
```

## Testing

To test the workflow without triggering an actual installation:

1. Use the GitHub API to manually trigger a repository_dispatch event:

```bash
curl -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  https://api.github.com/repos/ohcnetwork/leaderboard-bot/dispatches \
  -d '{
    "event_type": "leaderboard-bot-installed",
    "client_payload": {
      "github_event": "installation",
      "payload": {
        "action": "created",
        "installation": {
          "id": 12345,
          "account": {"login": "test-org", "type": "Organization"}
        },
        "repositories": [
          {"id": 1, "name": "test-repo", "full_name": "test-org/test-repo"}
        ]
      }
    }
  }'
```

2. Check the Actions tab for the workflow run

## Best Practices

1. **Idempotency**: Make your setup logic idempotent (safe to run multiple times)
2. **Error Handling**: Wrap operations in try-catch blocks
3. **Logging**: Add detailed console.log statements for debugging
4. **Validation**: Check if files/configurations already exist before creating
5. **Notifications**: Consider creating issues or sending notifications on setup completion

## Further Reading

- [GitHub Apps Documentation](https://docs.github.com/en/apps)
- [GitHub REST API](https://docs.github.com/en/rest)
- [Octokit.js Documentation](https://octokit.github.io/rest.js/)
- [GitHub Actions - actions/github-script](https://github.com/actions/github-script)

