import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type User = { id: number; username: string; created_at: string; last_active: string; canvasSize: number };
type AuthState = { user: User | null; loading: boolean; login: (identifier: string, password: string) => Promise<void>; register: (username: string, email: string, password: string) => Promise<void>; logout: () => Promise<void> };
const AuthContext = createContext<AuthState | null>(null);
export const token = () => localStorage.getItem("pixel-wall-token");
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...(token() ? { Authorization: `Bearer ${token()}` } : {}), ...options.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Request failed");
  return body;
}
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api<{ user: User | null }>("/api/auth/me").then((r) => setUser(r.user)).finally(() => setLoading(false)); }, []);
  const enter = async (path: string, body: object) => {
    const result = await api<{ user: User; token: string }>(path, { method: "POST", body: JSON.stringify(body) });
    localStorage.setItem("pixel-wall-token", result.token); setUser(result.user);
  };
  const logout = async () => { await api("/api/auth/logout", { method: "POST" }); localStorage.removeItem("pixel-wall-token"); setUser(null); };
  return <AuthContext.Provider value={{ user, loading, login: (identifier, password) => enter("/api/auth/login", { identifier, password }), register: (username, email, password) => enter("/api/auth/register", { username, email, password }), logout }}>{children}</AuthContext.Provider>;
}
export const useAuth = () => useContext(AuthContext)!;
