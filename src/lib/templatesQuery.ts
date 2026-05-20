// React Query helpers for the message-template list. The list is
// per-location, fetched via /api/templates, and (for WhatsApp) carries
// the rich Meta `whatsappDetail` payload so the SPA can render
// components / buttons without re-fetching at send time.
//
// Caching gives us three things:
//   1. The schedule dialog opens instantly on reopen (no spinner
//      flash while the templates list re-fetches identical data).
//   2. WABA registration can invalidate one key and force every
//      mounted consumer to refresh.
//   3. The cached payload can be reused elsewhere — e.g. to recover
//      a sent template's buttons by name+language when the only
//      thing we have on a Message is the templateName.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "./api";
import type {
  MessageButton,
  MessageTemplate,
} from "@/components/chat/types";

type TemplateChannel = "sms" | "whatsapp" | "email";

// Tuple-key so React Query can do exact-match invalidation. Channels
// are scoped separately because the backend serves different sources
// (GHL Snippets for sms/email, Meta Graph for whatsapp) — invalidating
// one shouldn't drop the others.
export const templatesQueryKey = (channel?: TemplateChannel) =>
  ["templates", channel ?? "all"] as const;

export function useTemplates(
  channel: TemplateChannel | undefined,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: templatesQueryKey(channel),
    queryFn: async () => {
      const res = await api.templates.list({ type: channel });
      return res.templates;
    },
    enabled: options?.enabled ?? true,
    // Templates change infrequently (Meta review can take hours;
    // GHL snippets are operator-edited). 5 minutes is a good balance
    // — long enough to make popover reopens free, short enough that
    // a newly-approved template appears without a hard reload.
    staleTime: 5 * 60 * 1000,
    // WABA_MISSING is a configuration state, not a transient failure
    // — retrying the same request will return the same 409. Let it
    // bubble so the dialog can pop the registration modal once.
    retry: (failureCount, err) => {
      if (err instanceof ApiError && err.code === "WABA_MISSING") return false;
      return failureCount < 2;
    },
  });
}

// Imperative invalidation — call after the WABA is (re)registered or
// a template is created elsewhere so every mounted consumer refetches.
export function useInvalidateTemplates() {
  const qc = useQueryClient();
  return (channel?: TemplateChannel) =>
    qc.invalidateQueries({ queryKey: templatesQueryKey(channel) });
}

// Pluck the action buttons declared on a Meta-approved template and
// flatten them into the MessageButton[] shape the chat bubble expects.
// Returns undefined when the template has no BUTTONS component (or
// when nothing in the cache matches the given name/language) — the
// caller treats that as "render no buttons", same as today.
export function templateButtonsFor(
  templates: MessageTemplate[] | undefined,
  name: string | undefined,
  language?: string | undefined
): MessageButton[] | undefined {
  if (!templates || !name) return undefined;
  // Prefer exact (name, language) match; fall back to first name match
  // so an SMS-mirrored template lookup still finds something when the
  // language code on the message is missing.
  const exact = templates.find(
    (t) => t.name === name && (!language || t.language === language)
  );
  const t = exact ?? templates.find((x) => x.name === name);
  if (!t?.whatsappDetail?.components) return undefined;
  const raw = t.whatsappDetail.components
    .filter((c) => c.type === "BUTTONS")
    .flatMap((c) => c.buttons ?? []);
  if (raw.length === 0) return undefined;
  return raw
    .filter((b) => b.text || b.type)
    .map((b, i) => ({
      id: `${t.id}-btn-${i}`,
      text: b.text ?? b.type ?? "",
      type: b.type,
      url: b.url,
      phoneNumber: b.phoneNumber,
    }));
}
