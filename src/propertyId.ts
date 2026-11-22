/**
 * A GA4 property id is spliced into every request as `properties/<id>`, so
 * each one is checked before it is used: GA4_PROPERTY_ID and the config.json
 * entries when the config loads, and the tools' `property_id` argument before
 * any client is built. A property id is numeric, so anything else (a G-
 * measurement ID, a typo, a path) is refused, naming where it came from,
 * instead of reaching Google and coming back as an opaque INVALID_ARGUMENT. A
 * leading `properties/` is accepted and dropped, so it is never doubled.
 */

import { Ga4InvalidArgumentError, requireStringArg } from "./errors.js";

const PROPERTY_ID_RE = /^(?:properties\/)?([0-9]{1,20})$/;

function describeValue(value: unknown): string {
  if (value === undefined) return "(missing)";
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

function measurementIdHint(value: unknown): string {
  return typeof value === "string" && /^G-/i.test(value)
    ? " A G- value is a measurement ID; the property ID is under Admin > Property details."
    : "";
}

/**
 * Return the numeric property id in a configured value, or throw. `source`
 * names where the value came from (the env var, or a config.json entry). A
 * config.json may hold the id as a JSON number, so a non-negative safe integer
 * is accepted too.
 */
export function parsePropertyId(raw: unknown, source = "GA4_PROPERTY_ID"): string {
  if (typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0) return String(raw);
  const match = typeof raw === "string" ? raw.match(PROPERTY_ID_RE) : null;
  if (match) return match[1];
  throw new Error(
    `${source} must be a numeric GA4 property ID, like 123456789 or properties/123456789. ` +
      `Got ${describeValue(raw)}.${measurementIdHint(raw)}`,
  );
}

/**
 * Return the numeric property id in a tool's `property_id` argument, or throw
 * Ga4InvalidArgumentError, which the dispatch turns into the structured
 * invalid-argument envelope. Surrounding whitespace is ignored.
 */
export function requirePropertyIdArg(value: unknown): string {
  const raw = requireStringArg("property_id", value).trim();
  const match = raw.match(PROPERTY_ID_RE);
  if (match) return match[1];
  throw new Ga4InvalidArgumentError(
    "property_id",
    `expected a numeric GA4 property ID, like 123456789 or properties/123456789; got ${describeValue(raw)}.${measurementIdHint(raw)}`,
  );
}
