# mcp-ga4

MCP server for Google Analytics 4 -- run reports, realtime data, custom dimensions, and property management via Claude.

## Features

- 9 tools covering reporting, realtime data, custom dimensions/metrics, data streams, and feedback
- Two configuration modes: single-property (env vars) and multi-client (config.json)
- Supports both service account and OAuth credentials
- Relative date support (today, yesterday, 7daysAgo, 30daysAgo, 90daysAgo)
- Built on official Google SDKs with resilience patterns

## Installation

```bash
npm install mcp-ga4
```

Or clone the repository:

```bash
git clone https://github.com/mharnett/mcp-ga4.git
cd mcp-ga4
npm install
npm run build
```

## Authentication

`mcp-ga4` supports **two** credential families. Selection is deterministic and
happens once, at startup: an explicit **keyfile / service account wins**, then
**user OAuth**, and if **neither** is configured the server exits with a loud
onboarding error naming both options. There is **no** machine-local credentials
path baked into the code and **no** silent runtime failover -- the only
credential inputs are environment variables and (optionally) your own per-user
`config.json`. (A later `403` therefore surfaces as the API error, not as a
silent switch to the other credential family.)

> **Precedence:** when **both** families are configured, the **keyfile /
> service account takes precedence** over user OAuth.

### Option A: Service account (recommended for unattended / server use)

Use this for any always-on or server deployment. Point
`GOOGLE_APPLICATION_CREDENTIALS` (or `config.json` `credentials_file`) at a JSON
keyfile. The service account **must be granted access on the GA4 property**
(Admin → Property Access Management → add the service-account email with at least
Viewer). No refresh token is involved -- the server hands the keyfile to the GA4
SDKs directly:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
```

The keyfile may be a real service-account key **or** an `authorized_user` OAuth
token dump -- both are accepted via the `keyFile` option.

### Option B: User OAuth (personal / interactive use)

Use this if you want the server to act as a Google **user** (your own GA4
login). You bring your own Google OAuth client and mint a refresh token once.

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials),
   create an **OAuth 2.0 Client ID** of type **Desktop app**. Enable the
   **Google Analytics Data API** (and the **Admin API** if you use the
   custom-dimension tools).
2. Export your client credentials and run the token helper (uses PKCE, opens a
   browser, prints the token to stdout):

   ```bash
   export GA4_CLIENT_ID=...            # from the Desktop-app client
   export GA4_CLIENT_SECRET=...
   node get-refresh-token.cjs          # or: npm run auth
   ```

   > Do **not** redirect this command's stdout to a shared log -- the refresh
   > token is printed there by design.

3. Copy the printed `GA4_REFRESH_TOKEN=...` into your environment. At runtime the
   server reads these three env vars:

   ```bash
   GA4_CLIENT_ID=...
   GA4_CLIENT_SECRET=...
   GA4_REFRESH_TOKEN=...
   ```

The scope requested is read from `config.json` `oauth.scope` (see below), so the
helper and the running server never disagree on what you granted.

### Scopes (minimum grant)

Scopes live in `config.json` under `oauth.scope`. The committed default is:

```
https://www.googleapis.com/auth/analytics.readonly
https://www.googleapis.com/auth/analytics.edit
```

`analytics.edit` is required because `ga4_create_custom_dimension` mutates the
property via the Admin API. If you only need read access, override `oauth.scope`
in your own `config.json` to `analytics.readonly` alone and re-run the helper.

## Configuration

**Security:** Never share your `.mcp.json` file or commit it to git -- it may contain API credentials. Add `.mcp.json` to your `.gitignore`.

### Mode 1: Single Property (env vars)

Set a property ID plus one of the auth families above:

```bash
GA4_PROPERTY_ID=123456789
# then EITHER the OAuth trio (GA4_CLIENT_ID/SECRET/REFRESH_TOKEN)
# OR a service account: GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
```

### Mode 2: Multi-Client (config.json)

Create a `config.json` in the project root to map multiple GA4 properties to
project directories. The server auto-detects which property to use based on the
caller's working directory. Credentials come from the environment (Option A/B
above); `config.json` may optionally carry a `credentials_file` service-account
path for a config-only SA setup.

```json
{
  "oauth": {
    "scope": "https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/analytics.edit"
  },
  "clients": {
    "client-a": {
      "name": "Client A",
      "folder": "/path/to/client-a/project",
      "property_id": "123456789"
    },
    "client-b": {
      "name": "Client B",
      "folder": "/path/to/client-b/project",
      "property_id": "987654321"
    }
  }
}
```

## Usage

### Claude Code (.mcp.json)

Single-property mode:

```json
{
  "mcpServers": {
    "ga4": {
      "command": "npx",
      "args": ["mcp-ga4"],
      "env": {
        "GA4_PROPERTY_ID": "123456789",
        "GOOGLE_APPLICATION_CREDENTIALS": "/path/to/credentials.json"
      }
    }
  }
}
```

Multi-client mode:

```json
{
  "mcpServers": {
    "ga4": {
      "command": "node",
      "args": ["/path/to/mcp-ga4/dist/index.js"]
    }
  }
}
```

**Claude Desktop:** Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows).

## Common Query Patterns

**Top pages:**
dimensions=`pagePath`, metrics=`screenPageViews`, order_by=`screenPageViews`

**Traffic sources:**
dimensions=`sessionSource,sessionMedium`, metrics=`sessions,totalUsers`

**Daily trend:**
dimensions=`date`, metrics=`sessions,totalUsers`

**Campaign performance:**
dimensions=`sessionCampaignName`, metrics=`sessions,conversions`

**Device breakdown:**
dimensions=`deviceCategory`, metrics=`sessions,totalUsers`

## Tools

| Tool | Description |
|------|-------------|
| `ga4_get_client_context` | Returns the active GA4 property ID and client name |
| `ga4_run_report` | Run a standard GA4 report with dimensions, metrics, date range, and filters |
| `ga4_realtime_report` | Query realtime data (last 30 minutes) |
| `ga4_list_custom_dimensions` | List all custom dimensions for the property |
| `ga4_create_custom_dimension` | Create a new custom dimension |
| `ga4_list_custom_metrics` | List all custom metrics for the property |
| `ga4_list_data_streams` | List web/app data streams and their measurement IDs |
| `ga4_send_feedback` | Submit feedback on a query result |
| `ga4_suggest_improvement` | Suggest a new query pattern or improvement |

## Date Formats

Use `YYYY-MM-DD` for absolute dates, or these relative shortcuts:

- `today`
- `yesterday`
- `7daysAgo`
- `30daysAgo`
- `90daysAgo`

## Common Dimensions and Metrics

**Dimensions:** date, dateHour, eventName, pagePath, pageTitle, sessionSource, sessionMedium, sessionCampaignName, country, city, deviceCategory, browser, operatingSystem, landingPage, pageReferrer, newVsReturning, firstUserSource, firstUserMedium, firstUserCampaignName

**Metrics:** sessions, totalUsers, newUsers, activeUsers, screenPageViews, eventCount, conversions, engagedSessions, engagementRate, averageSessionDuration, bounceRate, sessionsPerUser, screenPageViewsPerSession, userEngagementDuration

## Data Freshness

- Standard reports: 24-48 hour delay
- Realtime reports: last 30 minutes only

## Architecture

Built on:

- `@google-analytics/data` -- GA4 Data API for reports
- `@google-analytics/admin` -- GA4 Admin API for property management
- `cockatiel` -- resilience (retry, circuit breaker)
- `pino` -- structured logging

## License

MIT

## Author

Built by Mark Harnett / [drak-marketing](https://github.com/drak-marketing)
