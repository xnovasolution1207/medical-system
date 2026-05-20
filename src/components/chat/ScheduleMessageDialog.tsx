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
import { Clock, CornerUpLeft, Loader2, Send } from "lucide-react";
import { ApiError } from "@/lib/api";
import { useTemplates, useInvalidateTemplates, templateButtonsFor } from "@/lib/templatesQuery";
import { useToast } from "@/hooks/use-toast";
import { WabaRegistrationDialog } from "./WabaRegistrationDialog";
import {
  SCHEDULE_OPTIONS,
  defaultLocalDatetime,
  nowLocalDatetime,
  resolveScheduleOption,
  type ScheduleOptionId,
} from "./scheduleOptions";
import type { Conversation, Message, MessageButton, MessageTemplate } from "./types";

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
    // Action buttons declared on the Meta template, flattened for the
    // chat bubble. Forwarded so the optimistic message can render them
    // (GHL strips template structure off the echoed message).
    buttons?: MessageButton[];
  }) => Promise<void> | void;
  // Instant-send path ("Enviar ahora" button). Same payload as
  // onSubmit minus scheduledFor — the parent fires the template
  // through the regular send pipeline immediately instead of queueing
  // it. Optional so existing callers that only want scheduling can
  // omit it and the button hides.
  onSendNow?: (payload: {
    text: string;
    channel: NonNullable<Message["channel"]>;
    templateId: string;
    templateName?: string;
    templateLanguage?: string;
    buttons?: MessageButton[];
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
  onSendNow,
}: WhatsAppTemplateDialogProps) {
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<string>("");
  const [scheduleOptionId, setScheduleOptionId] = useState<ScheduleOptionId>("manana_9am");
  const [customDatetime, setCustomDatetime] = useState(defaultLocalDatetime);
  const [submitting, setSubmitting] = useState(false);
  const [sendingNow, setSendingNow] = useState(false);
  const [wabaModalOpen, setWabaModalOpen] = useState(false);

  // Narrow `channel` to the three the templates endpoint actually
  // serves — anything else (`internal`, future channels) skips the
  // fetch entirely.
  const templateChannel =
    channel === "whatsapp" || channel === "sms" || channel === "email"
      ? channel
      : undefined;

  // React Query owns the templates list now — cached per channel,
  // shared across the app, instant on reopen. `enabled: open` keeps
  // the request from firing until the dialog is actually visible.
  const templatesQuery = useTemplates(templateChannel, { enabled: open });
  const templates = templatesQuery.data;
  const loading = templatesQuery.isLoading || templatesQuery.isFetching;
  const invalidateTemplates = useInvalidateTemplates();

  // WABA_MISSING surfaces as a query error — pop the registration
  // modal once instead of toasting a generic failure. We rely on the
  // dialog's `open` gate to avoid re-triggering the modal after the
  // user closes it: the query won't refetch while closed, and the
  // post-registration invalidate refreshes the cache so the next
  // render no longer carries the error.
  useEffect(() => {
    if (!open) return;
    const err = templatesQuery.error;
    if (err instanceof ApiError && err.code === "WABA_MISSING") {
      setWabaModalOpen(true);
    }
  }, [open, templatesQuery.error]);

  // Reset every open so the dialog never resurrects stale state.
  useEffect(() => {
    if (!open) return;
    setSelectedId("");
    setScheduleOptionId("manana_9am");
    setCustomDatetime(defaultLocalDatetime());
  }, [open]);

  const selected = useMemo(
    () => templates?.find((t) => t.id === selectedId),
    [templates, selectedId]
  );
  const split = useMemo(() => splitTemplateBody(selected?.body ?? ""), [selected]);

  const canSubmit = !!selectedId && !submitting && !sendingNow;
  const canSendNow = !!selectedId && !!onSendNow && !submitting && !sendingNow;

  const handleSendNow = async () => {
    if (!canSendNow || !selected || !onSendNow) return;
    setSendingNow(true);
    try {
      await onSendNow({
        text: selected.body,
        channel,
        templateId: selected.id,
        templateName: selected.name,
        templateLanguage: selected.language,
        buttons: templateButtonsFor(templates, selected.name, selected.language),
      });
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "No se pudo enviar la plantilla",
        description: (err as Error)?.message ?? String(err),
        variant: "destructive",
      });
    } finally {
      setSendingNow(false);
    }
  };

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
        buttons: templateButtonsFor(templates, selected.name, selected.language),
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
      onSaved={() => invalidateTemplates(templateChannel)}
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

            {/* Tags row — channel + (for WhatsApp) status, category,
                language, quality score. All driven by the rich
                whatsappDetail payload from Meta. */}
            {selected && (
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:border-violet-500/30">
                  {selected.type === "whatsapp" ? "WhatsApp" : selected.type.toUpperCase()}
                </Badge>
                {selected.language && (
                  <Badge variant="outline" className="bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-500/10 dark:text-slate-300 dark:border-slate-500/30">
                    {selected.language}
                  </Badge>
                )}
                {selected.whatsappDetail?.category && (
                  <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/30">
                    {selected.whatsappDetail.category}
                  </Badge>
                )}
                {selected.whatsappDetail?.status && (
                  <Badge
                    variant="outline"
                    className={
                      selected.whatsappDetail.status === "APPROVED"
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30"
                        : selected.whatsappDetail.status === "PENDING"
                          ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30"
                          : selected.whatsappDetail.status === "REJECTED"
                            ? "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30"
                            : "bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-500/10 dark:text-slate-300 dark:border-slate-500/30"
                    }
                  >
                    {selected.whatsappDetail.status}
                  </Badge>
                )}
                {selected.whatsappDetail?.qualityScore?.score && (
                  <Badge variant="outline" className="bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-500/10 dark:text-slate-300 dark:border-slate-500/30">
                    Calidad: {selected.whatsappDetail.qualityScore.score}
                  </Badge>
                )}
              </div>
            )}
            {selected?.whatsappDetail?.rejectedReason && (
              <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                <strong className="font-semibold">Rechazada:</strong>{" "}
                {selected.whatsappDetail.rejectedReason}
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
            <div className="rounded-2xl bg-amber-50 dark:bg-amber-500/10 p-4 min-h-[180px] space-y-2">
              {selected ? (
                <>
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
                  {/* Render any buttons declared on the template — Meta
                      shows these as the bottom of the bubble. */}
                  {selected.whatsappDetail?.components
                    ?.find((c) => c.type === "BUTTONS")
                    ?.buttons?.map((btn, i) => (
                      <div
                        key={`${btn.type}-${i}`}
                        className="rounded-2xl bg-white dark:bg-slate-800 px-3 py-2 text-center text-[12px] font-medium text-emerald-600 dark:text-emerald-400 shadow-sm"
                        title={
                          btn.type === "URL"
                            ? btn.url
                            : btn.type === "PHONE_NUMBER"
                              ? btn.phoneNumber
                              : btn.type
                        }
                      >
                        {btn.text || btn.type}
                      </div>
                    ))}
                </>
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
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting || sendingNow}
            >
              Cancelar
            </Button>
            {onSendNow && (
              <Button
                variant="outline"
                onClick={handleSendNow}
                disabled={!canSendNow}
                className="gap-2"
              >
                {sendingNow ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Enviar ahora
              </Button>
            )}
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
