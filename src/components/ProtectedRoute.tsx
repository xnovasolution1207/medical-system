import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/authContext";

// Gate any subtree on a valid OAuth session. While `/auth/me` is still
// resolving on first load we render a tiny placeholder so the SPA doesn't
// flash a "not logged in" screen between mount and the verify response.
export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, initialising } = useAuth();
  const location = useLocation();

  if (initialising) {
    // Branded splash while the OAuth session is verified: spinning gradient ring
    // around a glowing chat mark + animated dots, in the project's primary color.
    return (
      <div className="relative flex h-screen w-full items-center justify-center overflow-hidden bg-background">
        <div className="pointer-events-none absolute h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex flex-col items-center gap-8">
          <div className="relative flex h-24 w-24 items-center justify-center">
            <div
              className="absolute inset-0 animate-spin rounded-full [animation-duration:1.1s]"
              style={{
                background:
                  "conic-gradient(from 90deg, transparent 0%, transparent 50%, hsl(var(--primary) / 0.35) 75%, hsl(var(--primary)) 100%)",
                WebkitMask:
                  "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))",
                mask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))",
              }}
            />
            <div className="absolute inset-1.5 animate-ping rounded-full bg-primary/10 [animation-duration:2s]" />
            <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-7 w-7 animate-pulse text-primary"
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
          </div>
          <div className="flex flex-col items-center gap-3">
            <span className="text-sm font-medium tracking-wide text-foreground/70">
              Verificando sesión…
            </span>
            <div className="flex gap-1.5">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" />
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (!user) {
    // Preserve the page the user tried to visit so we can bounce them
    // back after login.
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <>{children}</>;
}
