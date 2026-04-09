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

## Configuration

### Mode 1: Single Property (env vars)

Set environment variables to connect to a single GA4 property:

```bash
GA4_PROPERTY_ID=123456789
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
```

### Mode 2: Multi-Client (config.json)

Create a `config.json` in the project root to map multiple GA4 properties to project directories. The server auto-detects which property to use based on the caller's working directory.

```json
{
  "credentials_file": "/path/to/oauth-credentials.json",
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
