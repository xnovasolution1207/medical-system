// "Subir Plantilla WhatsApp" — the rich scheduling dialog used when
// the agent picks "Programar plantilla de WhatsApp" from the entry
// popover. Implements section 1.5 of the spec:
//
//   1. Pick a saved GHL template (filtered to `type=whatsapp`).
//   2. Read its header / body / buttons (display-only — Meta-approved
//      templates can't be edited inline).
//   3. Live preview on the right styled as a WhatsApp bubble.
//   4. Choose when to send (preset times or "Personalizado..." for an
//      arbitrary datetime).
//   5. Submit — parent owns the optimistic update + API call.
//
// Mandatory for WhatsApp once the conversation has been quiet > 24h
// (Meta's policy). The popover that opens this dialog also surfaces a
// free-form path for SMS/email, so we don't enforce the 24h rule here
// — by the time the agent is looking at this dialog they've already
// chosen the template path.
import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Clock, CornerUpLeft, Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { WabaRegistrationDialog } from "./WabaRegistrationDialog";
import {
  SCHEDULE_OPTIONS,
  defaultLocalDatetime,
  nowLocalDatetime,
  resolveScheduleOption,
  type ScheduleOptionId,
} from "./scheduleOptions";
import type { Conversation, Message, MessageTemplate } from "./types";

interface WhatsAppTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversation: Conversation;
  // Channel the message will be sent on — fixed to "whatsapp" by the
  // entry popover but kept generic so the same dialog can be reused
  // for sms/email template scheduling later.
  channel: NonNullable<Message["channel"]>;
  // Parent owns the optimistic update + API call. The dialog stays
  // presentational and just hands back the form values on submit.
  onSubmit: (payload: {
    text: string;
    scheduledFor: string;
    channel: NonNullable<Message["channel"]>;
    templateId?: string;
    templateName?: string;
    // BCP-47 tag captured at pick-time so the dispatcher doesn't need
    // to re-list templates to recover the language at send time.
    templateLanguage?: string;
  }) => Promise<void> | void;
}

// Best-effort splitter — many templates are written as a single body
// string (no separate header field). We treat the first line as the
// header and the rest as the body so the preview reads like the GHL
// reference UI even without explicit metadata.
function splitTemplateBody(body: string): { header: string; rest: string } {
  const lines = body.split(/\r?\n/);
  const header = lines[0]?.trim() ?? "";
  const rest = lines.slice(1).join("\n").trim();
  return { header, rest };
}

export function ScheduleMessageDialog({
  open,
  onOpenChange,
  conversation,
  channel,
  onSubmit,
}: WhatsAppTemplateDialogProps) {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<MessageTemplate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string>("");
  const [scheduleOptionId, setScheduleOptionId] = useState<ScheduleOptionId>("manana_9am");
  const [customDatetime, setCustomDatetime] = useState(defaultLocalDatetime);
  const [submitting, setSubmitting] = useState(false);
  // When the backend reports WABA_MISSING we pop the registration
  // modal; on a successful save we re-run the templates fetch via this
  // bumper instead of duplicating the effect logic inline.
  const [wabaModalOpen, setWabaModalOpen] = useState(false);
  const [fetchNonce, setFetchNonce] = useState(0);

  // Reset every open so the dialog never resurrects stale state.
  useEffect(() => {
    if (!open) return;
    setSelectedId("");
    setScheduleOptionId("manana_9am");
    setCustomDatetime(defaultLocalDatetime());
  }, [open]);

  // Fetch templates whenever the dialog opens. Filtered to the active
  // channel (typically whatsapp). Empty list is a real outcome — the
  // tenant simply hasn't registered any templates of that type yet.
  //
  // Special case: when channel=whatsapp and the backend returns
  // WABA_MISSING (HTTP 409 with ApiError.code), we open the
  // registration modal instead of showing a generic toast. The modal's
  // onSaved callback bumps `fetchNonce` so this effect re-runs and
  // hydrates the picker once the WABA is in place.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    api.templates
      .list({ type: channel === "whatsapp" || channel === "sms" || channel === "email" ? channel : undefined })
      .then((res) => {
        if (cancelled) return;
        setTemplates(res.templates ?? []);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.code === "WABA_MISSING") {
          setTemplates([]);
          setWabaModalOpen(true);
          return;
        }
        console.warn("[schedule] templates fetch failed", err);
        setTemplates([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, channel, fetchNonce]);

  const selected = useMemo(
    () => templates?.find((t) => t.id === selectedId),
    [templates, selectedId]
  );
  const split = useMemo(() => splitTemplateBody(selected?.body ?? ""), [selected]);

  const canSubmit = !!selectedId && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit || !selected) return;
    setSubmitting(true);
    try {
      const date =
        scheduleOptionId === "custom"
          ? new Date(customDatetime)
          : resolveScheduleOption(scheduleOptionId);
      if (!date || isNaN(date.getTime())) {
        throw new Error("Fecha y hora inválidas.");
      }
      // Reject any time at or before now. A small 30 s grace window
      // covers the case where the agent picked "En 1 hora", paused, and
      // the preset slid into the past — we still treat that as valid.
      if (date.getTime() < Date.now() - 30_000) {
        throw new Error("No puedes programar una plantilla en el pasado.");
      }
      await onSubmit({
        text: selected.body,
        scheduledFor: date.toISOString(),
        channel,
        templateId: selected.id,
        templateName: selected.name,
        templateLanguage: selected.language,
      });
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "No se pudo programar la plantilla",
        description: (err as Error)?.message ?? String(err),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Friendly preview timestamp for the bubble on the right — shows
  // either the resolved preset time or whatever the agent typed in the
  // custom picker.
  const previewTime = useMemo(() => {
    const d =
      scheduleOptionId === "custom"
        ? new Date(customDatetime)
        : resolveScheduleOption(scheduleOptionId);
    if (!d || isNaN(d.getTime())) return "";
    return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  }, [scheduleOptionId, customDatetime]);

  return (
    <>
    <WabaRegistrationDialog
      open={wabaModalOpen}
      onOpenChange={setWabaModalOpen}
      onSaved={() => setFetchNonce((n) => n + 1)}
    />
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Subir Plantilla WhatsApp</DialogTitle>
          <DialogDescription className="sr-only">
            Selecciona una plantilla aprobada y la fecha en que se enviará.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-[1fr_280px]">
          {/* LEFT — form */}
          <div className="space-y-4 min-w-0">
            <div className="space-y-1.5">
              <Label htmlFor="wa-template" className="text-sm font-medium">
                Seleccionar plantilla de WhatsApp
              </Label>
              <Select
                value={selectedId}
                onValueChange={setSelectedId}
                disabled={loading}
              >
                <SelectTrigger id="wa-template" className="h-10">
                  <SelectValue
                    placeholder={
                      loading
                        ? "Cargando plantillas..."
                        : (templates?.length ?? 0) === 0
                          ? "Sin plantillas registradas"
                          : "Seleccionar plantilla..."
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {(templates ?? []).map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Tags row — language + category. Hardcoded for now since
                GHL's templates endpoint doesn't surface these fields. */}
            {selected && (
              <div className="flex gap-2">
                <Badge variant="outline" className="bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:border-violet-500/30">
                  {selected.type === "whatsapp" ? "WhatsApp" : selected.type.toUpperCase()}
                </Badge>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="wa-header" className="text-sm font-medium">
                Encabezado
              </Label>
              <Input
                id="wa-header"
                value={split.header}
                readOnly
                placeholder="Encabezado del mensaje"
                className="h-10 bg-muted/40"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="wa-body" className="text-sm font-medium">
                Cuerpo
              </Label>
              <Textarea
                id="wa-body"
                value={split.rest || selected?.body || ""}
                readOnly
                rows={6}
                placeholder="Cuerpo del mensaje..."
                className="bg-muted/40 text-sm resize-none"
              />
            </div>
          </div>

          {/* RIGHT — preview */}
          <div className="space-y-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-center">
              Vista previa
            </div>
            <div className="rounded-2xl bg-amber-50 dark:bg-amber-500/10 p-4 min-h-[180px]">
              {selected ? (
                <div className="rounded-2xl bg-white dark:bg-slate-800 px-3 py-2 shadow-sm">
                  {split.header && (
                    <div className="text-[13px] font-bold text-slate-900 dark:text-slate-100 mb-1">
                      {split.header}
                    </div>
                  )}
                  <div className="text-[13px] text-slate-800 dark:text-slate-200 whitespace-pre-wrap">
                    {split.rest || selected.body}
                  </div>
                  <div className="mt-2 text-right text-[10px] text-slate-400">
                    {previewTime} h
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl bg-white dark:bg-slate-800 px-3 py-2 text-right text-[10px] text-slate-400">
                  {previewTime || "--:--"} h
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="!justify-between gap-3 mt-2 flex-col sm:flex-row">
          <div className="flex items-center gap-2">
            <Label htmlFor="wa-when" className="text-sm font-medium shrink-0">
              Programar para:
            </Label>
            <Select
              value={scheduleOptionId}
              onValueChange={(v) => setScheduleOptionId(v as ScheduleOptionId)}
            >
              <SelectTrigger id="wa-when" className="h-9 min-w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCHEDULE_OPTIONS.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {scheduleOptionId === "custom" && (
              <Input
                type="datetime-local"
                value={customDatetime}
                onChange={(e) => setCustomDatetime(e.target.value)}
                min={nowLocalDatetime()}
                className="h-9 text-sm w-[200px]"
              />
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={!canSubmit} className="gap-2">
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Clock className="h-4 w-4" />
              )}
              Programar Plantilla
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
