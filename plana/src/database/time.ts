/** ISO 8601 UTC timestamp (e.g. 2026-07-21T12:00:00.000Z). Lexicographically comparable. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Normalize mixed SQLite/JS timestamps to ISO 8601 UTC when possible. */
export function toIso(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return value;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const withZ = /Z$|[+-]\d{2}:\d{2}$/.test(normalized)
    ? normalized
    : `${normalized}Z`;
  const d = new Date(withZ);
  if (Number.isNaN(d.getTime())) return value;
  return d.toISOString();
}
