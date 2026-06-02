import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { apiOrigin, apiUrl } from "./config";

export type User = { id: number; username: string; created_at: string; last_active: string; canvasSize: number };
type AuthState = { user: User | null; loading: boolean; login: (identifier: string, password: string) => Promise<void>; register: (username: string, email: string, password: string) => Promise<void>; logout: () => Promise<void> };
const AuthContext = createContext<AuthState | null>(null);
export const token = () => localStorage.getItem("pixel-wall-token");
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), { ...options, headers: { "Content-Type": "application/json", ...(token() ? { Authorization: `Bearer ${token()}` } : {}), ...options.headers } });
  } catch {
    throw new Error("The Pixel Wall API is unavailable. Please try again shortly.");
  }
  const text = await response.text();
  let body: { error?: string } & Record<string, unknown> = {};
  try { body = text ? JSON.parse(text) : {}; }
  catch {
    const deploymentHint = !apiOrigin && location.hostname.endsWith(".vercel.app");
    throw new Error(deploymentHint ? "Sign-in is temporarily unavailable because the API has not been connected to this deployment." : "The Pixel Wall API returned an unexpected response. Please try again shortly.");
  }
  if (!response.ok) throw new Error(body.error ?? "Request failed");
  return body as T;
}
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api<{ user: User | null }>("/api/auth/me").then((r) => setUser(r.user)).catch(() => setUser(null)).finally(() => setLoading(false)); }, []);
  const enter = async (path: string, body: object) => {
    const result = await api<{ user: User; token: string }>(path, { method: "POST", body: JSON.stringify(body) });
    localStorage.setItem("pixel-wall-token", result.token); setUser(result.user);
  };
  const logout = async () => { await api("/api/auth/logout", { method: "POST" }); localStorage.removeItem("pixel-wall-token"); setUser(null); };
  return <AuthContext.Provider value={{ user, loading, login: (identifier, password) => enter("/api/auth/login", { identifier, password }), register: (username, email, password) => enter("/api/auth/register", { username, email, password }), logout }}>{children}</AuthContext.Provider>;
}
export const useAuth = () => useContext(AuthContext)!;
