// ============================================
// STARTUP AUTH CHECK
// ============================================
// main() used to wait for one GA4 call before it connected the transport, so
// with Google unreachable the client's `initialize` went unanswered for the
// whole 30s request timeout. The check now runs beside the server. A failure
// is logged as before and also attached to the first tool result after it is
// known, where the client can see it.

import { readFileSync } from "fs";
import type { AuthMode } from "./oauthClient.js";

const MAX_MESSAGE_LENGTH = 500;

interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  [key: string]: unknown;
}

export class StartupCheck {
  /** The failure not yet reported to the client. */
  private failure: string | null = null;

  /** Run the check. Resolves when it has settled; never rejects. */
  async run(check: () => Promise<void>): Promise<void> {
    try {
      await check();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.failure = message.slice(0, MAX_MESSAGE_LENGTH);
      console.error(`[STARTUP WARNING] Auth check FAILED: ${message}`);
      console.error(`[STARTUP WARNING] The server is running, but API calls may fail until auth is fixed.`);
    }
  }

  /**
   * Add the failure to this tool result, once, as a text block after the
   * tool's own. A check that passed, has not run or is still running adds
   * nothing.
   */
  annotate<T extends ToolResult>(result: T): T {
    if (this.failure === null) return result;
    const notice = {
      startup_check: "failed",
      message: this.failure,
      action_required:
        "The GA4 call made at startup failed. If GA4 tools fail too, check the credentials, GA4 property access and the network. A GA4 tool that returns data means it has recovered.",
    };
    this.failure = null;
    return { ...result, content: [...result.content, { type: "text" as const, text: JSON.stringify(notice, null, 2) }] };
  }
}

/**
 * A service-account key file that cannot be read stops startup. The Google
 * client throws that error outside any promise and takes the process down, so
 * left to the check it would kill a server that had already answered.
 */
export function requireReadableKeyFile(authMode: AuthMode): void {
  if (authMode.mode !== "service_account") return;
  try {
    readFileSync(authMode.keyFile);
  } catch (err: any) {
    throw new Error(`Cannot read the service-account key file ${authMode.keyFile} (${err.code})`);
  }
}
