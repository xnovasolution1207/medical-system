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

// Precompiled body-match entry for a single template. We escape the
// template body and unescape `{{N}}` slots into a non-empty wildcard
// (`[\s\S]+?` — lazy, so multiple placeholders don't gobble each other,
// and `[\s\S]` so the substitution can cross line breaks if a contact
// name happens to have one). `literalLen` measures how much of the
// template is actual text vs placeholder — used as a specificity score
// when more than one template happens to match the same body.
export interface TemplateMatcher {
  template: MessageTemplate;
  regex: RegExp;
  literalLen: number;
}

// Build a list of body-match entries for the WhatsApp templates in
// the cache. Run once per templates list in a useMemo, then feed the
// result to matchTemplateByBody on every render — avoids re-escaping
// + re-compiling regexes per message bubble.
//
// Whitespace is intentionally treated as flexible (`\s+` in the regex
// wherever the template had any run of whitespace) because the cached
// template body — produced by joining Meta's header/body/footer
// components with `\n\n` in backend/src/meta/whatsappTemplates.ts —
// does NOT have to match the exact whitespace Meta inserts when it
// renders the same template into an outbound WhatsApp message. In
// practice GHL ships those messages with a single `\n` between the
// header and the body even though our cached template has `\n\n`.
// Without the flexibility the regex would never match.
export function compileTemplateMatchers(
  templates: MessageTemplate[] | undefined
): TemplateMatcher[] {
  if (!templates) return [];
  const out: TemplateMatcher[] = [];
  for (const t of templates) {
    if (t.type !== "whatsapp") continue;
    const body = (t.body ?? "").trim();
    if (!body) continue;
    // Split on `{{N}}` placeholders, escape each literal segment,
    // and reassemble with a non-empty wildcard between every two
    // segments. Going through the split saves us from the
    // backslash-counting nightmare of trying to undo an escape on
    // the brace tokens after the fact.
    const segments = body.split(/\{\{\s*\d+\s*\}\}/);
    const escapedSegments = segments.map((seg) =>
      seg
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        // Any run of whitespace in the template (one space, one
        // newline, the `\n\n` separator flattenBody produces, …)
        // becomes `\s+` so it matches whatever Meta actually
        // inserts at that position in the rendered message.
        .replace(/\s+/g, "\\s+")
    );
    const pattern = escapedSegments.join("([\\s\\S]+?)");
    const literalLen = body.replace(/\{\{\s*\d+\s*\}\}/g, "").length;
    // Anchor with `\s*` on both ends so leading/trailing whitespace
    // on either side never blocks a match.
    out.push({
      template: t,
      regex: new RegExp(`^\\s*${pattern}\\s*$`),
      literalLen,
    });
  }
  return out;
}

// Body-match heuristic: walk the precompiled matchers and return the
// most-specific template whose body matches `messageBody` after
// treating `{{N}}` as a wildcard. Specificity = literal text length,
// so a template with `Hi {{1}}, your account...` beats a template that
// is just `{{1}}` when both happen to match.
export function matchTemplateByBody(
  matchers: TemplateMatcher[],
  messageBody: string | undefined | null
): MessageTemplate | undefined {
  if (!messageBody) return undefined;
  const body = messageBody.trim();
  if (!body) return undefined;
  let best: TemplateMatcher | undefined;
  for (const m of matchers) {
    if (!m.regex.test(body)) continue;
    if (!best || m.literalLen > best.literalLen) best = m;
  }
  return best?.template;
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

// Same as templateButtonsFor but takes the resolved template directly.
// Use when the caller has already matched a template (e.g. via
// matchTemplateByBody) to skip the name+language re-lookup.
export function buttonsFromTemplate(
  template: MessageTemplate | undefined
): MessageButton[] | undefined {
  if (!template?.whatsappDetail?.components) return undefined;
  const raw = template.whatsappDetail.components
    .filter((c) => c.type === "BUTTONS")
    .flatMap((c) => c.buttons ?? []);
  if (raw.length === 0) return undefined;
  return raw
    .filter((b) => b.text || b.type)
    .map((b, i) => ({
      id: `${template.id}-btn-${i}`,
      text: b.text ?? b.type ?? "",
      type: b.type,
      url: b.url,
      phoneNumber: b.phoneNumber,
    }));
}
