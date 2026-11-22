/**
 * GA4_PROPERTY_ID is spliced into every request as `properties/<id>`. A GA4
 * property id is numeric, so anything else (a G- measurement ID, a typo) is
 * refused when the config loads, naming the variable, instead of reaching
 * Google and coming back as an opaque INVALID_ARGUMENT. A leading
 * `properties/` is accepted and dropped, so it is never doubled.
 */

const PROPERTY_ID_RE = /^(?:properties\/)?([0-9]{1,20})$/;

function describeValue(value: string): string {
  const text = JSON.stringify(value);
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

/** Return the numeric property id in a GA4_PROPERTY_ID value, or throw. */
export function parsePropertyId(raw: string): string {
  const match = raw.match(PROPERTY_ID_RE);
  if (match) return match[1];
  const hint = /^G-/i.test(raw)
    ? " A G- value is a measurement ID; the property ID is under Admin > Property details."
    : "";
  throw new Error(
    "GA4_PROPERTY_ID must be a numeric GA4 property ID, like 123456789 or properties/123456789. " +
      `Got ${describeValue(raw)}.${hint}`,
  );
}
