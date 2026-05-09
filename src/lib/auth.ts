// Auth state for the SPA. Stores the JWT in localStorage so reloads keep
// the user signed in. The token is opaque to the SPA — only the backend
// understands its claims. Subscribers (AuthProvider, api request hook)
// react to changes via the simple eventbus below.
//
// We deliberately don't decode the JWT here: we only need to know whether
// the token *exists*. Server-side `requireSession` will reject it if it's
// expired or invalid, and the api client maps those 401s back to a logout.

const STORAGE_KEY = "auth_token";

type Listener = (token: string | null) => void;
const listeners = new Set<Listener>();

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export function setAuthToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(STORAGE_KEY, token);
  else window.localStorage.removeItem(STORAGE_KEY);
  for (const fn of listeners) fn(token);
}

export function onAuthTokenChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// Cross-tab sync: a token written in another tab fires a `storage` event
// in this one. We rebroadcast it so AuthProvider re-renders on logout/in
// in the other tab.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== STORAGE_KEY) return;
    for (const fn of listeners) fn(e.newValue);
  });
}
