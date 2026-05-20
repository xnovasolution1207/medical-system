import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Save,
  Trash2,
  ExternalLink,
  Send,
  RefreshCw,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";

// Settings → WhatsApp Templates page.
//
// One row per Meta-approved WhatsApp template (listed via the existing
// /api/templates?type=whatsapp endpoint). For each template the
// operator pastes the corresponding GHL Workflow webhook URL and saves.
// The backend auto-fires a sample POST to GHL on save so the
// workflow's Mapping Reference is populated immediately — operator
// only needs to refresh the trigger settings in GHL and publish.
//
// Why this page exists: GHL's "Send WhatsApp" action requires a static
// template selection (no `{{...}}` dynamic picker), so each template
// needs its own workflow with its own webhook URL. The backend maps
// templateName → webhookUrl in SQLite, and this page is the operator's
// UI for managing those mappings.

interface MetaTemplate {
  // Same shape returned by /api/templates?type=whatsapp; only the
  // fields used here are typed.
  id: string;
  name: string;
  language?: string;
  whatsappDetail?: {
    status?: string;
    category?: string;
  };
}

interface WebhookRow {
  templateName: string;
  webhookUrl: string;
  updatedAt: string;
}

interface RowState {
  url: string;
  saving: boolean;
  probing: boolean;
  lastProbe: { ok: boolean; status: number; message?: string } | null;
  dirty: boolean;
  initialUrl: string;
}

const EMPTY_ROW: RowState = {
  url: "",
  saving: false,
  probing: false,
  lastProbe: null,
  dirty: false,
  initialUrl: "",
};

const SettingsWhatsAppTemplates: React.FC = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<MetaTemplate[]>([]);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [error, setError] = useState<string | null>(null);

  // Load both the Meta templates list and the existing webhook
  // mappings in parallel on mount. Pair them by templateName.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [tplPayload, hooks] = await Promise.all([
          api.templates.list({ type: "whatsapp" }) as Promise<
            { templates: MetaTemplate[] } | MetaTemplate[]
          >,
          api.whatsappTemplateWebhooks.list().catch(() => [] as WebhookRow[]),
        ]);
        if (cancelled) return;
        // The templates endpoint can return either {templates: [...]}
        // (newer shape) or a bare array (older mock fallback). Handle both.
        const tplList = Array.isArray(tplPayload)
          ? tplPayload
          : tplPayload?.templates ?? [];
        const byName: Record<string, RowState> = {};
        for (const tpl of tplList) {
          const hook = hooks.find((h) => h.templateName === tpl.name);
          byName[tpl.name] = {
            ...EMPTY_ROW,
            url: hook?.webhookUrl ?? "",
            initialUrl: hook?.webhookUrl ?? "",
          };
        }
        setTemplates(tplList);
        setRows(byName);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Error cargando plantillas."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateRow = (name: string, patch: Partial<RowState>) => {
    setRows((prev) => ({
      ...prev,
      [name]: { ...(prev[name] ?? EMPTY_ROW), ...patch },
    }));
  };

  const handleUrlChange = (name: string, value: string) => {
    updateRow(name, {
      url: value,
      dirty: value !== (rows[name]?.initialUrl ?? ""),
    });
  };

  const handleSave = async (name: string) => {
    const row = rows[name];
    if (!row) return;
    const trimmed = row.url.trim();
    if (
      trimmed &&
      !/^https:\/\/services\.leadconnectorhq\.com\/hooks\//.test(trimmed)
    ) {
      toast({
        title: "URL no válida",
        description:
          "La URL debe comenzar con https://services.leadconnectorhq.com/hooks/...",
        variant: "destructive",
      });
      return;
    }
    updateRow(name, { saving: true });
    try {
      const result = await api.whatsappTemplateWebhooks.upsert(name, trimmed);
      const probe = result?.probe ?? null;
      updateRow(name, {
        saving: false,
        dirty: false,
        initialUrl: trimmed,
        lastProbe: probe,
      });
      if (!trimmed) {
        toast({ title: "Webhook eliminado", description: name });
        return;
      }
      if (probe?.ok) {
        toast({
          title: "Guardado y muestra enviada",
          description:
            "Ve a GHL → trigger → REFERENCIA DE MAPEO → 'Buscar nuevas solicitudes' → selecciona la captura y publica.",
        });
      } else {
        toast({
          title: "Guardado, pero la muestra falló",
          description: `GHL devolvió ${probe?.status ?? "?"}. Verifica que la URL es correcta.`,
          variant: "destructive",
        });
      }
    } catch (err) {
      updateRow(name, { saving: false });
      toast({
        title: "Error al guardar",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  const handleProbe = async (name: string) => {
    const row = rows[name];
    if (!row) return;
    updateRow(name, { probing: true });
    try {
      const probe = await api.whatsappTemplateWebhooks.probe(name);
      updateRow(name, { probing: false, lastProbe: probe });
      if (probe.ok) {
        toast({
          title: "Muestra reenviada",
          description: `GHL aceptó (${probe.status}). Refresca REFERENCIA DE MAPEO en GHL.`,
        });
      } else {
        toast({
          title: "La muestra falló",
          description: `GHL devolvió ${probe.status}. ${probe.message ?? ""}`,
          variant: "destructive",
        });
      }
    } catch (err) {
      updateRow(name, { probing: false });
      toast({
        title: "Error al reenviar muestra",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  const handleClear = async (name: string) => {
    updateRow(name, { saving: true });
    try {
      await api.whatsappTemplateWebhooks.remove(name);
      updateRow(name, {
        saving: false,
        dirty: false,
        url: "",
        initialUrl: "",
        lastProbe: null,
      });
      toast({ title: "Webhook eliminado", description: name });
    } catch (err) {
      updateRow(name, { saving: false });
      toast({
        title: "Error al eliminar",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  const stats = useMemo(() => {
    const total = templates.length;
    const wired = templates.filter(
      (t) => (rows[t.name]?.initialUrl ?? "").trim().length > 0
    ).length;
    return { total, wired, missing: total - wired };
  }, [templates, rows]);

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/")}
              aria-label="Volver"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                Plantillas WhatsApp
              </h1>
              <p className="text-sm text-muted-foreground">
                Conecta cada plantilla de Meta con su workflow de GHL.
              </p>
            </div>
          </div>
          {!loading && (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {stats.wired}/{stats.total} configuradas
              </Badge>
              {stats.missing > 0 && (
                <Badge variant="destructive" className="text-xs">
                  {stats.missing} sin configurar
                </Badge>
              )}
            </div>
          )}
        </div>

        {/* Instructions */}
        <div className="mb-6 rounded-lg border bg-card p-4 text-sm">
          <p className="mb-2 font-semibold">¿Cómo agregar una plantilla nueva?</p>
          <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
            <li>
              Aprueba la plantilla en{" "}
              <a
                href="https://business.facebook.com/wa/manage/message-templates"
                target="_blank"
                rel="noreferrer"
                className="text-primary underline inline-flex items-center gap-1"
              >
                Meta Business Manager <ExternalLink className="h-3 w-3" />
              </a>
              . La plantilla aparecerá automáticamente en esta tabla.
            </li>
            <li>
              En GHL → Automation → Workflows: clona tu workflow base{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                WA Template Send
              </code>
              , cambia el template seleccionado en la acción{" "}
              <em>Send WhatsApp</em> al nuevo, y copia la URL del trigger.
            </li>
            <li>
              Pega la URL en la fila correspondiente abajo y haz clic en{" "}
              <strong>Guardar</strong>. Enviamos una muestra automáticamente a
              GHL.
            </li>
            <li>
              Vuelve a GHL → trigger → <em>REFERENCIA DE MAPEO</em> → clic en{" "}
              <em>Buscar nuevas solicitudes</em>, selecciona la captura y{" "}
              publica el workflow.
            </li>
          </ol>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : templates.length === 0 ? (
          <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
            No hay plantillas aprobadas en Meta para esta ubicación. Crea una
            plantilla en Business Manager y vuelve aquí.
          </div>
        ) : (
          <div className="space-y-3">
            {templates.map((tpl) => {
              const row = rows[tpl.name] ?? EMPTY_ROW;
              const isWired =
                (row.initialUrl ?? "").trim().length > 0 && !row.dirty;
              const status = tpl.whatsappDetail?.status ?? "APPROVED";
              const category = tpl.whatsappDetail?.category ?? "";
              return (
                <div
                  key={tpl.id}
                  className="rounded-lg border bg-card p-4 shadow-sm"
                >
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-semibold break-all">
                          {tpl.name}
                        </span>
                        {tpl.language && (
                          <Badge variant="secondary" className="text-[10px]">
                            {tpl.language}
                          </Badge>
                        )}
                        {category && (
                          <Badge variant="outline" className="text-[10px]">
                            {category}
                          </Badge>
                        )}
                        {status && status !== "APPROVED" && (
                          <Badge
                            variant="outline"
                            className="text-[10px] border-amber-400 text-amber-700"
                          >
                            {status}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div>
                      {isWired ? (
                        <Badge
                          variant="outline"
                          className="border-emerald-500 text-emerald-700"
                        >
                          <CheckCircle2 className="mr-1 h-3 w-3" /> Configurado
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-amber-500 text-amber-700"
                        >
                          <AlertCircle className="mr-1 h-3 w-3" /> Falta
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Input
                      placeholder="https://services.leadconnectorhq.com/hooks/.../webhook-trigger/..."
                      value={row.url}
                      onChange={(e) => handleUrlChange(tpl.name, e.target.value)}
                      className="font-mono text-xs"
                    />
                    <div className="flex shrink-0 gap-2">
                      <Button
                        onClick={() => handleSave(tpl.name)}
                        disabled={row.saving || (!row.dirty && row.initialUrl === row.url)}
                        size="sm"
                      >
                        {row.saving ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Save className="mr-1 h-3.5 w-3.5" />
                            Guardar
                          </>
                        )}
                      </Button>
                      {row.initialUrl && (
                        <>
                          <Button
                            variant="outline"
                            onClick={() => handleProbe(tpl.name)}
                            disabled={row.probing || row.dirty}
                            size="sm"
                            title="Reenviar muestra a GHL"
                          >
                            {row.probing ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3.5 w-3.5" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => handleClear(tpl.name)}
                            disabled={row.saving}
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            title="Eliminar webhook"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  {row.lastProbe && (
                    <p
                      className={`mt-2 text-xs ${
                        row.lastProbe.ok
                          ? "text-emerald-700"
                          : "text-destructive"
                      }`}
                    >
                      {row.lastProbe.ok ? (
                        <>
                          <Send className="mr-1 inline h-3 w-3" /> Última muestra
                          aceptada ({row.lastProbe.status}).
                        </>
                      ) : (
                        <>
                          <AlertCircle className="mr-1 inline h-3 w-3" /> Última
                          muestra falló ({row.lastProbe.status}
                          {row.lastProbe.message ? `: ${row.lastProbe.message}` : ""}
                          ).
                        </>
                      )}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default SettingsWhatsAppTemplates;
