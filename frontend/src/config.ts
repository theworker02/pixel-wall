const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

export const apiOrigin = trimTrailingSlash(import.meta.env.VITE_API_URL?.trim() ?? "");
export const socketOrigin = trimTrailingSlash(import.meta.env.VITE_SOCKET_URL?.trim() ?? apiOrigin);

export const apiUrl = (path: string) => `${apiOrigin}${path}`;
