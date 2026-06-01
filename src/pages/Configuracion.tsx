import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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

  // --- Bot status webhook ---
  const [botUrl, setBotUrl] = useState("");
  const [botSaving, setBotSaving] = useState(false);
  const [botProbing, setBotProbing] = useState(false);

  // --- Template webhooks ---
  const [tpls, setTpls] = useState<TemplateWebhook[]>([]);
  const [tplName, setTplName] = useState("");
  const [tplLang, setTplLang] = useState("");
  const [tplUrl, setTplUrl] = useState("");
  const [tplSaving, setTplSaving] = useState(false);

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

  const addTemplateWebhook = async () => {
    if (!tplName.trim() || !tplUrl.trim()) {
      toast({
        title: "Faltan datos",
        description: "Nombre de la plantilla y URL son obligatorios.",
        variant: "destructive",
      });
      return;
    }
    setTplSaving(true);
    try {
      const r = await api.whatsappTemplateWebhooks.upsert(
        tplName.trim(),
        tplUrl.trim(),
        tplLang.trim() || undefined
      );
      const probeNote = r.probe
        ? r.probe.ok
          ? " — prueba ✓"
          : ` — prueba falló (${r.probe.status})`
        : "";
      toast({
        title: "Plantilla registrada",
        description: `${r.templateName}${probeNote}`,
      });
      setTplName("");
      setTplLang("");
      setTplUrl("");
      await loadAll();
    } catch (e) {
      toast({
        title: "Error al registrar la plantilla",
        description: (e as Error)?.message,
        variant: "destructive",
      });
    } finally {
      setTplSaving(false);
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
            <Button onClick={saveGreenApi} disabled={gaSaving} className="gap-2">
              {gaSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Guardar Green API
            </Button>
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
              Un workflow (Inbound Webhook) por plantilla. Registra el nombre de
              la plantilla, su idioma y la URL del webhook.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {tpls.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No hay plantillas registradas todavía.
              </p>
            ) : (
              <div className="space-y-2">
                {tpls.map((t) => (
                  <div
                    key={`${t.templateName}:${t.templateLanguage}`}
                    className="flex items-center gap-2 rounded-lg border p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">
                        {t.templateName}{" "}
                        <span className="text-xs text-muted-foreground">
                          {t.templateLanguage || "—"}
                        </span>
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {t.webhookUrl}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1"
                      onClick={() =>
                        probeTemplateWebhook(t.templateName, t.templateLanguage)
                      }
                      title="Probar webhook"
                    >
                      <Wifi className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() =>
                        removeTemplateWebhook(t.templateName, t.templateLanguage)
                      }
                      title="Eliminar"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <Separator />

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="tpl-name">Nombre de la plantilla</Label>
                <Input
                  id="tpl-name"
                  value={tplName}
                  onChange={(e) => setTplName(e.target.value)}
                  placeholder="recordatorio_cita"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="tpl-lang">Idioma (opcional)</Label>
                <Input
                  id="tpl-lang"
                  value={tplLang}
                  onChange={(e) => setTplLang(e.target.value)}
                  placeholder="es / en"
                />
              </div>
              <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor="tpl-url">Inbound Webhook URL</Label>
                <Input
                  id="tpl-url"
                  value={tplUrl}
                  onChange={(e) => setTplUrl(e.target.value)}
                  placeholder="https://services.leadconnectorhq.com/hooks/.../webhook-trigger/..."
                />
              </div>
            </div>
            <Button
              onClick={addTemplateWebhook}
              disabled={tplSaving}
              className="gap-2"
            >
              {tplSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Registrar plantilla
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
