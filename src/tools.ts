import { Tool } from "@modelcontextprotocol/sdk/types.js";

export const tools: Tool[] = [
  {
    name: "ga4_get_client_context",
    description: "Get the current GA4 client context and health status based on working directory. Call this first to confirm which GA4 property you're working with.",
    inputSchema: {
      type: "object",
      properties: {
        working_directory: { type: "string", description: "The current working directory" },
      },
      required: ["working_directory"],
    },
  },
  {
    name: "ga4_run_report",
    description: 'Query GA4 historical report. Common patterns: top pages (dimensions="pagePath", metrics="screenPageViews"), traffic sources (dimensions="sessionSource,sessionMedium", metrics="sessions,totalUsers"), daily trend (dimensions="date", metrics="sessions").',
    inputSchema: {
      type: "object",
      properties: {
        property_id: { type: "string", description: "GA4 property ID (numeric)" },
        dimensions: { type: "string", description: 'Comma-separated dimensions (e.g., "eventName,date")' },
        metrics: { type: "string", description: 'Comma-separated metrics (e.g., "eventCount,activeUsers")' },
        start_date: { type: "string", description: 'Start date (YYYY-MM-DD or "7daysAgo")' },
        end_date: { type: "string", description: 'End date (YYYY-MM-DD or "today")' },
        dimension_filter: { type: "string", description: 'Optional equality filter (e.g., "eventName==page_view")' },
        limit: { type: "number", description: "Max rows (default 100)" },
        order_by: { type: "string", description: 'Optional metric to sort by descending (e.g., "eventCount")' },
      },
      required: ["property_id"],
    },
  },
  {
    name: "ga4_realtime_report",
    description: "Query GA4 Realtime Report (last 30 minutes).",
    inputSchema: {
      type: "object",
      properties: {
        property_id: { type: "string", description: "GA4 property ID (numeric)" },
        dimensions: { type: "string", description: 'Comma-separated dimension names (e.g., "eventName")' },
        metrics: { type: "string", description: 'Comma-separated metric names (e.g., "eventCount,activeUsers")' },
        dimension_filter: { type: "string", description: 'Optional equality filter (e.g., "eventName==pardot_form_submit")' },
      },
      required: ["property_id"],
    },
  },
  {
    name: "ga4_list_custom_dimensions",
    description: "List all registered custom dimensions for a GA4 property.",
    inputSchema: {
      type: "object",
      properties: {
        property_id: { type: "string", description: "GA4 property ID (numeric)" },
      },
      required: ["property_id"],
    },
  },
  {
    name: "ga4_create_custom_dimension",
    description: "Register a new custom dimension in a GA4 property.",
    inputSchema: {
      type: "object",
      properties: {
        property_id: { type: "string", description: "GA4 property ID (numeric)" },
        parameter_name: { type: "string", description: 'The event parameter name (e.g., "form_type")' },
        display_name: { type: "string", description: 'Human-readable name (e.g., "Form Type")' },
        scope: { type: "string", description: 'Either "EVENT" or "USER" (default: EVENT)' },
        description: { type: "string", description: "Optional description" },
      },
      required: ["property_id", "parameter_name", "display_name"],
    },
  },
  {
    name: "ga4_list_custom_metrics",
    description: "List all registered custom metrics for a GA4 property.",
    inputSchema: {
      type: "object",
      properties: {
        property_id: { type: "string", description: "GA4 property ID (numeric)" },
      },
      required: ["property_id"],
    },
  },
  {
    name: "ga4_list_data_streams",
    description: "List all data streams for a GA4 property.",
    inputSchema: {
      type: "object",
      properties: {
        property_id: { type: "string", description: "GA4 property ID (numeric)" },
      },
      required: ["property_id"],
    },
  },
  {
    name: "ga4_send_feedback",
    description: "Send feedback about the GA4 MCP tools. Use when a query didn't work as expected.",
    inputSchema: {
      type: "object",
      properties: {
        feedback_type: { type: "string", description: "One of: bug, feature, question" },
        message: { type: "string", description: "Description of the issue, request, or question" },
        query_context: { type: "string", description: "Optional context about what was queried" },
      },
      required: ["feedback_type", "message"],
    },
  },
  {
    name: "ga4_suggest_improvement",
    description: "Log a GA4 query pattern that didn't work well, so it can be improved.",
    inputSchema: {
      type: "object",
      properties: {
        failed_query: { type: "string", description: "The natural language question the user asked" },
        expected_result: { type: "string", description: "What the user expected to see" },
        actual_result: { type: "string", description: "What actually happened" },
      },
      required: ["failed_query", "expected_result"],
    },
  },
];
