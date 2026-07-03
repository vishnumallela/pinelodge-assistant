const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3002";
const AUTH_URL = import.meta.env.VITE_AUTH_URL ?? "http://localhost:3001";

export const env = { API_URL, AUTH_URL } as const;
