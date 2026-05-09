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
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background text-muted-foreground">
        Verificando sesión…
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
