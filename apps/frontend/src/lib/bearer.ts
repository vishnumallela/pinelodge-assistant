export const BEARER_KEY = "pinelodge.bearer";

export function bearerToken(): string {
  return localStorage.getItem(BEARER_KEY) ?? "";
}

export function bearerHeaders(): Record<string, string> {
  const t = bearerToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export function clearBearer(): void {
  localStorage.removeItem(BEARER_KEY);
}
