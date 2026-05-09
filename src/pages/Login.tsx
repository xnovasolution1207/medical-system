import React, { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { ArrowRight, AlertCircle } from "lucide-react";
import { useAuth } from "@/lib/authContext";

// Login screen — single button kicks off the GHL marketplace OAuth flow.
// We don't ship a username/password form because the backend exclusively
// authenticates via GHL OAuth (the marketplace handles credentials,
// 2FA, password resets, etc.).
export default function Login() {
  const { user, initialising, startLogin, authError, clearAuthError } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const location = useLocation();

  // Clear stale auth-errors when the component remounts so the user can
  // dismiss the message by re-trying.
  useEffect(() => {
    return () => clearAuthError();
  }, [clearAuthError]);

  // Already signed in → bounce to wherever they came from (or `/`).
  if (!initialising && user) {
    const from = (location.state as { from?: { pathname?: string } } | null)?.from
      ?.pathname;
    return <Navigate to={from ?? "/"} replace />;
  }

  const onLogin = async () => {
    setSubmitError(null);
    setSubmitting(true);
    try {
      await startLogin();
      // startLogin redirects the browser. Component unmounts before
      // returning. Resetting `submitting` would only fire if the redirect
      // somehow failed silently — leave it `true` until then.
    } catch (err) {
      setSubmitError(
        (err as Error)?.message ?? "No se pudo iniciar el flujo de autenticación"
      );
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-screen w-full items-center justify-center bg-background px-6 py-10">
      <div className="w-full max-w-[420px] flex flex-col gap-8">
        <div className="flex flex-col gap-2 text-center">
          <h1 className="text-3xl font-bold text-foreground tracking-tight">
            Bienvenido
          </h1>
          <p className="text-muted-foreground text-sm">
            Inicia sesión con tu cuenta de GoHighLevel para continuar.
          </p>
        </div>

        {(authError || submitError) && (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span className="break-words">{authError ?? submitError}</span>
          </div>
        )}

        <button
          type="button"
          onClick={onLogin}
          disabled={submitting || initialising}
          className="h-12 w-full rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-sm shadow-lg shadow-primary/20 transition-all hover:-translate-y-px active:translate-y-0 flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
        >
          {submitting ? (
            <>
              <div className="h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
              <span>Redirigiendo a GoHighLevel…</span>
            </>
          ) : (
            <>
              <span>Iniciar sesión con GoHighLevel</span>
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>

        <p className="text-center text-xs text-muted-foreground">
          Serás redirigido al portal de GoHighLevel para autorizar el acceso.
        </p>
      </div>
    </div>
  );
}
