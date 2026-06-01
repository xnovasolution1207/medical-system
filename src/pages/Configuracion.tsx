import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { MessageTemplate } from "@/components/chat/types";
import {
  ArrowLeft,
  Loader2,
  Save,
  Sparkles,
  MessageCircle,
  KeyRound,
  Plus,
  Trash2,
  Wifi,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";

type TemplateWebhook = {
  templateName: string;
  templateLanguage: string;
  webhookUrl: string;
};

// Per-sub-account settings: Green API credentials, the Conversation AI bot
// status webhook, and the per-template WhatsApp workflow webhooks. Everything
// here is scoped to the active sub-account (the backend keys on the session's
// locationId), so an agency configures each sub-account independently.
export default function Configuracion() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [locationId, setLocationId] = useState("");

  // --- Green API ---
  const [gaInstanceId, setGaInstanceId] = useState("");
  const [gaApiToken, setGaApiToken] = useState("");
  const [gaBaseUrl, setGaBaseUrl] = useState("");
  const [gaConfigured, setGaConfigured] = useState(false);
  const [gaSaving, setGaSaving] = useState(false);
  const [gaDeleting, setGaDeleting] = useState(false);

  // --- Bot status webhook ---
  const [botUrl, setBotUrl] = useState("");
  const [botSaving, setBotSaving] = useState(false);
  const [botProbing, setBotProbing] = useState(false);

  // --- Template webhooks ---
  // Every WhatsApp template (from Meta) is listed; the agent just enters the
  // inbound webhook URL per template. `tpls` = the URLs already registered.
  const [tpls, setTpls] = useState<TemplateWebhook[]>([]);
  const [waTemplates, setWaTemplates] = useState<MessageTemplate[]>([]);
  const [waTemplatesError, setWaTemplatesError] = useState<string | null>(null);
  const [tplUrlEdits, setTplUrlEdits] = useState<Record<string, string>>({});
  const [savingTplKey, setSavingTplKey] = useState<string | null>(null);

  const keyOf = (name: string, language?: string) => `${name}::${language || ""}`;
  // name+language → already-registered webhook URL.
  const registeredMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of tpls) {
      m.set(`${w.templateName}::${w.templateLanguage || ""}`, w.webhookUrl);
    }
    return m;
  }, [tpls]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cfg, webhooks] = await Promise.all([
        api.locationConfig.get(),
        api.whatsappTemplateWebhooks.list().catch(() => [] as TemplateWebhook[]),
      ]);
      setLocationId(cfg.locationId);
      setGaInstanceId(cfg.greenApiInstanceId ?? "");
      setGaBaseUrl(cfg.greenApiBaseUrl ?? "");
      setGaConfigured(cfg.greenApiConfigured);
      setBotUrl(cfg.botStatusWebhookUrl ?? "");
      setTpls(webhooks ?? []);
    } catch (e) {
      setError((e as Error)?.message ?? "No se pudo cargar la configuración.");
    } finally {
      setLoading(false);
    }
    // WhatsApp templates (from Meta). Loaded separately so a 409
    // WABA_MISSING doesn't break the rest of the page.
    try {
      const res = await api.templates.list({ type: "whatsapp" });
      setWaTemplates(res.templates ?? []);
      setWaTemplatesError(null);
    } catch (e) {
      const code = (e as { code?: string })?.code;
      setWaTemplatesError(
        code === "WABA_MISSING"
          ? "Registra primero el WABA ID (botón “Registrar WABA ID” en la barra lateral) para ver las plantillas de WhatsApp."
          : (e as Error)?.message ?? "No se pudieron cargar las plantillas de WhatsApp."
      );
      setWaTemplates([]);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const saveGreenApi = async () => {
    if (!gaInstanceId.trim() || !gaApiToken.trim()) {
      toast({
        title: "Faltan datos",
        description: "Instance ID y API Token son obligatorios.",
        variant: "destructive",
      });
      return;
    }
    setGaSaving(true);
    try {
      const r = await api.locationConfig.setGreenApi({
        instanceId: gaInstanceId.trim(),
        apiToken: gaApiToken.trim(),
        baseUrl: gaBaseUrl.trim(),
      });
      setGaConfigured(r.greenApiConfigured);
      setGaApiToken(""); // never keep the token in the field after saving
      toast({
        title: "Green API guardado",
        description: "Las credenciales de la sub-cuenta se actualizaron.",
      });
    } catch (e) {
      toast({
        title: "Error al guardar Green API",
        description: (e as Error)?.message,
        variant: "destructive",
      });
    } finally {
      setGaSaving(false);
    }
  };

  const deleteGreenApi = async () => {
    if (
      !window.confirm(
        "¿Eliminar las credenciales de Green API de esta sub-cuenta? El envío de archivos por WhatsApp dejará de funcionar hasta que registres unas nuevas."
      )
    ) {
      return;
    }
    setGaDeleting(true);
    try {
      // Empty values clear the stored credentials on the backend.
      await api.locationConfig.setGreenApi({
        instanceId: "",
        apiToken: "",
        baseUrl: "",
      });
      setGaInstanceId("");
      setGaApiToken("");
      setGaBaseUrl("");
      setGaConfigured(false);
      toast({
        title: "Green API eliminado",
        description: "Las credenciales de la sub-cuenta se borraron.",
      });
    } catch (e) {
      toast({
        title: "Error al eliminar",
        description: (e as Error)?.message,
        variant: "destructive",
      });
    } finally {
      setGaDeleting(false);
    }
  };

  const saveBotWebhook = async () => {
    setBotSaving(true);
    try {
      const r = await api.locationConfig.setBotStatusWebhookUrl(
        botUrl.trim() || null
      );
      // The backend auto-fires a sample POST on save — surface its outcome.
      const probeNote = r.probe
        ? r.probe.ok
          ? " — prueba ✓"
          : ` — prueba falló (${r.probe.status})`
        : "";
      toast({
        title: "Webhook guardado",
        description: `El webhook del bot de IA se actualizó${probeNote}.`,
        variant: r.probe && !r.probe.ok ? "destructive" : undefined,
      });
    } catch (e) {
      toast({
        title: "Error al guardar el webhook",
        description: (e as Error)?.message,
        variant: "destructive",
      });
    } finally {
      setBotSaving(false);
    }
  };

  const probeBotWebhook = async () => {
    if (!botUrl.trim()) {
      toast({
        title: "Falta la URL",
        description: "Escribe la URL del webhook antes de probar.",
        variant: "destructive",
      });
      return;
    }
    setBotProbing(true);
    try {
      const r = await api.locationConfig.probeBotStatusWebhook(
        botUrl.trim(),
        "paused"
      );
      toast({
        title: r.ok ? "Prueba enviada ✓" : "La prueba falló",
        description: `Estado ${r.status}${
          r.bodySnippet ? ` — ${r.bodySnippet}` : ""
        }`,
        variant: r.ok ? undefined : "destructive",
      });
    } catch (e) {
      toast({
        title: "Error en la prueba",
        description: (e as Error)?.message,
        variant: "destructive",
      });
    } finally {
      setBotProbing(false);
    }
  };

  // Register (or clear, with an empty URL) the webhook for one template. The
  // template name + language come from the listed template — the agent only
  // enters the URL. Backend auto-probes (sends a sample POST) on save.
  const saveTemplateWebhook = async (
    name: string,
    language: string | undefined,
    url: string
  ) => {
    const key = keyOf(name, language);
    setSavingTplKey(key);
    try {
      const trimmed = url.trim();
      if (trimmed) {
        const r = await api.whatsappTemplateWebhooks.upsert(
          name,
          trimmed,
          language || undefined
        );
        const probeNote = r.probe
          ? r.probe.ok
            ? " — prueba ✓"
            : ` — prueba falló (${r.probe.status})`
          : "";
        toast({ title: "Webhook guardado", description: `${name}${probeNote}` });
      } else {
        await api.whatsappTemplateWebhooks.remove(name, language || undefined);
        toast({ title: "Webhook eliminado", description: name });
      }
      const webhooks = await api.whatsappTemplateWebhooks
        .list()
        .catch(() => tpls);
      setTpls(webhooks);
      setTplUrlEdits((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } catch (e) {
      toast({
        title: "Error al guardar el webhook",
        description: (e as Error)?.message,
        variant: "destructive",
      });
    } finally {
      setSavingTplKey(null);
    }
  };

  const removeTemplateWebhook = async (name: string, language: string) => {
    try {
      await api.whatsappTemplateWebhooks.remove(name, language || undefined);
      toast({ title: "Plantilla eliminada", description: name });
      await loadAll();
    } catch (e) {
      toast({
        title: "Error al eliminar",
        description: (e as Error)?.message,
        variant: "destructive",
      });
    }
  };

  const probeTemplateWebhook = async (name: string, language: string) => {
    try {
      const r = await api.whatsappTemplateWebhooks.probe(
        name,
        language || undefined
      );
      toast({
        title: r.ok ? "Prueba exitosa ✓" : "La prueba falló",
        description: `Estado ${r.status}${r.message ? ` — ${r.message}` : ""}`,
        variant: r.ok ? undefined : "destructive",
      });
    } catch (e) {
      toast({
        title: "Error en la prueba",
        description: (e as Error)?.message,
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="max-w-4xl mx-auto py-10 px-6 space-y-6">
        <div className="flex items-start gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full shrink-0"
            onClick={() => navigate(-1)}
            title="Volver"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">Configuración</h1>
            <p className="text-sm text-muted-foreground">
              Ajustes de esta sub-cuenta
              {locationId ? ` (${locationId})` : ""}.
            </p>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* 1) Green API credentials */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-violet-500" />
              Green API (envío de archivos)
            </CardTitle>
            <CardDescription>
              Credenciales del número de WhatsApp de esta sub-cuenta. Los
              archivos se envían directamente por esta instancia.
              {gaConfigured && (
                <span className="ml-1 font-medium text-emerald-600">
                  Configurado ✓
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="ga-instance">Instance ID (idInstance)</Label>
              <Input
                id="ga-instance"
                value={gaInstanceId}
                onChange={(e) => setGaInstanceId(e.target.value)}
                placeholder="7107635364"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ga-token">API Token (apiTokenInstance)</Label>
              <Input
                id="ga-token"
                type="password"
                value={gaApiToken}
                onChange={(e) => setGaApiToken(e.target.value)}
                placeholder={
                  gaConfigured
                    ? "•••••••• (escríbelo de nuevo solo para cambiarlo)"
                    : "Pega el apiTokenInstance"
                }
              />
              {gaConfigured && (
                <p className="text-xs text-muted-foreground">
                  Por seguridad el token no se muestra. Déjalo vacío para
                  conservar el actual.
                </p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ga-base">Base URL (opcional)</Label>
              <Input
                id="ga-base"
                value={gaBaseUrl}
                onChange={(e) => setGaBaseUrl(e.target.value)}
                placeholder="https://7107.api.greenapi.com (se deduce si lo dejas vacío)"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={saveGreenApi} disabled={gaSaving} className="gap-2">
                {gaSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Guardar Green API
              </Button>
              {gaConfigured && (
                <Button
                  onClick={deleteGreenApi}
                  disabled={gaDeleting}
                  variant="outline"
                  className="gap-2 text-destructive hover:text-destructive"
                >
                  {gaDeleting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  Eliminar credenciales
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* 2) Conversation AI bot inbound webhook */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-violet-500" />
              Bot de IA — Webhook Entrante
            </CardTitle>
            <CardDescription>
              URL del Webhook Entrante del workflow que activa/pausa el bot de IA
              (acción “Update Conversation AI Bot and Status”).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="bot-url">Inbound Webhook URL</Label>
              <Input
                id="bot-url"
                value={botUrl}
                onChange={(e) => setBotUrl(e.target.value)}
                placeholder="https://services.leadconnectorhq.com/hooks/.../webhook-trigger/..."
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={saveBotWebhook} disabled={botSaving} className="gap-2">
                {botSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Guardar webhook del bot
              </Button>
              <Button
                onClick={probeBotWebhook}
                disabled={botProbing}
                variant="outline"
                className="gap-2"
              >
                {botProbing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Wifi className="h-4 w-4" />
                )}
                Enviar prueba
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              “Enviar prueba” hace un POST{" "}
              <code className="rounded bg-muted px-1">
                {"{ contactId, status: \"paused\" }"}
              </code>{" "}
              al webhook — útil para confirmar que responde y para que GHL
              capture el campo <code className="rounded bg-muted px-1">status</code>{" "}
              en el workflow.
            </p>
          </CardContent>
        </Card>

        {/* 3) WhatsApp template webhooks */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-emerald-500" />
              Plantillas de WhatsApp — Webhooks
            </CardTitle>
            <CardDescription>
              Todas tus plantillas de WhatsApp. Para habilitar el envío, pega la
              URL del Inbound Webhook (un workflow por plantilla) y guarda.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {waTemplatesError ? (
              <p className="text-sm text-muted-foreground">{waTemplatesError}</p>
            ) : waTemplates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No hay plantillas de WhatsApp.
              </p>
            ) : (
              <div className="space-y-3">
                {waTemplates.map((t) => {
                  const key = keyOf(t.name, t.language);
                  const registered = registeredMap.has(key);
                  const value =
                    tplUrlEdits[key] ?? registeredMap.get(key) ?? "";
                  return (
                    <div key={t.id} className="space-y-2 rounded-lg border p-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{t.name}</span>
                        {t.language && (
                          <span className="text-xs text-muted-foreground">
                            {t.language}
                          </span>
                        )}
                        {registered && (
                          <span className="text-xs font-medium text-emerald-600">
                            registrado ✓
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          value={value}
                          onChange={(e) =>
                            setTplUrlEdits((p) => ({ ...p, [key]: e.target.value }))
                          }
                          placeholder="https://services.leadconnectorhq.com/hooks/.../webhook-trigger/..."
                          className="min-w-[220px] flex-1"
                        />
                        <Button
                          size="sm"
                          className="gap-2"
                          disabled={savingTplKey === key}
                          onClick={() =>
                            saveTemplateWebhook(t.name, t.language, value)
                          }
                        >
                          {savingTplKey === key ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Save className="h-4 w-4" />
                          )}
                          Guardar
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
