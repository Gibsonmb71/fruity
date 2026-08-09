/** Normalize the configured QBSheet origin, without accepting a path or credentials. */
export const defaultQbsheetOrigin = 'https://qbsheet.com';

export function normalizeQbsheetOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return null;
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.pathname !== '/' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    return null;
  }
  return parsed.origin;
}
