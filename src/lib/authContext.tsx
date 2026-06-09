// AuthProvider — single source of truth for "is the user logged in?".
//
// Lifecycle:
//   1. On mount: read token from localStorage. If absent → `loading: false,
//      user: null`.
//   2. If a token is present, call `/api/auth/me` to verify it. On 401 the
//      api client clears the token; we observe via `onAuthTokenChange`.
//   3. Every time the token changes (login, logout, cross-tab) we re-run
//      the verify so consumers see fresh `user` data.
//
// The provider also handles the post-callback URL hash: when the SPA
// loads at `https://app/#auth_token=…`, we lift the token, persist it,
// and strip the hash before React Router observes it.
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api } from "./api";
import { getAuthToken, onAuthTokenChange, setAuthToken } from "./auth";

export interface AuthUser {
  userId: string;
  locationId: string;
  userType: string | null;
  // True when this user may open the admin area (manage the allowlist).
  // Drives the admin nav link + route guard; the API is gated server-side.
  isAdmin: boolean;
  // Display fields populated from `/auth/me/profile` after the session
  // verify resolves. Kept optional so consumers can render fallbacks
  // (initials, generic icon) before the second fetch lands.
  name?: string;
  avatar?: string;
  email?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  // True when the token is present but `/auth/me` hasn't resolved yet —
  // useful to gate route render before the verify completes.
  initialising: boolean;
  // Kicks off the GHL OAuth flow by asking the backend for the authorize
  // URL and sending the browser there.
  startLogin: () => Promise<void>;
  logout: () => Promise<void>;
  // Surfaced for diagnostics — null when no auth-error param landed.
  authError: string | null;
  clearAuthError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Move query/hash data out of the URL before React Router runs so the
// SPA never accidentally renders the token. We use replaceState so the
// browser history doesn't gain a duplicate entry.
function consumeAuthHash(): { token?: string; error?: string } {
  if (typeof window === "undefined") return {};
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return {};
  const params = new URLSearchParams(hash);
  const token = params.get("auth_token") ?? undefined;
  const error = params.get("auth_error") ?? undefined;
  if (!token && !error) return {};
  // Strip the hash. Keeping pathname + search avoids dropping any other
  // legitimate router state on the URL.
  const cleaned = `${window.location.pathname}${window.location.search}`;
  window.history.replaceState(null, "", cleaned);
  return { token, error };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => {
    // Run once on mount: peel any token / error out of the URL hash and
    // adopt it before the rest of the app sees the URL.
    const consumed = consumeAuthHash();
    if (consumed.token) {
      setAuthToken(consumed.token);
      return consumed.token;
    }
    return getAuthToken();
  });
  const [authError, setAuthError] = useState<string | null>(() => {
    const consumed = consumeAuthHash();
    return consumed.error ?? null;
  });
  const [user, setUser] = useState<AuthUser | null>(null);
  const [initialising, setInitialising] = useState(Boolean(token));

  // Keep our React state in sync with the localStorage source of truth
  // (cross-tab updates land here too).
  useEffect(() => {
    return onAuthTokenChange((t) => setTokenState(t));
  }, []);

  // Verify the token whenever it changes. Failure clears `user` so
  // ProtectedRoute below can redirect.
  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setUser(null);
      setInitialising(false);
      return;
    }
    setInitialising(true);
    api.auth
      .me()
      .then(async (me) => {
        if (cancelled) return;
        // Set the bare identity first so route guards can render. Then
        // best-effort fetch the profile for display fields (name, avatar)
        // — failures here are non-fatal (the user is still logged in).
        setUser({
          userId: me.userId,
          locationId: me.locationId,
          userType: me.userType,
          isAdmin: me.isAdmin,
        });
        try {
          const profile = await api.auth.profile.get();
          if (cancelled) return;
          const fullName =
            [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim() ||
            profile.email ||
            me.userId;
          setUser({
            userId: me.userId,
            locationId: me.locationId,
            userType: me.userType,
            isAdmin: me.isAdmin,
            name: fullName,
            avatar: profile.profilePhoto ?? undefined,
            email: profile.email || undefined,
          });
        } catch (err) {
          console.warn("[auth] /auth/me/profile failed:", err);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        // 401 already cleared the token via the api client. Any other
        // failure (network) we treat as anonymous so the app surfaces
        // a login prompt rather than spinning forever.
        console.warn("[auth] /auth/me failed:", err);
        setUser(null);
      })
      .finally(() => {
        if (!cancelled) setInitialising(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const startLogin = useCallback(async () => {
    const { url } = await api.auth.startLogin();
    window.location.href = url;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } catch (err) {
      // Server-side delete is best-effort — clearing the local token is
      // what the user actually cares about.
      console.warn("[auth] logout request failed:", err);
    }
    setAuthToken(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading: initialising,
      initialising,
      startLogin,
      logout,
      authError,
      clearAuthError: () => setAuthError(null),
    }),
    [user, initialising, startLogin, logout, authError]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
