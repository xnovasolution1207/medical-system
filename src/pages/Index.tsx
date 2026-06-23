import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import {
  DEFAULT_TAB,
  pathToNav,
  tabToPath,
  viewIdToPath,
  conversationToPath,
  isConversationView,
} from "@/lib/chattingRoutes";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { TaskList } from "@/components/chat/TaskList";
import { ChatMessageArea } from "@/components/chat/ChatMessageArea";
import { ContactSidebar } from "@/components/chat/ContactSidebar";
import { MainSidebar } from "@/components/chat/MainSidebar";
import { OpportunitiesView } from "@/components/chat/OpportunitiesView";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FilterCondition,
  Message,
  Conversation,
  Opportunity,
  SavedView,
  Task,
  User,
} from "@/components/chat/types";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { api, BootstrapPayload } from "@/lib/api";
import { formatPeruTime } from "@/lib/datetime";
import { useTemplates } from "@/lib/templatesQuery";
import { subscribe } from "@/lib/socket";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";

const INITIAL_SAVED_VIEWS: SavedView[] = [
  { id: "v1", name: "Meta", filters: [], logic: "AND" },
  { id: "v2", name: "Tik Tok", filters: [], logic: "AND" },
  { id: "v3", name: "Google", filters: [], logic: "AND" },
  { id: "v4", name: "Caliente", filters: [], logic: "AND" },
  { id: "v5", name: "Seguimiento", filters: [], logic: "AND" },
];

const FALLBACK_USER: User = { id: "agent", name: "Agente de Ventas", status: "online" };

// Brand colours for the canonical lead-status labels the team uses in
// GHL. The backend's hex→Tailwind mapping is necessarily approximate
// (it only has the hex GHL gives it), so when the GHL pipeline carries
// one of these well-known names we override the colour to the swatch
// shown in the agent-facing reference image. Names not in the map keep
// whatever colour the backend resolved.
const STAGE_COLOR_OVERRIDES: Record<string, string> = {
  // "New Lead" se deja gris neutro a propósito (no confundir con Perdidos/rojo).
  "new lead": "bg-slate-400",
  "lead nuevo": "bg-slate-400",
  kiwi: "bg-lime-500",
  tibio: "bg-amber-500",
  caliente: "bg-orange-500",
  agendo: "bg-violet-500",
  consulta: "bg-pink-500",
  "no asistio": "bg-red-500",
  "no asistió": "bg-red-500",
  seguimiento: "bg-purple-400",
  tratamiento: "bg-blue-500",
  recuperados: "bg-emerald-500",
  pacientes: "bg-teal-500",
};

// Normalise a stage label so the override lookup is forgiving of casing,
// whitespace, and the difference between accented / unaccented forms
// (GHL stores whatever the user typed; the override list is canonical).
function normaliseStageLabel(label: string): string {
  return label
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    // GHL stage names can include emojis/symbols ("🤖 New Lead", "🔥 Calientes").
    // Strip anything that isn't a letter, number or space so the override keys
    // ("new lead", "no asistio", …) still match.
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Distinct swatch palette (one Tailwind family each) used to guarantee every
// funnel stage has its own colour. GHL leaves several stages grey/duplicated,
// so we reassign those to unused colours from this list. Every family here is
// covered by stageBadgeClasses(), so the chat-list "embudo" badge renders too.
const DISTINCT_STAGE_PALETTE = [
  "bg-rose-500", "bg-orange-500", "bg-amber-500", "bg-yellow-500",
  "bg-lime-500", "bg-green-500", "bg-emerald-500", "bg-teal-500",
  "bg-cyan-500", "bg-sky-500", "bg-blue-500", "bg-indigo-500",
  "bg-violet-500", "bg-purple-500", "bg-fuchsia-500", "bg-pink-500",
];
// Greyish families we treat as "no real colour" and reassign.
const GREYISH_COLOR = /-(slate|gray|zinc|neutral|stone)-/;

function applyStageColorOverrides<T extends { label: string; color: string }>(
  list: T[]
): T[] {
  // 1) Explicit per-label overrides keep meaningful colours (e.g. Perdidos→red,
  //    New Lead→grey neutral). Track which stages were overridden so the
  //    distinctness pass below leaves them alone — even when grey on purpose.
  const withOverrides = list.map((s) => {
    const override =
      STAGE_COLOR_OVERRIDES[normaliseStageLabel(s.label)] ??
      // Also try the accented form so "no asistió" (with accent) matches
      // the canonical "no asistio" entry without losing the accented copy.
      STAGE_COLOR_OVERRIDES[s.label.trim().toLowerCase()];
    return { stage: override ? { ...s, color: override } : s, pinned: !!override };
  });

  // 2) Guarantee distinctness: any stage that's greyish (GHL left it grey) or
  //    whose colour duplicates an earlier stage gets reassigned to the next
  //    unused colour from the palette — so no two stages share a swatch.
  const used = new Set<string>();
  let palettePos = 0;
  const nextFreeColor = (): string => {
    for (let i = 0; i < DISTINCT_STAGE_PALETTE.length; i++) {
      const c = DISTINCT_STAGE_PALETTE[(palettePos + i) % DISTINCT_STAGE_PALETTE.length];
      if (!used.has(c)) {
        palettePos = (palettePos + i + 1) % DISTINCT_STAGE_PALETTE.length;
        return c;
      }
    }
    // More stages than palette entries (>16) — cycle; collisions unavoidable.
    const c = DISTINCT_STAGE_PALETTE[palettePos % DISTINCT_STAGE_PALETTE.length];
    palettePos += 1;
    return c;
  };

  return withOverrides.map(({ stage: s, pinned }) => {
    // Pinned (explicitly overridden) stages keep their colour as-is — including
    // an intentional neutral grey like "New Lead".
    if (pinned) {
      used.add(s.color);
      return s;
    }
    const greyish = !s.color || GREYISH_COLOR.test(s.color);
    if (!greyish && !used.has(s.color)) {
      used.add(s.color);
      return s;
    }
    const color = nextFreeColor();
    used.add(color);
    return { ...s, color };
  });
}

// Single React Query key holding the full app payload. WS events mutate the
// cache via setQueryData; the query itself never refetches on its own (the
// backend is webhook-driven, so the WS stream is the only update channel).
const BOOTSTRAP_QUERY_KEY = ["bootstrap"] as const;

// Separate cache slot for the GHL-wide unread-conversation count behind
// the "No leídos" badge. Module-scope so the WS subscription closure
// captures a stable reference for queryClient.invalidateQueries.
const UNREAD_COUNT_QUERY_KEY = ["conversations", "unread-count"] as const;

// Conversation rows we synthesize for ContactCreate webhooks that fire
// before any GHL conversation exists yet. They use this id prefix so we can
// recognise them and avoid hitting GHL with a non-existent conversation id.
const STUB_CONV_PREFIX = "pending-";
const isStubConvId = (id: string | null | undefined): boolean =>
  typeof id === "string" && id.startsWith(STUB_CONV_PREFIX);

// Reconcile an incoming message (from WS or HTTP) against the local list.
//
// Three sources can echo our outbound message back to us, in any order:
//   (1) The POST response — carries clientId.
//   (2) The backend's immediate WS broadcast — carries clientId.
//   (3) GHL's OutboundMessage webhook → backend → WS — does NOT carry clientId
//       (the webhook reads GHL's API which has no notion of it). The backend
//       suppresses this when it can via wasRecentlyBroadcasted, but on a slow
//       network the dedup window can lapse, so we still defend in the SPA.
//
// Match priority:
//   a. clientId equality → it's the same logical message, swap real id in.
//   b. id equality → exact duplicate, no-op (or merge if content grew).
//   c. incoming is from currentUser, doesn't carry clientId, and there's an
//      unresolved optimistic with matching text+channel → treat as resolution.
//   d. otherwise → append.
function mergeIncomingMessage(
  messages: Message[],
  incoming: Message,
  currentUserId?: string
): Message[] {
  if (incoming.clientId) {
    const idx = messages.findIndex(
      (m) => m.clientId === incoming.clientId || m.id === incoming.clientId
    );
    if (idx !== -1) {
      const next = messages.slice();
      next[idx] = {
        ...incoming,
        clientId: messages[idx].clientId ?? incoming.clientId,
        replyTo: messages[idx].replyTo ?? incoming.replyTo,
        // GHL's echo strips template structure (buttons/header), so
        // keep what the optimistic seeded from the picked template.
        buttons: messages[idx].buttons ?? incoming.buttons,
        // Keep the optimistic's media (e.g. a template's baked-in header
        // image / video / document) when GHL's echo arrives without it.
        attachment: messages[idx].attachment ?? incoming.attachment,
      };
      return next;
    }
  }

  {
    const idx = messages.findIndex((m) => m.id === incoming.id);
    if (idx !== -1) {
      const existing = messages[idx];
      const attachmentGrew = Boolean(incoming.attachment) && !existing.attachment;
      const textGrew = (incoming.text?.length ?? 0) > (existing.text?.length ?? 0);
      if (!attachmentGrew && !textGrew) return messages;
      const next = messages.slice();
      next[idx] = {
        ...existing,
        ...incoming,
        clientId: existing.clientId ?? incoming.clientId,
        replyTo: existing.replyTo ?? incoming.replyTo,
        buttons: existing.buttons ?? incoming.buttons,
      };
      return next;
    }
  }

  if (currentUserId && incoming.senderId === currentUserId) {
    const idx = messages.findIndex(
      (m) =>
        m.senderId === currentUserId &&
        m.id === m.clientId &&
        m.id.startsWith("tmp-") &&
        m.text === incoming.text &&
        m.channel === incoming.channel
    );
    if (idx !== -1) {
      const next = messages.slice();
      next[idx] = {
        ...incoming,
        clientId: messages[idx].clientId,
        replyTo: messages[idx].replyTo ?? incoming.replyTo,
        buttons: messages[idx].buttons ?? incoming.buttons,
        // Keep the optimistic's media (e.g. a template's baked-in header
        // image / video / document) when GHL's echo arrives without it.
        attachment: messages[idx].attachment ?? incoming.attachment,
      };
      return next;
    }
  }

  // Special-case: WhatsApp template sends route through a GHL
  // Workflow webhook (fire-and-forget — no real Meta id at HTTP
  // response time). The backend returns a synthetic `wf-pending-…`
  // id, so the optimistic message ends up with that id after the
  // HTTP 201 merge. When GHL's outbound webhook later delivers the
  // real message, it arrives with a fresh Meta id and a body where
  // {{1}}/{{2}} have already been substituted by GHL — so clientId,
  // id, AND text all differ from the optimistic. None of the three
  // matches above can dedupe.
  //
  // The remaining signals that link the two: same sender, same
  // channel, and the optimistic's id starts with `wf-pending-`
  // (only ever assigned to template sends). Match by those: replace
  // the OLDEST such pending in the list with the incoming real
  // message. Conservative — only the wf-pending- prefix qualifies,
  // so normal text sends (which dedupe by clientId successfully)
  // aren't affected.
  if (
    currentUserId &&
    incoming.senderId === currentUserId &&
    incoming.channel === "whatsapp"
  ) {
    const idx = messages.findIndex(
      (m) =>
        m.senderId === currentUserId &&
        m.channel === "whatsapp" &&
        m.id.startsWith("wf-pending-")
    );
    if (idx !== -1) {
      const next = messages.slice();
      next[idx] = {
        ...incoming,
        clientId: messages[idx].clientId ?? incoming.clientId,
        replyTo: messages[idx].replyTo ?? incoming.replyTo,
        buttons: messages[idx].buttons ?? incoming.buttons,
        // Keep the optimistic's media (e.g. a template's baked-in header
        // image / video / document) when GHL's echo arrives without it.
        attachment: messages[idx].attachment ?? incoming.attachment,
      };
      return next;
    }
  }

  return [...messages, incoming];
}

// Move a conversation to index 0 (most-recent-first ordering). Returns the
// same array reference when the conversation isn't found or is already at
// the front so React skips the render.
function moveConversationToFront(
  conversations: Conversation[],
  id: string,
  patch?: Partial<Conversation>
): Conversation[] {
  const idx = conversations.findIndex((c) => c.id === id);
  if (idx === -1) return conversations;
  const updated = patch ? { ...conversations[idx], ...patch } : conversations[idx];
  if (idx === 0 && !patch) return conversations;
  const next = conversations.slice();
  next.splice(idx, 1);
  next.unshift(updated);
  return next;
}

// Apply a patch to a conversation WITHOUT reordering the list — used for the
// agent's own outbound sends so replying doesn't jump the lead to the top.
// (Inbound messages still use moveConversationToFront.)
function patchConversationInPlace(
  conversations: Conversation[],
  id: string,
  patch: Partial<Conversation>
): Conversation[] {
  const idx = conversations.findIndex((c) => c.id === id);
  if (idx === -1) return conversations;
  const next = conversations.slice();
  next[idx] = { ...next[idx], ...patch };
  return next;
}

// Patch a server-fetched result list (unread / assigned / followed / search)
// IN PLACE when a `message.created` WS event arrives — so those tabs stay live
// without a full re-fetch (which replaced the array and reset the scroll,
// yanking the agent off the conversation they were managing). Returns the same
// reference when the conversation isn't in the list, so React skips re-render.
function patchResultsWithMessage(
  list: Conversation[] | null,
  conversationId: string,
  message: Message,
  currentUserId: string
): Conversation[] | null {
  if (!list) return list;
  const idx = list.findIndex((c) => c.id === conversationId);
  if (idx === -1) return list;
  const c = list[idx];
  const nextMessages = mergeIncomingMessage(c.messages, message, currentUserId);
  if (nextMessages === c.messages) return list;
  const isInbound = message.senderId !== currentUserId;
  // Agent's own send (message.created is outbound only) — update in place so a
  // reply doesn't jump the lead to the top of the list.
  return patchConversationInPlace(list, c.id, {
    messages: nextMessages,
    lastMessage: message.text || c.lastMessage,
    timestamp: message.timestamp || c.timestamp,
    unreadCount: isInbound ? (c.unreadCount ?? 0) + 1 : c.unreadCount,
  });
}

// Count genuinely-new inbound messages in `incoming` that aren't already
// present in `existing` (matched by id / clientId). Drives a local floor on
// the unread badge: GHL's own `unreadCount` is eventually consistent and
// frequently still reports the pre-message value at the instant the
// InboundMessage webhook fires, so trusting it verbatim leaves the badge
// stuck (it never bumps when a new lead message lands). Mirrors the backend's
// inbound classification (`senderId !== "agent" / "system"`), plus internal
// notes are excluded — they aren't unread inbound traffic.
function countNewInboundMessages(
  existing: Message[],
  incoming: Message[]
): number {
  let count = 0;
  for (const m of incoming) {
    // A badge-worthy message = one the lead typed directly. Exclude outbound
    // ("agent"), system events, internal notes, AND the GHL Conversation AI
    // bot's auto-replies (aiBot) — those aren't the human lead reaching out.
    const isInbound =
      m.senderId !== "agent" &&
      m.senderId !== "system" &&
      m.channel !== "internal" &&
      !m.aiBot;
    if (!isInbound) continue;
    const already = existing.some(
      (e) =>
        e.id === m.id ||
        (m.clientId != null && (e.clientId === m.clientId || e.id === m.clientId))
    );
    if (!already) count++;
  }
  return count;
}

// True ONLY when `inc` brings a new message FROM THE LEAD (inbound) that is
// newer than anything we've seen. This is the only thing that moves a
// conversation to the top of the list. Everything else leaves the row where it
// is: agent sends are patched in place (never reorder); a stage/funnel move,
// assignment change, tag edit or other metadata update carries no inbound
// message (only system events or an already-seen one), so it does NOT jump.
//
// Two guards, both required:
//  • DIRECTION — the message must be inbound (not "agent"/"system"/AI-bot/note).
//    This is what makes an agent send (even one echoed through `lead.updated`)
//    or a metadata update never move the row.
//  • TIMESTAMP — the inbound message must be newer than the conversation's
//    last-message time. This stops a stage change made from the Opportunities
//    modal — where the conversation's messages aren't loaded, so `lead.updated`
//    back-fills the last (older) inbound message — from looking like new
//    activity. A genuinely new inbound is always newer; a back-filled one isn't.
function hasNewInboundMessage(existing: Conversation, inc: Conversation): boolean {
  const prevTs = existing.lastMessageAt ? Date.parse(existing.lastMessageAt) : 0;
  for (const m of inc.messages) {
    const isInbound =
      m.senderId !== "agent" &&
      m.senderId !== "system" &&
      m.channel !== "internal" &&
      !m.aiBot;
    if (!isInbound) continue;
    const ts = m.date ? Date.parse(m.date) : NaN;
    if (Number.isFinite(ts) && ts > prevTs) return true;
  }
  return false;
}

// Reconcile the unread badge for a `lead.updated` merge. GHL's `incomingCount`
// is eventually consistent and routinely still reports the pre-message value
// when the InboundMessage webhook fires, so it can't be trusted to drive live
// increments. Rules:
//   • New inbound message(s) → bump by the count we can actually see locally
//     (floored over GHL in case it already counted higher). This is what makes
//     the badge grow when a lead replies — even on the conversation the agent
//     currently has open (it clears only via "Marcar como leído").
//   • Otherwise (metadata-only event with no new inbound — tags/owner/name) →
//     keep the existing count. We must NOT copy GHL's value here, or a lagging
//     metadata echo would drag a freshly-bumped badge back down. Genuine
//     "read" decreases come from the markRead path, which sets it to 0.
function reconcileUnread(
  existingCount: number,
  incomingCount: number,
  newInbound: number
): number {
  if (newInbound <= 0) return existingCount;
  return Math.max(incomingCount, existingCount + newInbound);
}

// Upsert the full conversation from a `lead.updated` WS event into a result
// list. Present → merge messages + participant, move to front only on new chat
// activity (metadata-only edits leave the row put). Absent → prepend only when
// `addWhenAbsent` (e.g. a newly-unread lead belongs on the No-leídos tab).
function upsertConvInList(
  list: Conversation[] | null,
  inc: Conversation,
  contactPatch: Partial<User>,
  currentUserId: string,
  addWhenAbsent: boolean
): Conversation[] | null {
  if (!list) return list;
  const idx = list.findIndex((c) => c.id === inc.id);
  if (idx === -1) {
    if (!addWhenAbsent) return list;
    return [{ ...inc, participant: { ...inc.participant, ...contactPatch } }, ...list];
  }
  const existing = list[idx];
  const mergedMessages = inc.messages.reduce(
    (acc, m) => mergeIncomingMessage(acc, m, currentUserId),
    existing.messages
  );
  const hasNewActivity = hasNewInboundMessage(existing, inc);
  const newInbound = countNewInboundMessages(existing.messages, inc.messages);
  const merged: Conversation = {
    ...existing,
    ...inc,
    // Floor the badge with prior + new inbound — GHL's unreadCount lags the
    // webhook, so a verbatim copy never bumps when a lead message arrives.
    unreadCount: reconcileUnread(
      existing.unreadCount ?? 0,
      inc.unreadCount ?? 0,
      newInbound
    ),
    participant: { ...inc.participant, ...contactPatch },
    messages: mergedMessages,
    scheduledMessages: existing.scheduledMessages ?? inc.scheduledMessages,
  };
  return hasNewActivity
    ? moveConversationToFront(list, inc.id, merged)
    : list.map((c) => (c.id === inc.id ? merged : c));
}

export default function Index() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // The single source of truth for app state — fetched once via /bootstrap and
  // then mutated only via WS events and optimistic local updates. Refetching
  // is disabled because we'd lose the live patches.
  const { data, isLoading, error } = useQuery<BootstrapPayload>({
    queryKey: BOOTSTRAP_QUERY_KEY,
    queryFn: () => api.bootstrap(),
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  // Prefetch the WhatsApp templates list at the app-shell level — fires
  // in parallel with the bootstrap request so by the time the user
  // clicks into a conversation, the cache already holds every template
  // body + buttons. Without this, ChatMessageArea's body-match
  // heuristic has to wait for a cold templates fetch before it can
  // attach buttons to the rendered bubbles (1-2 s of "text first,
  // buttons later" flicker). Result is discarded here — consumers
  // call useTemplates again and read from the same React Query cache.
  useTemplates("whatsapp");

  // Strongly-typed setter helper. No-ops when the cache is empty (still loading).
  const updateBootstrap = useCallback(
    (mutator: (prev: BootstrapPayload) => BootstrapPayload) => {
      queryClient.setQueryData<BootstrapPayload>(BOOTSTRAP_QUERY_KEY, (prev) =>
        prev ? mutator(prev) : prev
      );
    },
    [queryClient]
  );

  const conversations = data?.conversations ?? [];
  const tasks = data?.tasks ?? [];
  const opportunities = data?.opportunities ?? [];
  // Apply the brand-colour overrides at the source so every consumer
  // (lead-list dot, status dropdown in the chat header, kanban columns)
  // sees the same colour for a given stage name without having to
  // re-derive it locally.
  const pipelines = useMemo(
    () =>
      (data?.pipelines ?? []).map((p) => ({
        ...p,
        stages: applyStageColorOverrides(p.stages),
      })),
    [data?.pipelines]
  );
  const stages = useMemo(
    () => applyStageColorOverrides(data?.stages ?? []),
    [data?.stages]
  );
  const users = data?.users ?? [];
  const availableTags = data?.tags ?? [];
  const currentUser = data?.currentUser ?? FALLBACK_USER;
  // Resolve the logged-in agent's real GHL user id by matching their
  // display name against the agent roster. `currentUser.id` is the
  // sentinel "agent" string (used for message-dedup) so it can't be
  // compared directly against `participant.assignedTo`. Falls back to
  // undefined when the roster hasn't loaded yet or the agent isn't
  // in it — "Asignados a mí" / "Seguidos por mí" then show empty
  // lists rather than the whole inbox.
  const myUserId = useMemo(() => {
    if (!currentUser?.name) return undefined;
    const lower = currentUser.name.toLowerCase();
    return users.find((u) => u.name.toLowerCase() === lower)?.id;
  }, [currentUser?.name, users]);
  const conversationsNextCursor = data?.conversationsNextCursor ?? null;

  // Local UI state — not part of the bootstrap payload because it's purely
  // client-side: which conversation/tab is open, search input, etc.
  const [savedViews, setSavedViews] = useState<SavedView[]>(INITIAL_SAVED_VIEWS);
  // Enriched opportunity metadata (channel / last-message direction+time /
  // followers) keyed by opportunity id. Fetched lazily when the kanban tab
  // opens so its conversation-level filters cover every card — not just the
  // ones whose conversation is in the loaded window. Overlaid onto the live
  // `opportunities` (which keep their WS updates) via `opportunitiesForKanban`.
  const [oppEnrichById, setOppEnrichById] = useState<Map<string, Partial<Opportunity>>>(
    () => new Map()
  );
  // Load the persisted, per-location saved views (the backend seeds defaults
  // on first read). Falls back to INITIAL_SAVED_VIEWS while loading / on error.
  useEffect(() => {
    let cancelled = false;
    api.views
      .list()
      .then((views) => {
        if (!cancelled && Array.isArray(views) && views.length > 0) {
          setSavedViews(views);
        }
      })
      .catch((err) => console.error("load saved views failed", err));
    return () => {
      cancelled = true;
    };
  }, []);
  // Auto-remove scheduled-message indicators once their time has elapsed.
  // Templates scheduled via the GHL workflow Wait step have no in-process
  // timer to clear the banner, and the real sent message arrives via the
  // webhook — so we just drop the banner (locally) when scheduledFor passes.
  // A small grace avoids yanking it a beat before a backend-dispatched send.
  useEffect(() => {
    const interval = window.setInterval(() => {
      const cutoff = Date.now() - 15_000;
      updateBootstrap((prev) => {
        let changed = false;
        const conversations = prev.conversations.map((c) => {
          if (!c.scheduledMessages?.length) return c;
          const remaining = c.scheduledMessages.filter((m) => {
            const t = new Date(m.scheduledFor).getTime();
            return isNaN(t) || t > cutoff;
          });
          if (remaining.length === c.scheduledMessages.length) return c;
          changed = true;
          return { ...c, scheduledMessages: remaining };
        });
        return changed ? { ...prev, conversations } : prev;
      });
    }, 20_000);
    return () => window.clearInterval(interval);
  }, [updateBootstrap]);
  const [activeId, setActiveId] = useState<string | null>(null);
  // activeMainTab / activeViewId are derived from the /chatting/* URL.
  // Sidebar clicks call the setter shims below, which navigate to the
  // canonical path; the URL is the source of truth so refresh/share
  // links round-trip.
  const location = useLocation();
  const navigate = useNavigate();
  const {
    tab: activeMainTab,
    viewId: activeViewId,
    conversationId: urlConversationId,
  } = useMemo(() => pathToNav(location.pathname), [location.pathname]);

  // When the kanban (oportunidades) opens, fetch the enriched opportunity
  // listing once so its conversation-level filters (canal / dirección /
  // tipo / ANS / seguidor) have data for every card. We keep only the
  // enriched fields, keyed by id, and overlay them onto the live
  // `opportunities` below — so WS stage moves still apply while filters work.
  const oppsPrefetchedRef = useRef(false);
  // True while the full opportunity set is being fetched for the kanban — drives
  // the skeleton placeholder on the Oportunidades page.
  const [isLoadingOpportunities, setIsLoadingOpportunities] = useState(true);
  useEffect(() => {
    // Prefetch the full opportunity set in the BACKGROUND as soon as the
    // bootstrap has loaded — so the kanban is ready instantly when opened,
    // without the (heavy) all-opportunities walk blocking the initial load.
    // Runs once; live updates afterward arrive via the opportunity.updated WS.
    if (!data) return;
    if (oppsPrefetchedRef.current) return;
    oppsPrefetchedRef.current = true;
    let cancelled = false;
    api.opportunities
      .list({ enrich: true })
      .then((opps) => {
        if (cancelled) return;
        const map = new Map<string, Partial<Opportunity>>();
        for (const o of opps) {
          // Only the conversation-derived fields — assignedTo/tags already
          // live on the base opportunity, and overlaying a possibly-undefined
          // value here would clobber them.
          map.set(o.id, {
            channel: o.channel,
            lastMessageDirection: o.lastMessageDirection,
            lastMessageAt: o.lastMessageAt,
            followers: o.followers,
          });
        }
        setOppEnrichById(map);
        // The bootstrap now loads only one page of opportunities (to keep it
        // fast); the kanban needs the WHOLE set. Merge the lazily-fetched full
        // list into state — add any opportunities the bootstrap didn't have,
        // and keep existing rows (which may carry live WS stage moves).
        updateBootstrap((prev) => {
          const byId = new Map(prev.opportunities.map((o) => [o.id, o]));
          let added = 0;
          for (const o of opps) {
            if (!byId.has(o.id)) {
              byId.set(o.id, o);
              added++;
            }
          }
          return added > 0
            ? { ...prev, opportunities: Array.from(byId.values()) }
            : prev;
        });
      })
      .catch((err) => {
        console.warn("[opportunities] enrich fetch failed", err);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingOpportunities(false);
      });
    return () => {
      cancelled = true;
    };
    // Depend on whether the bootstrap has loaded (false→true ONCE), NOT on
    // `data` itself — `data` changes on every WS update / cache mutation, which
    // would re-run this effect and its cleanup would cancel the in-flight
    // opportunities fetch (discarding the result → empty kanban).
  }, [Boolean(data)]);

  // The bootstrap only carries tasks for the first handful of contacts (it caps
  // the fan-out to stay fast). That's far too few for the Tareas view and its
  // date filters. When the user first opens a tasks tab, pull the full task
  // list (GET /api/tasks aggregates every recent contact's tasks, with the raw
  // `dueAt` the date filters compare against) and merge it into the cache —
  // server rows win (they carry dueAt + the resolved assignee), local-only
  // optimistic rows are preserved.
  const inTasksSectionRef = useRef(false);
  useEffect(() => {
    const inTasks = activeMainTab.startsWith("tareas-");
    // Refetch only when ENTERING the tasks section (not on every date-filter
    // click within it), so fresh tasks load each visit without spamming the
    // heavy aggregate endpoint as the user flips between date filters.
    if (inTasks && !inTasksSectionRef.current) {
      api.tasks
        .list()
        .then((serverTasks) => {
          updateBootstrap((prev) => {
            const byId = new Map(prev.tasks.map((t) => [t.id, t]));
            for (const t of serverTasks) byId.set(t.id, t);
            return { ...prev, tasks: Array.from(byId.values()) };
          });
        })
        .catch((err) => {
          console.warn("[tasks] full list fetch failed", err);
        });
    }
    inTasksSectionRef.current = inTasks;
  }, [activeMainTab, updateBootstrap]);

  // Live opportunities with enriched metadata overlaid — passed to the kanban
  // so filters see channel/direction/followers while WS updates still flow
  // through `opportunities`.
  const opportunitiesForKanban = useMemo(
    () =>
      opportunities.map((o) => {
        const e = oppEnrichById.get(o.id);
        return e ? { ...o, ...e } : o;
      }),
    [opportunities, oppEnrichById]
  );
  // setActiveMainTab("") is fired by MainSidebar as a paired call right
  // before onSelectView(viewId) — we let the view-id setter own the
  // navigation in that case, so the empty value is a no-op.
  const setActiveMainTab = useCallback(
    (id: string) => {
      if (id === "") return;
      navigate(tabToPath(id));
    },
    [navigate]
  );
  // MainSidebar pairs onSelectTab(id) with onSelectView(null) on every
  // non-view click — so a null here must NOT clobber the sibling tab
  // navigation. Only navigate to the default when we're actually
  // leaving an active saved view (or the view was just deleted).
  const setActiveViewId = useCallback(
    (id: string | null) => {
      if (id) {
        navigate(viewIdToPath(id));
        return;
      }
      if (activeViewId !== null) {
        navigate(tabToPath(DEFAULT_TAB));
      }
    },
    [navigate, activeViewId]
  );
  const [taskUserFilters, setTaskUserFilters] = useState<string[]>([]);

  // Unread-conversation count for the "No leídos" sidebar badge —
  // scoped to the currently-active sidebar tab. On "Todos" /
  // "Recordatorios" / "Oportunidades" we ask for the whole GHL
  // location; on "Asignados a mí" we narrow by assignedTo; on
  // "Seguidos por mí" we narrow by followers. The query key includes
  // the scope so each variant caches separately; WS-driven
  // invalidation walks the prefix and refetches whatever's active.
  // myUserId can be undefined while the agent roster loads — falls
  // back to the global count in that case.
  //
  // Placed AFTER `activeMainTab` is declared (the hook reads it) so
  // we don't hit a temporal-dead-zone error on initial render.
  type UnreadScope =
    | { kind: "global" }
    | { kind: "assignedTo"; userId: string }
    | { kind: "followers"; userId: string };
  const unreadScope: UnreadScope = useMemo(() => {
    if (activeMainTab === "asignados" && myUserId)
      return { kind: "assignedTo", userId: myUserId };
    if (activeMainTab === "seguidos" && myUserId)
      return { kind: "followers", userId: myUserId };
    return { kind: "global" };
  }, [activeMainTab, myUserId]);
  const { data: unreadCountData } = useQuery<{ total: number }>({
    queryKey: [
      ...UNREAD_COUNT_QUERY_KEY,
      unreadScope.kind,
      unreadScope.kind === "global" ? null : unreadScope.userId,
    ],
    queryFn: () => {
      if (unreadScope.kind === "assignedTo")
        return api.conversations.unreadCount({ assignedTo: unreadScope.userId });
      if (unreadScope.kind === "followers")
        return api.conversations.unreadCount({ followers: unreadScope.userId });
      return api.conversations.unreadCount();
    },
    // Inexpensive (limit=1 against GHL for the global / assignedTo
    // variants; capped per-contact fan-out for followers). Cached so
    // React Query dedupes parallel mounts. WS-driven invalidation
    // refreshes whatever scope is currently active.
    staleTime: 60_000,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  // "No leídos" badge count — derived locally from the loaded conversations
  // (scoped to the active tab) instead of GHL's aggregate unread endpoint.
  // GHL's unread tracking is unreliable for this location's WhatsApp provider:
  // the aggregate count disagrees with the status=unread list and doesn't drop
  // when a lead is marked read. Keeping it local makes the badge always match
  // the No-leídos list and respond to mark-read. (`unreadCountData` above is
  // left in place but no longer drives the badge.)
  const totalUnread = useMemo(() => {
    let base = conversations.filter(
      (c) => !c.isArchived && (c.unreadCount ?? 0) > 0
    );
    if (unreadScope.kind === "assignedTo")
      base = base.filter((c) => c.participant?.assignedTo === unreadScope.userId);
    else if (unreadScope.kind === "followers")
      base = base.filter((c) =>
        (c.participant?.followers ?? []).includes(unreadScope.userId)
      );
    return base.length;
  }, [conversations, unreadScope]);
  // Count of conversations assigned to the logged-in agent across the
  // whole tenant — not just the locally-loaded window. Drives the
  // badge next to "Asignados a mí" in MainSidebar. Re-runs on
  // `lead.updated` via the same invalidation path as the unread count;
  // `handleUpdateAssignment` also mutates this cache optimistically so
  // self-assigning a lead bumps the badge immediately.
  const assignedCountQueryKey = useMemo(
    () => ["conversations", "assigned-count", myUserId ?? null] as const,
    [myUserId]
  );
  const { data: assignedCountData } = useQuery<{ count: number }>({
    queryKey: assignedCountQueryKey,
    queryFn: async () => {
      if (!myUserId) return { count: 0 };
      // Use GHL's reported total (not the length of a single page) so the badge
      // shows EVERY lead assigned to me, uncapped.
      return api.conversations.assignedCount(myUserId);
    },
    enabled: !!myUserId,
    staleTime: 60_000,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const assignedToMeCount = assignedCountData?.count ?? 0;
  // Default the contact sidebar open only on screens wide enough to host
  // every column comfortably. Below 2xl (1536px) the four-region shell would
  // squeeze the message area and cause the chat header buttons to spill into
  // the contact panel — so we keep it collapsed and let the user toggle it
  // on demand. SSR-safe: window may be undefined.
  const [isContactSidebarOpen, setIsContactSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(min-width: 1536px)").matches;
  });
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isContactSheetOpen, setIsContactSheetOpen] = useState(false);
  // Lead-list drawer for screens below `md`. Mirrors the second column
  // (ChatSidebar / TaskList) so the agent can pick a different conversation
  // without exiting the active chat. Auto-closes once a row is tapped.
  const [isChatListSheetOpen, setIsChatListSheetOpen] = useState(false);
  // Opportunity → chat modal: stores the contactId of the opportunity the
  // user clicked in the kanban. We resolve to the matching conversation at
  // render time so the modal stays in sync with WS-driven cache updates.
  const [opportunityChatContactId, setOpportunityChatContactId] = useState<
    string | null
  >(null);
  // Fallback contact for the opportunity-chat modal when the picked
  // contact doesn't have a conversation in the local cache yet — e.g.
  // a brand-new contact created via "Agregar contacto" without any
  // chat history, or a contact whose conversation isn't in the loaded
  // 25-conversation window. We lazy-fetch via api.contacts.get and
  // synthesise a pending-* stub conversation so the modal still
  // renders the chat shell + contact sidebar.
  const [opportunityChatFallback, setOpportunityChatFallback] = useState<
    User | null
  >(null);
  const [isLoadingOpportunityChat, setIsLoadingOpportunityChat] =
    useState(false);

  // ALWAYS re-fetch fresh chat history from GHL whenever the kanban
  // opportunity-chat modal opens. The previous behaviour (use cached
  // conversation if available) leaked state from the inbox view:
  // opening the chat sidebar first hydrated the conversation's full
  // message list, then clicking the same lead in Opportunities
  // displayed that hydrated cache — which felt like the modal was
  // reading from somewhere other than GHL. Now every modal open hits
  // GHL via getLead and the response *replaces* the cached
  // conversation entirely. The chat-window's own lazy-hydration is
  // also reset (hydratedConversations Set) so a subsequent visit
  // there re-fetches too, keeping both surfaces consistent.
  useEffect(() => {
    if (!opportunityChatContactId) {
      setOpportunityChatFallback(null);
      setIsLoadingOpportunityChat(false);
      return;
    }
    let cancelled = false;
    setIsLoadingOpportunityChat(true);
    api.contacts
      .getLead(opportunityChatContactId)
      .then((bundle) => {
        if (cancelled) return;
        if (bundle.conversation) {
          updateBootstrap((prev) => {
            const idx = prev.conversations.findIndex(
              (c) => c.id === bundle.conversation!.id
            );
            // The conversation mapper only carries id/name/avatar/tags on the
            // participant — it drops email/phone/address/documentNumber and
            // assignedTo/followers/dnd. Layer the full contact bundle back on
            // so the modal's right rail (Información de Contacto) isn't blank —
            // AND so replacing the cached conversation here doesn't wipe the
            // contact details the inbox already enriched.
            const enrichedConv: Conversation = {
              ...bundle.conversation!,
              participant: {
                ...bundle.conversation!.participant,
                ...bundle.contact,
              },
            };
            if (idx === -1) {
              // Insert in chronological position (the list is ordered by
              // last-message time, newest first) instead of prepending —
              // otherwise opening an opportunity preview jumps that lead to the
              // TOP of the Lead list, which the user doesn't want.
              const incomingTs = enrichedConv.lastMessageAt
                ? Date.parse(enrichedConv.lastMessageAt)
                : 0;
              const list = prev.conversations.slice();
              let insertAt = list.findIndex((c) => {
                const ts = c.lastMessageAt ? Date.parse(c.lastMessageAt) : 0;
                return ts < incomingTs;
              });
              if (insertAt === -1) insertAt = list.length;
              list.splice(insertAt, 0, enrichedConv);
              return { ...prev, conversations: list };
            }
            const next = prev.conversations.slice();
            // Replace the conversation outright so the modal sees the
            // fresh GHL data, not whatever stale messages were in the
            // bootstrap window or the chat-window cache. Preserve a
            // couple of local-only bits (per-conv stage override,
            // scheduled messages) that the bundle endpoint doesn't
            // carry because they're flagsStore-derived.
            next[idx] = {
              ...enrichedConv,
              stage: prev.conversations[idx].stage ?? bundle.conversation!.stage,
              scheduledMessages:
                prev.conversations[idx].scheduledMessages ??
                bundle.conversation!.scheduledMessages,
              // Keep the locally-tracked unread badge. GHL's per-conversation
              // unreadCount — and the backend's inbound-floor over the modal's
              // wider message window — is unreliable here, so OPENING the
              // dialog must not overwrite it, or a phantom unread appears on
              // the lead list. Unread changes only via a new inbound message
              // (lead.updated) or "Marcar como leído".
              unreadCount: prev.conversations[idx].unreadCount,
            };
            return { ...prev, conversations: next };
          });
          // Drop the hydration mark for this conversation so the
          // inbox-side lazy hydration kicks in fresh too — keeps the
          // two surfaces showing the same data.
          hydratedConversations.current.delete(bundle.conversation.id);
          setOpportunityChatFallback(null);
        } else {
          // No conversation in GHL yet — keep the contact so the
          // modal can show the right rail + an empty chat area.
          setOpportunityChatFallback(bundle.contact);
        }
        // Merge the contact's tasks from the bundle into global state. The
        // bootstrap only loads tasks for the most-recent contacts, so a task
        // created in this opportunity preview otherwise "vanishes" on refresh
        // (it's saved in GHL but never re-loaded). This re-hydrates them on
        // every modal open. Dedupe by id; optimistic/local rows are preserved.
        if (Array.isArray(bundle.tasks) && bundle.tasks.length > 0) {
          updateBootstrap((prev) => {
            const byId = new Map(prev.tasks.map((t) => [t.id, t]));
            for (const t of bundle.tasks) byId.set(t.id, t);
            return { ...prev, tasks: Array.from(byId.values()) };
          });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("[opp-chat] lead fetch failed", err);
        setOpportunityChatFallback(null);
        toast({
          title: "No se pudo cargar el contacto",
          description: (err as Error)?.message || "Inténtalo de nuevo.",
          variant: "destructive",
        });
      })
      .finally(() => {
        if (!cancelled) setIsLoadingOpportunityChat(false);
      });
    return () => {
      cancelled = true;
    };
  }, [opportunityChatContactId, toast, updateBootstrap]);
  // Advanced filter state (lifted from ChatSidebar so the search/fetch
  // pipeline below can forward translatable conditions to GHL — searches
  // run against the entire location instead of only the loaded window).
  const [advancedFilters, setAdvancedFilters] = useState<FilterCondition[]>([]);
  const [advancedLogic, setAdvancedLogic] = useState<"AND" | "OR">("AND");

  // Whenever the user picks a saved view in MainSidebar, hydrate the
  // active filters from it. Clearing the view (activeViewId === null)
  // intentionally leaves the filters in place so the user can keep editing.
  useEffect(() => {
    if (!activeViewId) return;
    const view = savedViews.find((v) => v.id === activeViewId);
    if (view) {
      setAdvancedFilters(view.filters);
      setAdvancedLogic(view.logic);
    }
  }, [activeViewId, savedViews]);

  const handleToggleContactSidebar = useCallback(() => {
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches) {
      setIsContactSidebarOpen((prev) => !prev);
    } else {
      setIsContactSheetOpen(true);
    }
  }, []);

  const handleSelectMainTab = useCallback(
    (id: string) => {
      setActiveMainTab(id);
      setIsMobileNavOpen(false);
    },
    [setActiveMainTab]
  );

  const handleSelectViewMobile = useCallback(
    (id: string | null) => {
      setActiveViewId(id);
      setIsMobileNavOpen(false);
    },
    [setActiveViewId]
  );

  // Selecting a conversation navigates to its own URL
  // (/chatting/<tab>/<conversationId>) so every conversation is deep-linkable
  // and survives a refresh / share. The URL→activeId effect below mirrors it
  // back into state; we also set it eagerly so the UI responds instantly.
  const handleSelectConversation = useCallback(
    (id: string) => {
      setActiveId(id);
      navigate(conversationToPath(activeMainTab, activeViewId, id));
    },
    [navigate, activeMainTab, activeViewId]
  );

  // Wraps `handleSelectConversation` so that picking a row in the mobile
  // lead-list drawer also dismisses the drawer — otherwise the user has to tap
  // outside the sheet after every selection.
  const handleSelectConversationMobile = useCallback(
    (id: string) => {
      handleSelectConversation(id);
      setIsChatListSheetOpen(false);
    },
    [handleSelectConversation]
  );

  const [isLoadingMoreConversations, setIsLoadingMoreConversations] = useState(false);
  const [loadingOlderFor, setLoadingOlderFor] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Conversation[] | null>(null);
  // Active "Filtrar por fecha" window (epoch ms), reported up from ChatSidebar.
  // When set, the server-search path below adds startDate/endDate so the date
  // filter spans the WHOLE GHL location with cursor-based infinite scroll.
  const [dateFilterRange, setDateFilterRange] = useState<{ from: number; to: number } | null>(null);
  const dateFilterActive = dateFilterRange !== null;
  // When the user clicks the "No leídos" tab in ChatSidebar we fetch the
  // GHL-wide unread set (status=unread) and store it here. This lets the
  // sidebar surface every unread lead — not just the ones that happen to
  // sit in the locally-loaded paginated window. Cleared when the user
  // switches back to "Todos" / "Recientes".
  const [unreadResults, setUnreadResults] = useState<Conversation[] | null>(null);
  const [unreadFilterActive, setUnreadFilterActive] = useState(false);
  // Cursor for the next unread page — same shape as `conversationsNextCursor`
  // (lastMessageDate epoch ms). null = no further pages, undefined = not
  // yet fetched.
  const [unreadNextCursor, setUnreadNextCursor] = useState<number | null>(null);
  // GHL-wide results for the "Asignados a mí" / "Seguidos por mí"
  // sidebar tabs. The bootstrap only carries the 25 most-recent
  // conversations across the whole inbox, so client-side filtering
  // would miss leads assigned to / followed by the agent that sit
  // outside that window. These pull straight from GHL's search via
  // the existing assignedTo / followers query params.
  const [assignedResults, setAssignedResults] = useState<Conversation[] | null>(null);
  const [assignedNextCursor, setAssignedNextCursor] = useState<number | null>(null);
  const [followedResults, setFollowedResults] = useState<Conversation[] | null>(null);
  const [followedNextCursor, setFollowedNextCursor] = useState<number | null>(null);
  const [searchNextCursor, setSearchNextCursor] = useState<number | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const hydratedConversations = useRef<Set<string>>(new Set());
  // Deep-linked conversations that aren't in the loaded list window (e.g. you
  // reloaded on a lead past the first page, or clicked a task whose lead is far
  // down the list). They're held in a SEPARATE map — NOT injected into
  // `conversations` — so the inbox list stays exactly as the bootstrap/paginated
  // set (no row added, no reorder) and scrolling still reveals the real row at
  // its natural position. The chat area falls back to this map for the active
  // conversation until pagination loads the real row. A MAP (not a single slot)
  // so switching between several routed conversations keeps each one — otherwise
  // re-opening an earlier one would find an empty chat (its fetch is guarded as
  // already-done, but the slot was overwritten).
  const [routedConversations, setRoutedConversations] = useState<
    Record<string, Conversation>
  >({});
  // Conversation whose full history is currently being fetched on select —
  // drives the loading spinner in the message area.
  const [hydratingId, setHydratingId] = useState<string | null>(null);
  const currentUserIdRef = useRef<string>(FALLBACK_USER.id);
  const isLoadingMoreConversationsRef = useRef(false);
  const loadingOlderForRef = useRef<string | null>(null);
  // Mirrors `activeId` so the WS lead.updated handler can transfer focus
  // from a stub row to the real conversation row without depending on
  // `activeId` (which would force the WS subscription to re-establish on
  // every selection change).
  const activeIdRef = useRef<string | null>(null);

  useEffect(() => {
    currentUserIdRef.current = currentUser.id;
  }, [currentUser.id]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  // Keep `activeId` in sync with the conversation id in the URL — handles deep
  // links, refresh, and browser back/forward (each conversation has its own
  // route now). A null URL conversation clears the selection.
  useEffect(() => {
    setActiveId(urlConversationId ?? null);
  }, [urlConversationId]);

  // Auto-open the first conversation once the bootstrap arrives, but only on a
  // conversation-list view and only when the URL doesn't already point at one —
  // navigate (replace) so it gets its own deep-linkable URL too.
  useEffect(() => {
    if (
      data &&
      !urlConversationId &&
      isConversationView(activeMainTab, activeViewId) &&
      data.conversations.length > 0
    ) {
      navigate(
        conversationToPath(activeMainTab, activeViewId, data.conversations[0].id),
        { replace: true }
      );
    }
  }, [data, urlConversationId, activeMainTab, activeViewId, navigate]);

  // ---- WebSocket subscription ----
  // The WS listener is the only place that mutates the cache for live updates.
  // It runs once for the lifetime of the page and writes into React Query via
  // setQueryData, exactly as the new architecture specifies.
  useEffect(() => {
    const sub = subscribe((event) => {
      // Inspect every incoming WS event before it's merged into the React
      // Query cache. Helpful for debugging the live pipeline.
      console.log("[ws] incoming", event.type, event);
      if (event.type === "message.created") {
        // Mirror the message into the routed map when it's a deep-linked
        // conversation not in the list (so its chat updates live too).
        setRoutedConversations((prev) => {
          const rc = prev[event.conversationId];
          if (!rc) return prev;
          const merged = mergeIncomingMessage(
            rc.messages,
            event.message,
            currentUserIdRef.current
          );
          if (merged === rc.messages) return prev;
          return {
            ...prev,
            [event.conversationId]: {
              ...rc,
              messages: merged,
              lastMessage: event.message.text || rc.lastMessage,
              timestamp: event.message.timestamp || rc.timestamp,
            },
          };
        });
        updateBootstrap((prev) => {
          const idx = prev.conversations.findIndex((c) => c.id === event.conversationId);
          if (idx === -1) return prev; // wait for the conversation.updated companion event
          const c = prev.conversations[idx];
          const nextMessages = mergeIncomingMessage(
            c.messages,
            event.message,
            currentUserIdRef.current
          );
          if (nextMessages === c.messages) return prev;
          // Increment the lead's unread badge only for inbound messages (the
          // outbound echoes from our own POST shouldn't count). The agent-send
          // path resets to 0 separately.
          const isInbound = event.message.senderId !== currentUserIdRef.current;
          const nextUnreadCount = isInbound ? (c.unreadCount ?? 0) + 1 : c.unreadCount;
          return {
            ...prev,
            // Our own outbound send (message.created is broadcast only for the
            // SPA's sends) — update in place so replying doesn't move the lead
            // to the top of the list.
            conversations: patchConversationInPlace(prev.conversations, c.id, {
              messages: nextMessages,
              lastMessage: event.message.text || c.lastMessage,
              timestamp: event.message.timestamp || c.timestamp,
              unreadCount: nextUnreadCount,
            }),
          };
        });
        // Keep the server-fetched tab lists (No leídos / Asignados / Seguidos /
        // search) live IN PLACE — no full re-fetch, so the scroll position is
        // preserved and the agent isn't yanked off the conversation they're on.
        {
          const cid = event.conversationId;
          const m = event.message;
          const uid = currentUserIdRef.current;
          setUnreadResults((p) => patchResultsWithMessage(p, cid, m, uid));
          setAssignedResults((p) => patchResultsWithMessage(p, cid, m, uid));
          setFollowedResults((p) => patchResultsWithMessage(p, cid, m, uid));
          setSearchResults((p) => patchResultsWithMessage(p, cid, m, uid));
        }
      } else if (event.type === "conversation.updated") {
        updateBootstrap((prev) => {
          const idx = prev.conversations.findIndex((c) => c.id === event.conversation.id);
          if (idx === -1) {
            return { ...prev, conversations: [event.conversation, ...prev.conversations] };
          }
          // Preserve already-hydrated message list when WS only refreshes header data.
          const existing = prev.conversations[idx];
          const merged: Conversation = {
            ...event.conversation,
            messages: existing.messages.length ? existing.messages : event.conversation.messages,
            scheduledMessages: existing.scheduledMessages ?? event.conversation.scheduledMessages,
          };
          return {
            ...prev,
            conversations: moveConversationToFront(prev.conversations, merged.id, merged),
          };
        });
      } else if (event.type === "conversation.read") {
        // Another agent marked this conversation read (or answered it). Read is
        // shared across the whole team, so clear the unread badge in EVERY
        // session — this is what stops colleagues from seeing a high unread
        // count after someone else already handled the lead.
        const cid = event.conversationId;
        const clearUnread = (c: Conversation) =>
          c.id === cid && (c.unreadCount ?? 0) > 0 ? { ...c, unreadCount: 0 } : c;
        updateBootstrap((prev) => ({
          ...prev,
          conversations: prev.conversations.map(clearUnread),
        }));
        // "No leídos" tab: drop the row entirely (it's no longer unread).
        setUnreadResults((prev) => (prev ? prev.filter((c) => c.id !== cid) : prev));
        setAssignedResults((prev) => (prev ? prev.map(clearUnread) : prev));
        setFollowedResults((prev) => (prev ? prev.map(clearUnread) : prev));
        setSearchResults((prev) => (prev ? prev.map(clearUnread) : prev));
        // Keep the GHL-wide aggregate badge in sync.
        queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_QUERY_KEY });
      } else if (event.type === "contact.updated") {
        // GHL contact create / update / tag webhook → patch the participant
        // on every conversation whose contact id matches. New contacts with
        // no conversation yet are a silent no-op; the conversation row will
        // appear via InboundMessage when they actually message in.
        updateBootstrap((prev) => ({
          ...prev,
          conversations: prev.conversations.map((c) =>
            c.contactId === event.contactId || c.participant.id === event.contactId
              ? { ...c, participant: { ...c.participant, ...event.patch } }
              : c
          ),
        }));
      } else if (event.type === "opportunity.updated") {
        updateBootstrap((prev) => {
          const idx = prev.opportunities.findIndex((o) => o.id === event.opportunity.id);
          if (idx === -1) {
            return { ...prev, opportunities: [event.opportunity, ...prev.opportunities] };
          }
          const next = prev.opportunities.slice();
          const existing = next[idx];
          const incoming = event.opportunity;
          // A stage-move echo is mapped from GHL's minimal PUT response,
          // which lacks `attributions` — so `source` collapses to the
          // "Directo" default and `date` may be blank. Keep the richer
          // existing values so the card's channel label / date don't
          // flicker every time it's dragged.
          next[idx] = {
            ...incoming,
            source:
              incoming.source && incoming.source !== "Directo"
                ? incoming.source
                : existing.source || incoming.source,
            date: incoming.date || existing.date,
          };
          return { ...prev, opportunities: next };
        });
      } else if (event.type === "task.created") {
        updateBootstrap((prev) => {
          // Drop the optimistic row this broadcast reconciles, matched by the
          // clientId the backend echoed back (title/date are not unique). This
          // prevents both the duplicate (optimistic + real) and the disappear
          // (an unrelated same-titled row being removed).
          const cid = event.task.clientId;
          let tasks = cid
            ? prev.tasks.filter((t) => !(t.id.startsWith("t-tmp-") && t.clientId === cid))
            : prev.tasks;
          // Upsert by real id so we never end up with two rows for one task.
          tasks = tasks.some((t) => t.id === event.task.id)
            ? tasks.map((t) => (t.id === event.task.id ? event.task : t))
            : [event.task, ...tasks];
          return { ...prev, tasks };
        });
      } else if (event.type === "task.updated") {
        updateBootstrap((prev) => ({
          ...prev,
          tasks: prev.tasks.map((t) => (t.id === event.task.id ? event.task : t)),
        }));
      } else if (event.type === "lead.updated") {
        // Inbound or read-state-changing events bump the GHL-wide unread
        // count. Drop the cached value so the badge refetches against
        // GHL on the next render — cheap (limit=1) and keeps the badge
        // accurate without us having to mirror GHL's unread bookkeeping.
        queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_QUERY_KEY });
        queryClient.invalidateQueries({ queryKey: ["conversations", "assigned-count"] });
        // Stub id used for contact-only ContactCreate events that arrive
        // before any conversation exists in GHL. We use a deterministic
        // prefix so the row can be replaced when the real conversation
        // (from the first inbound message) shows up.
        const stubId = `pending-${event.contactId}`;
        const realConv = event.lead.conversation;
        // If the user is currently viewing the stub and the real conversation
        // just arrived, transfer focus so the chat area stops showing an
        // empty state. We do this outside updateBootstrap so the activeId
        // change happens once per event, not once per cache write.
        if (realConv && activeIdRef.current === stubId) {
          setActiveId(realConv.id);
        }
        updateBootstrap((prev) => {
          // 1. Patch the participant on every conversation for this contact.
          let conversations = prev.conversations.map((c) =>
            c.contactId === event.contactId || c.participant.id === event.contactId
              ? { ...c, participant: { ...c.participant, ...event.lead.contact } }
              : c
          );

          // 2. Upsert the conversation, most-recent-first.
          const inc = realConv;
          if (inc) {
            // Real conversation arrived — drop any stub we may have
            // synthesized earlier so the lead doesn't appear twice.
            conversations = conversations.filter((c) => c.id !== stubId);
            const idx = conversations.findIndex((c) => c.id === inc.id);
            if (idx === -1) {
              // New conversation — prepend so it appears at the top.
              conversations = [inc, ...conversations];
            } else {
              const existing = conversations[idx];
              // Merge each incoming message via mergeIncomingMessage so
              // the dedup heuristics (clientId, id, tmp- prefix,
              // wf-pending- prefix for workflow-routed WhatsApp template
              // sends) fire. The previous "filter by id, append the
              // rest" approach missed cases where an optimistic message
              // already in the cache has a different id than the
              // server-canonical version arriving via `lead.updated` —
              // most notably workflow template sends, where the
              // optimistic ends up with a synthetic `wf-pending-…` id
              // while GHL's webhook brings the real Meta message id.
              const mergedMessages = inc.messages.reduce(
                (acc, m) =>
                  mergeIncomingMessage(acc, m, currentUserIdRef.current),
                existing.messages
              );
              const hasNewActivity = hasNewInboundMessage(existing, inc);
              const newInbound = countNewInboundMessages(
                existing.messages,
                inc.messages
              );
              const merged: Conversation = {
                ...inc,
                // GHL's unreadCount is eventually consistent — it frequently
                // still reports the pre-message value when the InboundMessage
                // webhook fires, so trusting it verbatim means the badge never
                // bumps. Floor it with prior + new inbound (skip when this
                // conversation is the one the agent is actively viewing).
                unreadCount: reconcileUnread(
                  existing.unreadCount ?? 0,
                  inc.unreadCount ?? 0,
                  newInbound
                ),
                // The conversation mapper only carries id/name/avatar/tags on
                // the participant — it intentionally drops assignedTo,
                // followers, email, phone, dnd. Layer the full contact
                // bundle on top so picking an owner doesn't appear to revert
                // when the lead.updated webhook echoes back.
                participant: { ...inc.participant, ...event.lead.contact },
                messages: mergedMessages,
                scheduledMessages:
                  existing.scheduledMessages ?? inc.scheduledMessages,
              };
              // Only re-sort the list when there's actual new chat activity.
              // Contact-metadata-only events (owner change, tags, name edit
              // — they all bounce through `lead.updated` because GHL fires
              // ContactUpdate) should leave the row in place; otherwise picking
              // an owner would jump the lead to the top, which the user
              // explicitly does not want.
              if (hasNewActivity) {
                conversations = moveConversationToFront(conversations, inc.id, merged);
              } else {
                conversations = conversations.map((c) =>
                  c.id === inc.id ? merged : c
                );
              }
            }
          } else {
            // ContactCreate (or any contact-only webhook) arrived ahead of
            // the conversation. Synthesize a placeholder so the lead is
            // visible in the sidebar immediately. Skip if a row for this
            // contact already exists (real conversation, or earlier stub).
            const alreadyListed = conversations.some(
              (c) =>
                c.id === stubId ||
                c.contactId === event.contactId ||
                c.participant.id === event.contactId
            );
            if (!alreadyListed) {
              const stub: Conversation = {
                id: stubId,
                contactId: event.contactId,
                participant: event.lead.contact,
                // Default to whatsapp — overwritten when the real conversation
                // lands. Most leads in this CRM arrive over WhatsApp.
                source: "whatsapp",
                recipientNumber: "",
                lastMessage: "",
                unreadCount: 0,
                timestamp: "",
                messages: [],
              };
              conversations = [stub, ...conversations];
            }
          }

          // 3. Upsert tasks by real GHL id (add new, update existing, never
          //    remove). We do NOT touch optimistic (`t-tmp-…`) rows here — they
          //    are owned by the create flow and reconciled precisely via their
          //    clientId in the POST .then / `task.created` handler. (Previously
          //    this block removed optimistic rows by matching title, which both
          //    wiped freshly-created same-titled tasks and, when too strict,
          //    left duplicates. Reconciliation-by-clientId makes that
          //    heuristic unnecessary.)
          const taskMap = new Map(prev.tasks.map((t) => [t.id, t]));
          for (const t of event.lead.tasks) taskMap.set(t.id, t);

          return { ...prev, conversations, tasks: Array.from(taskMap.values()) };
        });
        // Keep the server-fetched tab lists live IN PLACE (no full re-fetch →
        // no scroll reset, so the agent isn't yanked off the conversation
        // they're managing). Present rows merge + move-to-front on new chat
        // activity; a newly-unread lead is also prepended to the No-leídos list.
        // (Assigned/Followed only patch existing rows here — a brand-new
        // assigned/followed lead surfaces on the next tab open, which avoids a
        // stale-closure read of `myUserId` in this long-lived subscription.)
        if (realConv) {
          const inc = realConv;
          const contact = event.lead.contact;
          const uid = currentUserIdRef.current;
          setUnreadResults((p) =>
            upsertConvInList(p, inc, contact, uid, (inc.unreadCount ?? 0) > 0)
          );
          setAssignedResults((p) => upsertConvInList(p, inc, contact, uid, false));
          setFollowedResults((p) => upsertConvInList(p, inc, contact, uid, false));
          setSearchResults((p) => upsertConvInList(p, inc, contact, uid, false));
        }
      }
    });
    return () => sub.close();
  }, [updateBootstrap]);

  // ---- Lazy-hydrate full message list when a conversation is selected ----
  useEffect(() => {
    if (!activeId) return;
    // Wait until the bootstrap cache exists. On a refresh of a deep-linked
    // conversation URL, `activeId` is set from the URL before the bootstrap
    // query resolves — if we hydrated now, our inserted conversation would be
    // discarded when the bootstrap result replaces the cache, and the
    // `hydratedConversations` guard would then block a retry (empty chat). Wait
    // for `data`, then this re-runs (Boolean(data) dep) and the insert sticks.
    if (!data) return;
    // Stub rows (id="pending-<contactId>") are placeholders we synthesize for
    // ContactCreate webhooks that arrive before any conversation exists in
    // GHL. They have no real GHL conversation to fetch — skip until the row
    // is replaced by the real conversation via the next lead.updated event.
    if (isStubConvId(activeId)) return;
    if (hydratedConversations.current.has(activeId)) return;
    hydratedConversations.current.add(activeId);
    setHydratingId(activeId);
    api.conversations
      .get(activeId)
      .then((full) => {
        // Not in the loaded list window (deep-linked beyond the first page):
        // keep it ONLY in the separate routed slot — never inject it into the
        // list — so the inbox stays put and pagination can still surface the
        // real row at its natural position. The chat reads it from this slot.
        const currentCache = queryClient.getQueryData<BootstrapPayload>(
          BOOTSTRAP_QUERY_KEY
        );
        if (!currentCache?.conversations.some((c) => c.id === full.id)) {
          setRoutedConversations((prev) => ({ ...prev, [full.id]: full }));
          return;
        }
        updateBootstrap((prev) => {
          const idx = prev.conversations.findIndex((c) => c.id === full.id);
          if (idx === -1) {
            // Raced out of the window between the check and here — fall back to
            // the routed map rather than injecting a row.
            setRoutedConversations((rc) => ({ ...rc, [full.id]: full }));
            return prev;
          }
          const next = prev.conversations.slice();
          const existing = next[idx];
          // The detail endpoint can't always tell us the channel (GHL omits
          // lastMessageType for some conversations) and the per-conv stage
          // override is local, so keep the bootstrap-derived source/stage.
          next[idx] = {
            ...existing,
            ...full,
            source: existing.source,
            stage: existing.stage ?? full.stage,
            // Preserve the locally-tracked unread badge. GHL's per-conversation
            // unreadCount is unreliable for this location, so letting the detail
            // fetch overwrite it would wipe the badge the moment the agent opens
            // the chat. Unread clears only via "Marcar como leído".
            unreadCount: existing.unreadCount ?? full.unreadCount,
          };
          return { ...prev, conversations: next };
        });
        // The conversation detail endpoint builds the participant from the
        // conversation record, which lacks the contact's address1 and
        // custom fields. Fetch the full contact so "Dirección" and "Num de
        // documento" populate the right rail (and survive a refresh).
        const contactId = full.participant?.id;
        if (contactId) {
          api.contacts
            .get(contactId)
            .then((c) => {
              updateBootstrap((prev) => ({
                ...prev,
                conversations: prev.conversations.map((conv) =>
                  conv.id === activeId
                    ? {
                        ...conv,
                        participant: {
                          ...conv.participant,
                          email: c.email ?? conv.participant.email,
                          phone: c.phone ?? conv.participant.phone,
                          address: c.address,
                          documentNumber: c.documentNumber,
                        },
                      }
                    : conv
                ),
              }));
            })
            .catch((err) => {
              console.warn("[contact] detail enrich failed", err);
            });
        }
      })
      .catch((err) => {
        console.error("conversation fetch failed", err);
        // Let a failed hydration retry on the next visit.
        hydratedConversations.current.delete(activeId);
      })
      .finally(() => {
        setHydratingId((cur) => (cur === activeId ? null : cur));
      });
    // `Boolean(data)` so this re-runs once the bootstrap cache is ready (see the
    // !data guard above) without re-firing on every cache mutation.
  }, [activeId, updateBootstrap, queryClient, Boolean(data)]);

  // Translate the SPA's FilterCondition[] into the native GHL conversation-
  // search params our /api/conversations endpoint forwards. Only equality
  // ("es") with a non-empty value is server-translatable; negation /
  // contains / other-field conditions stay client-side and run inside
  // ChatSidebar's filteredConversations.
  //
  // For OR logic, GHL's `mode=OR` only kicks in when *every* active
  // condition has a server translation — otherwise excluding even one
  // untranslatable OR branch would silently drop matching rows. When the
  // mix is impossible to express on the server we fall back to an empty
  // params object and let the client filter handle everything (capped at
  // the locally cached window — that's the trade-off until the SPA gets a
  // dedicated server-side OR pipeline).
  const ghlChannelType = (ch: string): string | undefined => {
    switch (ch) {
      case "whatsapp": return "TYPE_WHATSAPP";
      case "sms": return "TYPE_SMS";
      case "email": return "TYPE_EMAIL";
      case "instagram": return "TYPE_INSTAGRAM";
      case "messenger": return "TYPE_FB_MESSENGER";
      case "tiktok": return "TYPE_TIKTOK";
      default: return undefined;
    }
  };
  const buildServerFilterParams = useCallback(
    (
      filters: FilterCondition[],
      logic: "AND" | "OR"
    ): {
      params: Parameters<typeof api.conversations.list>[0];
      hasServerParam: boolean;
    } => {
      const params: Parameters<typeof api.conversations.list>[0] = {};
      let translated = 0;
      let nonTranslatable = 0;
      for (const cond of filters) {
        // Skip half-built conditions (no field or no value yet) — the user
        // is mid-edit, not yet trying to filter. Counting them as
        // "untranslatable" would block the OR-mode forwarding below and
        // (worse) flip the UI into "filtered=empty" while the user is
        // still picking a value.
        if (!cond.field || !cond.value) continue;
        // Negation / contains can't be expressed in GHL's query string.
        // Mark non-translatable so they fall through to client-side
        // filtering on the fetched window.
        if (cond.operator !== "es") {
          nonTranslatable++;
          continue;
        }
        let mapped = true;
        switch (cond.field) {
          case "asignado":
            params.assignedTo = cond.value;
            break;
          case "seguidor":
            // Followers are local-only on the backend — the route handler
            // intercepts this param, scans the in-memory followersStore for
            // every contact this user is following, and fans out per-contact
            // GHL fetches. From the SPA's POV it's still a server fetch that
            // covers more than the locally cached window.
            params.followers = cond.value;
            break;
          case "mencion":
            params.mentions = cond.value;
            break;
          case "etiqueta":
            params.tags = cond.value;
            break;
          case "embudo_actual":
            // Funnel/stage isn't a native conversation-search field, but the
            // backend resolves it: it finds the stage's contacts via the
            // opportunity search and returns their conversations — so the
            // funnel filter covers the whole location, not just the loaded
            // window.
            params.stage = cond.value;
            break;
          case "canal_ultimo_mensaje": {
            const t = ghlChannelType(cond.value);
            if (t) params.lastMessageType = t;
            else mapped = false;
            break;
          }
          case "tipo_ultimo_mensaje_saliente": {
            // "Channel of last *outbound* message" = lastMessageType +
            // lastMessageDirection=outbound. Both are forwarded so GHL
            // narrows precisely. If a separate `direccion_ultimo_mensaje`
            // filter is also set, the second pass overwrites — that
            // contradiction yields 0 results, which is the correct semantic.
            const t = ghlChannelType(cond.value);
            if (t) {
              params.lastMessageType = t;
              params.lastMessageDirection = "outbound";
            } else {
              mapped = false;
            }
            break;
          }
          case "direccion_ultimo_mensaje":
            if (cond.value === "inbound" || cond.value === "outbound") {
              params.lastMessageDirection = cond.value;
            } else {
              mapped = false;
            }
            break;
          default:
            mapped = false;
        }
        if (mapped) translated++;
        else nonTranslatable++;
      }
      if (translated === 0) return { params: {}, hasServerParam: false };
      // OR with mixed translatable+untranslatable conditions can't be
      // safely forwarded — bail to client-side only.
      if (logic === "OR" && nonTranslatable > 0) {
        return { params: {}, hasServerParam: false };
      }
      if (logic === "OR") params.mode = "OR";
      return { params, hasServerParam: true };
    },
    []
  );

  // Memoised server-filter params so render and the search effect agree on
  // whether a fetch is happening. The effect re-derives independently to
  // stay self-contained, but this gives `isSearchActive` the same answer.
  const advancedFilterServerInfo = useMemo(
    () => buildServerFilterParams(advancedFilters, advancedLogic),
    [advancedFilters, advancedLogic, buildServerFilterParams]
  );

  // Active-tab booleans for the assignedTo / followers sidebar tabs.
  // Derived locally so the fetch effects below only re-run on real
  // tab toggles, not on every render.
  const assignedFilterActive = activeMainTab === "asignados";
  const followedFilterActive = activeMainTab === "seguidos";

  // ---- Server-side search + filter (debounced) ----
  // Triggers when either the text-search box changes OR the advanced filter
  // builder produces a server-translatable condition. The same fetch is
  // reused so the result list always reflects the union of both inputs.
  // The active sidebar tab (Asignados a mí / Seguidos por mí / No leídos)
  // is folded in as additional scope so a search on "Asignados a mí"
  // returns "matches query AND assigned to me" instead of all matches.
  // User-supplied advanced filter params win on conflicting keys.
  useEffect(() => {
    const q = searchQuery.trim();
    const { params: filterParams, hasServerParam } = buildServerFilterParams(
      advancedFilters,
      advancedLogic
    );
    if (!q && !hasServerParam && !dateFilterActive) {
      setSearchResults(null);
      setSearchNextCursor(null);
      setIsSearching(false);
      return;
    }
    let cancelled = false;
    setIsSearching(true);
    const handle = window.setTimeout(() => {
      api.conversations
        .list({
          // 25 per page — matches the rest of the app's pagination. The cursor
          // (nextCursor) drives infinite scroll, so the full match set still
          // loads as the user scrolls, just 25 at a time.
          limit: 25,
          ...(q ? { query: q } : {}),
          ...(assignedFilterActive && myUserId
            ? { assignedTo: myUserId }
            : {}),
          ...(followedFilterActive && myUserId
            ? { followers: myUserId }
            : {}),
          ...(unreadFilterActive ? { status: "unread" } : {}),
          ...(dateFilterRange
            ? { startDate: dateFilterRange.from, endDate: dateFilterRange.to }
            : {}),
          ...filterParams,
        })
        .then((result) => {
          if (cancelled) return;
          setSearchResults(result.conversations);
          setSearchNextCursor(result.nextCursor);
        })
        .catch((err) => {
          if (cancelled) return;
          console.error("search failed", err);
          setSearchResults([]);
          setSearchNextCursor(null);
        })
        .finally(() => {
          if (!cancelled) setIsSearching(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [
    searchQuery,
    advancedFilters,
    advancedLogic,
    buildServerFilterParams,
    assignedFilterActive,
    followedFilterActive,
    unreadFilterActive,
    dateFilterRange,
    myUserId,
  ]);

  // Active iff the search effect is actually fetching: a text query, or at
  // least one *valued* filter condition that translates to a GHL param.
  // Half-built filter rows (no value yet, or only client-side fields like
  // embudo / ans) leave the local cache visible — the alternative was a
  // blank list while the user was still picking a value, which the previous
  // implementation suffered from.
  const isSearchActive =
    searchQuery.trim().length > 0 ||
    advancedFilterServerInfo.hasServerParam ||
    dateFilterActive;

  // The "No leídos" list is derived locally (see `unreadConversations`) — we
  // no longer fetch GHL's status=unread search, which is unreliable for this
  // location (it returns an empty list even when leads have unread messages,
  // and its aggregate count won't drop on mark-read). Keep the result slot
  // null so any legacy `unreadResults ?? <local>` fallbacks resolve to local.
  useEffect(() => {
    setUnreadResults(null);
    setUnreadNextCursor(null);
  }, [unreadFilterActive]);

  // Server-side fetch for "Asignados a mí". Hits GHL's native
  // assignedTo search, returning every conversation in the location
  // whose contact is assigned to the logged-in agent — not just the
  // 25 bootstrap-loaded ones. Re-runs on `lead.updated` (via
  // `totalUnread`) so a newly-assigned lead surfaces without a page
  // refresh.
  useEffect(() => {
    if (!assignedFilterActive || !myUserId) {
      setAssignedResults(assignedFilterActive ? [] : null);
      setAssignedNextCursor(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const result = await api.conversations.list({
          assignedTo: myUserId,
          limit: 25,
        });
        if (!cancelled) {
          setAssignedResults(result.conversations);
          setAssignedNextCursor(result.nextCursor);
        }
      } catch (err) {
        if (!cancelled) {
          console.warn("[asignados] fetch failed", err);
          setAssignedResults([]);
          setAssignedNextCursor(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Not keyed on `totalUnread` — see the unread effect's note: re-fetching on
    // every message reset the list scroll. Fetches on tab-open only.
  }, [assignedFilterActive, myUserId]);

  // Server-side fetch for "Seguidos por mí". Followers are local-only
  // (Prisma followersStore), but the backend route translates the
  // followers= query param into a fan-out of per-contact conversation
  // fetches, so a single SPA call still hits the whole tenant.
  useEffect(() => {
    if (!followedFilterActive || !myUserId) {
      setFollowedResults(followedFilterActive ? [] : null);
      setFollowedNextCursor(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const result = await api.conversations.list({
          followers: myUserId,
          limit: 25,
        });
        if (!cancelled) {
          setFollowedResults(result.conversations);
          setFollowedNextCursor(result.nextCursor);
        }
      } catch (err) {
        if (!cancelled) {
          console.warn("[seguidos] fetch failed", err);
          setFollowedResults([]);
          setFollowedNextCursor(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Not keyed on `totalUnread` — see the unread effect's note: re-fetching on
    // every message reset the list scroll. Fetches on tab-open only.
  }, [followedFilterActive, myUserId]);

  // When the user is typing a query (or has applied an advanced filter
  // that translates to a GHL param), the search results win over the
  // tab's base scope — the search effect already folds the active tab
  // (Asignados / Seguidos / No leídos) into the request, so the
  // returned list is the intersection of "matches query" AND "tab
  // scope". Clearing the search restores the tab's own results.
  // Archivados is purely a local toggle — `isArchived` lives on the
  // backend flagsStore which has no GHL counterpart, so we can't ask
  // GHL for "all archived". The view therefore shows whichever
  // archived rows are currently in the locally-loaded conversation
  // window (bootstrap + any pages the operator has scrolled into).
  // Search / Unread / Asignados / Seguidos filters are bypassed on
  // this tab; the operator is here specifically to find or restore
  // archived leads.
  const archivedFilterActive = activeMainTab === "archivados";
  // The filtered tabs (búsqueda / no-leídos / asignados / seguidos) fetch
  // their own conversation objects from the backend, which can arrive
  // without the funnel `stage` ("embudo") — the backend's blanket
  // opportunity page doesn't cover every contact. Re-inject the stage we
  // already know for that conversation from the bootstrap cache so the
  // stage badge stays visible across tabs.
  const stageByConvId = useMemo(() => {
    const m = new Map<string, NonNullable<Conversation["stage"]>>();
    for (const c of conversations) if (c.stage) m.set(c.id, c.stage);
    return m;
  }, [conversations]);
  const withCachedStage = useCallback(
    (list: Conversation[]) =>
      list.map((c) =>
        c.stage || !stageByConvId.has(c.id)
          ? c
          : { ...c, stage: stageByConvId.get(c.id) }
      ),
    [stageByConvId]
  );
  // No-leídos list — local + tab-scoped, matching `totalUnread`. We don't use
  // GHL's status=unread search here (it's unreliable for this location and
  // returns an empty list even when leads have unread messages); the local
  // `conversations` set is kept live by the WS `lead.updated` handler.
  const unreadConversations = unreadFilterActive
    ? conversations.filter((c) => {
        if ((c.unreadCount ?? 0) <= 0) return false;
        if (assignedFilterActive && myUserId)
          return c.participant?.assignedTo === myUserId;
        if (followedFilterActive && myUserId)
          return (c.participant?.followers ?? []).includes(myUserId);
        return true;
      })
    : [];
  const displayConversationsBase = archivedFilterActive
    ? conversations.filter((c) => c.isArchived)
    : isSearchActive
      ? withCachedStage(searchResults ?? [])
      : unreadFilterActive
        ? withCachedStage(unreadConversations)
        : assignedFilterActive
          ? withCachedStage(assignedResults ?? [])
          : followedFilterActive
            ? withCachedStage(followedResults ?? [])
            : conversations;
  // Everywhere except the Archivados tab, archived rows are hidden so
  // they don't pollute the working inbox. The flag is patched
  // optimistically by handleToggleArchive, so a row vanishes the
  // moment the operator clicks "Archivar". The deep-linked conversation is NOT
  // in this list — it lives in `routedConversation` and shows only in the chat
  // — so the inbox stays exactly as loaded and pagination reveals the real row.
  const displayConversations = archivedFilterActive
    ? displayConversationsBase
    : displayConversationsBase.filter((c) => !c.isArchived);
  // True while the active tab's scoped fetch (assignedTo / followers /
  // status=unread) is still in flight. The corresponding result state
  // is `null` before the first fetch resolves, then an array (possibly
  // empty) afterwards — so `=== null` is the precise "still loading"
  // signal. `myUserId` gating mirrors the fetch effects: when there's
  // no user, the assigned/seguidos queries don't run and the empty
  // state is the truthful answer, not a loading one.
  const isLoadingConversationList =
    (assignedFilterActive && Boolean(myUserId) && assignedResults === null) ||
    (followedFilterActive && Boolean(myUserId) && followedResults === null);
  // (No-leídos is derived locally and synchronously — never "loading".)
  // Prefer the real list row; fall back to the routed slot for a deep-linked
  // conversation that isn't in the loaded window yet (so the chat still shows
  // it without injecting a row into the list).
  const activeConversation =
    conversations.find((c) => c.id === activeId) ??
    (activeId ? routedConversations[activeId] : undefined);

  // Drop any routed conversation whose real list row now exists (pagination
  // scrolled to it, or a WS event added it) so we read the live row instead.
  useEffect(() => {
    setRoutedConversations((prev) => {
      const ids = Object.keys(prev);
      if (ids.length === 0) return prev;
      const keep = ids.filter((id) => !conversations.some((c) => c.id === id));
      if (keep.length === ids.length) return prev; // nothing to drop
      const next: Record<string, Conversation> = {};
      for (const id of keep) next[id] = prev[id];
      return next;
    });
  }, [conversations]);

  // ---- Handlers — all mutate the React Query cache via updateBootstrap ----
  const handleSendMessage = useCallback(
    (
      text: string,
      attachment?: Message["attachment"],
      channel: Message["channel"] = "sms",
      mentions?: string[],
      reminder?: string,
      replyTo?: Message["replyTo"],
      // Explicit target conversation. The inbox omits it and we fall back to
      // the active selection; the Opportunities modal passes its own conv.id
      // so the send doesn't depend on `activeId` (which it can't flip
      // synchronously before this memoized callback reads it).
      targetConversationId?: string
    ) => {
      const convId = targetConversationId ?? activeId;
      if (!convId) return;
      if (isStubConvId(convId)) {
        toast({
          title: "Conversación no disponible",
          description:
            "Este lead aún no tiene una conversación. Espera a que envíe el primer mensaje.",
          variant: "destructive",
        });
        return;
      }
      const optimisticId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const optimistic: Message = {
        id: optimisticId,
        clientId: optimisticId,
        senderId: currentUser.id,
        text,
        timestamp: formatPeruTime(new Date()),
        isRead: true,
        attachment,
        channel,
        mentions,
        reminder,
        replyTo,
        status: "sent",
      };

      // Mirror the optimistic message into the routed map when we're sending in
      // a deep-linked conversation that isn't in the list yet (so it appears
      // immediately; the WS echo reconciles it by clientId).
      setRoutedConversations((prev) => {
        const rc = prev[convId];
        if (!rc) return prev;
        return {
          ...prev,
          [convId]: {
            ...rc,
            messages: [...rc.messages, optimistic],
            ...(channel === "internal"
              ? {}
              : { lastMessage: text || rc.lastMessage, timestamp: optimistic.timestamp }),
            ...(reminder ? { activeReminder: reminder } : {}),
          },
        };
      });

      updateBootstrap((prev) => {
        const idx = prev.conversations.findIndex((c) => c.id === convId);
        if (idx === -1) return prev;
        const c = prev.conversations[idx];
        // Internal comments ("Comentarios Interno") are private notes, not
        // messages to the lead — they must NOT reorder the list or change the
        // lead's last-activity preview. Append the note in place and keep the
        // conversation exactly where it is.
        if (channel === "internal") {
          return {
            ...prev,
            conversations: patchConversationInPlace(prev.conversations, convId, {
              messages: [...c.messages, optimistic],
              ...(reminder ? { activeReminder: reminder } : {}),
            }),
          };
        }
        return {
          ...prev,
          // A message the agent TYPED directly moves the lead to the top of the
          // list (active engagement). `lastMessageAt` is advanced to now so the
          // ordering data stays consistent and a later metadata update (e.g. a
          // stage change, which doesn't advance it) won't re-bump or fight it.
          // Template sends (handleSendTemplateNow) and the WS echo stay in place,
          // so only this typed path reorders.
          conversations: moveConversationToFront(prev.conversations, convId, {
            messages: [...c.messages, optimistic],
            lastMessage: text || "Archivo adjunto",
            timestamp: optimistic.timestamp,
            lastMessageAt: new Date().toISOString(),
            lastMessageDirection: "outbound",
            // Agent/manager replied → the lead's chat is now considered seen.
            unreadCount: 0,
            ...(reminder ? { activeReminder: reminder } : {}),
          }),
        };
      });

      api.conversations
        .send(convId, { text, channel, attachment, mentions, reminder, replyTo, clientId: optimisticId })
        .then((sent) => {
          updateBootstrap((prev) => ({
            ...prev,
            conversations: prev.conversations.map((conv) =>
              conv.id === convId
                ? {
                    ...conv,
                    messages: mergeIncomingMessage(
                      conv.messages,
                      {
                        ...sent,
                        // GHL doesn't store the reply/quote context, so the
                        // echo drops it — keep the local replyTo so the
                        // bubble's quoted message survives reconciliation.
                        replyTo: replyTo ?? sent.replyTo,
                        clientId: sent.clientId ?? optimisticId,
                      },
                      currentUserIdRef.current
                    ),
                  }
                : conv
            ),
          }));
        })
        .catch((err) => {
          console.error("send failed", err);
          updateBootstrap((prev) => ({
            ...prev,
            conversations: prev.conversations.map((conv) =>
              conv.id === convId
                ? {
                    ...conv,
                    messages: conv.messages.map((m) =>
                      m.id === optimisticId ? { ...m, status: "error" as const } : m
                    ),
                  }
                : conv
            ),
          }));
          // Augment the toast when the upstream rejection is a Twilio
          // failure on an attachment. The bare wrapper ("Twilio Error -
          // ERR_BAD_REQUEST") doesn't carry the actual Twilio reason code,
          // and the agent has no way to know that Twilio's MMS layer is
          // what choked: it's typically the recipient being outside
          // US/Canada (Twilio MMS doesn't deliver internationally by
          // default), the file exceeding 5 MB, or an unsupported MIME.
          // Surfacing this in the toast is the only actionable signal we
          // can give since the upload itself succeeded.
          const errMsg = (err as Error)?.message || String(err);
          const isTwilioError = /twilio error/i.test(errMsg);
          const description =
            isTwilioError && attachment
              ? `${errMsg}\n\nTwilio rechazó el envío del adjunto por SMS. Causas comunes: el destinatario está fuera de EE.UU./Canadá (Twilio MMS no entrega internacionalmente por defecto), el archivo supera 5 MB, o el formato no es compatible con MMS. Prueba enviando el archivo por WhatsApp.`
              : errMsg;
          toast({
            title: "No se pudo enviar el mensaje",
            description,
            variant: "destructive",
          });
        });
    },
    [activeId, currentUser.id, toast, updateBootstrap]
  );

  const handleScheduleMessage = useCallback(
    (
      conversationId: string,
      text: string,
      date: string,
      channel: Message["channel"],
      template?: { id: string; name?: string; language?: string }
    ) => {
      if (isStubConvId(conversationId)) {
        toast({
          title: "Conversación no disponible",
          description:
            "Este lead aún no tiene una conversación. Espera a que envíe el primer mensaje.",
          variant: "destructive",
        });
        return;
      }
      const localChannel = (channel as "sms" | "email" | "whatsapp" | "internal") ?? "sms";
      const optimisticId = `sch-tmp-${Date.now()}`;
      updateBootstrap((prev) => ({
        ...prev,
        conversations: prev.conversations.map((c) =>
          c.id === conversationId
            ? {
                ...c,
                scheduledMessages: [
                  ...(c.scheduledMessages ?? []),
                  {
                    id: optimisticId,
                    text,
                    scheduledFor: date,
                    channel: localChannel,
                    templateId: template?.id,
                    templateName: template?.name,
                  },
                ],
              }
            : c
        ),
      }));
      api.conversations
        .schedule(conversationId, {
          text,
          scheduledFor: date,
          channel: localChannel,
          templateId: template?.id,
          templateName: template?.name,
          templateLanguage: template?.language,
        })
        .then((saved) => {
          updateBootstrap((prev) => ({
            ...prev,
            conversations: prev.conversations.map((c) =>
              c.id === conversationId
                ? {
                    ...c,
                    scheduledMessages: (c.scheduledMessages ?? []).map((m) =>
                      m.id === optimisticId ? { ...m, id: saved.id } : m
                    ),
                  }
                : c
            ),
          }));
        })
        .catch((err) => console.error("schedule failed", err));
    },
    [toast, updateBootstrap]
  );

  // "Enviar ahora" path from the WhatsApp template dialog. Mirrors the
  // composer's optimistic-insert flow but adds the template fields so
  // the backend routes through GHL's templated WhatsApp send. We don't
  // touch scheduledMessages — the message lands as a regular outbound
  // bubble in the chat, not as a pending row.
  const handleSendTemplateNow = useCallback(
    async (
      conversationId: string,
      text: string,
      channel: NonNullable<Message["channel"]>,
      template: {
        id: string;
        name?: string;
        language?: string;
        buttons?: Message["buttons"];
        attachment?: Message["attachment"];
        // Template's baked-in header media — display-only on the bubble.
        templateMedia?: Message["attachment"];
      }
    ) => {
      if (isStubConvId(conversationId)) {
        toast({
          title: "Conversación no disponible",
          description:
            "Este lead aún no tiene una conversación. Espera a que envíe el primer mensaje.",
          variant: "destructive",
        });
        return;
      }
      const optimisticId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const optimistic: Message = {
        id: optimisticId,
        clientId: optimisticId,
        senderId: currentUser.id,
        text,
        // Pin the ISO date so day-grouping places the optimistic on
        // today. Without this, the bubble has an undefined `date` and
        // the day-separator logic puts it in an "unknown" group while
        // the eventual webhook-arrived real message lands under
        // "Hoy" — producing two visually separated bubbles even when
        // dedup later resolves them.
        date: new Date().toISOString(),
        timestamp: formatPeruTime(new Date()),
        isRead: true,
        channel,
        status: "sent",
        // When a replacement image is attached, this goes out as a free-form
        // media message (not the official template), so don't tag it as a
        // template / carry template buttons.
        templateName: template.attachment ? undefined : template.name,
        // Carry the template's action buttons forward so the bubble
        // renders them under the message. GHL strips template
        // structure off the echoed message that comes back via HTTP /
        // WS, so mergeIncomingMessage preserves these once they're
        // attached here.
        buttons: template.attachment ? undefined : template.buttons,
        // Show the custom file if one was swapped in; otherwise show the
        // template's own baked-in media so the official template's image /
        // video / document appears on the sent bubble too.
        attachment: template.attachment ?? template.templateMedia,
      };
      updateBootstrap((prev) => {
        const idx = prev.conversations.findIndex((c) => c.id === conversationId);
        if (idx === -1) return prev;
        const c = prev.conversations[idx];
        return {
          ...prev,
          // Template send stays in place — don't jump the lead to the top.
          conversations: patchConversationInPlace(prev.conversations, conversationId, {
            messages: [...c.messages, optimistic],
            lastMessage: template.name ? `Plantilla: ${template.name}` : text,
            timestamp: optimistic.timestamp,
            unreadCount: 0,
          }),
        };
      });
      try {
        const sent = await api.conversations.send(conversationId, {
          text,
          channel,
          clientId: optimisticId,
          // A replacement image is sent as a normal media message (routes
          // through the Green API file path); otherwise send the official
          // template via the GHL workflow.
          ...(template.attachment
            ? { attachment: template.attachment }
            : {
                templateId: template.id,
                templateName: template.name,
                templateLanguage: template.language,
                // Persist the template's baked-in media so it survives a
                // refresh (re-attached to GHL's media-less echo).
                templateMedia: template.templateMedia,
              }),
        });
        updateBootstrap((prev) => ({
          ...prev,
          conversations: prev.conversations.map((conv) =>
            conv.id === conversationId
              ? {
                  ...conv,
                  messages: mergeIncomingMessage(
                    conv.messages,
                    { ...sent, clientId: sent.clientId ?? optimisticId },
                    currentUserIdRef.current
                  ),
                }
              : conv
          ),
        }));
      } catch (err) {
        console.error("send template failed", err);
        updateBootstrap((prev) => ({
          ...prev,
          conversations: prev.conversations.map((conv) =>
            conv.id === conversationId
              ? {
                  ...conv,
                  messages: conv.messages.map((m) =>
                    m.id === optimisticId ? { ...m, status: "error" as const } : m
                  ),
                }
              : conv
          ),
        }));
        throw err;
      }
    },
    [currentUser.id, toast, updateBootstrap]
  );

  const handleCancelScheduledMessage = useCallback(
    (conversationId: string, messageId: string) => {
      updateBootstrap((prev) => ({
        ...prev,
        conversations: prev.conversations.map((c) =>
          c.id === conversationId
            ? {
                ...c,
                scheduledMessages: (c.scheduledMessages ?? []).filter((m) => m.id !== messageId),
              }
            : c
        ),
      }));
      if (isStubConvId(conversationId)) return;
      api.conversations
        .cancelScheduled(conversationId, messageId)
        .catch((err) => console.error("cancel scheduled failed", err));
    },
    [updateBootstrap]
  );

  const handleUpdateStage = useCallback(
    (id: string, stage: Conversation["stage"]) => {
      if (!stage) return;
      const cache = queryClient.getQueryData<BootstrapPayload>(BOOTSTRAP_QUERY_KEY);
      const conv = cache?.conversations.find((c) => c.id === id);
      const contactId = conv?.contactId ?? conv?.participant.id;
      const opp = contactId
        ? cache?.opportunities.find((o) => o.contactId === contactId)
        : undefined;
      const pipeline = cache?.pipelines[0];

      updateBootstrap((prev) => ({
        ...prev,
        conversations: prev.conversations.map((c) => (c.id === id ? { ...c, stage } : c)),
        opportunities: opp
          ? prev.opportunities.map((o) => (o.id === opp.id ? { ...o, stageId: stage } : o))
          : prev.opportunities,
      }));

      // GHL flag-store endpoints are conversation-keyed; stub rows have no
      // backing GHL conversation, so skip the patch. Local state still
      // updates above so the UI is responsive; flags will start persisting
      // once the real conversation arrives.
      if (!isStubConvId(id)) {
        api.conversations
          .patch(id, { stage })
          .catch((err) => console.error("stage update failed", err));
      }

      if (opp) {
        // Existing opportunity → move it to the new stage. Pass the
        // pipelineId — GHL rejects a stage move without it.
        if (opp.stageId !== stage) {
          api.opportunities
            .move(opp.id, stage, opp.pipelineId)
            .catch((err) => {
              console.error("opportunity move failed", err);
              toast({
                title: "No se pudo actualizar el estado",
                description: String((err as Error)?.message ?? err),
                variant: "destructive",
              });
            });
        }
      } else if (contactId && pipeline) {
        // No opportunity yet → create one so the stage choice persists across
        // bootstrap reloads. Without this, stage selection only lives in the
        // backend's in-memory flagsStore.stageOverride, which resets on every
        // server restart.
        const name = conv?.participant.name?.trim() || "Lead";
        api.opportunities
          .create({ name, contactId, pipelineId: pipeline.id, stageId: stage })
          .then((created) => {
            updateBootstrap((prev) => ({
              ...prev,
              opportunities: [created, ...prev.opportunities],
            }));
          })
          .catch((err) => {
            console.error("opportunity create failed", err);
            toast({
              title: "No se pudo crear la oportunidad",
              description: String((err as Error)?.message ?? err),
              variant: "destructive",
            });
          });
      }
    },
    [queryClient, toast, updateBootstrap]
  );

  const handleClearReminder = useCallback(
    (id: string) => {
      updateBootstrap((prev) => ({
        ...prev,
        conversations: prev.conversations.map((c) =>
          c.id === id ? { ...c, activeReminder: undefined } : c
        ),
      }));
      if (isStubConvId(id)) return;
      api.conversations
        .patch(id, { activeReminder: null })
        .catch((err) => console.error("clear reminder failed", err));
    },
    [updateBootstrap]
  );

  const handleSetReminder = useCallback(
    (id: string, reminder: string) => {
      updateBootstrap((prev) => ({
        ...prev,
        conversations: prev.conversations.map((c) =>
          c.id === id ? { ...c, activeReminder: reminder } : c
        ),
      }));
      if (isStubConvId(id)) return;
      api.conversations
        .patch(id, { activeReminder: reminder })
        .catch((err) => console.error("set reminder failed", err));
    },
    [updateBootstrap]
  );

  const handleLoadMoreConversations = useCallback(async () => {
    const q = searchQuery.trim();
    const { params: filterParams } = buildServerFilterParams(
      advancedFilters,
      advancedLogic
    );
    // Mode precedence matches displayConversations:
    //   1. search/filter active → page through searchResults (search
    //      effect already folds the active tab scope in, and load-more
    //      mirrors that here so subsequent pages keep the intersection)
    //   2. unread tab          → page through status=unread results
    //   3. asignados tab       → page through assignedTo= results
    //   4. seguidos tab        → page through followers= results
    //   5. default             → page through the bootstrap list
    const cursor = isSearchActive
      ? searchNextCursor
      : unreadFilterActive
        ? unreadNextCursor
        : assignedFilterActive
          ? assignedNextCursor
          : followedFilterActive
            ? followedNextCursor
            : conversationsNextCursor;
    if (!cursor || isLoadingMoreConversationsRef.current) return;
    isLoadingMoreConversationsRef.current = true;
    setIsLoadingMoreConversations(true);
    try {
      const result = await api.conversations.list({
        limit: 25,
        startAfterDate: cursor,
        // Search query rides on every search-active page; tab-only
        // pages drop it so the cursor matches the original tab fetch.
        query: isSearchActive && q ? q : undefined,
        // Tab scope applies on every page (including search-active
        // ones) so the cascade reads "matches query AND tab scope".
        status: unreadFilterActive ? "unread" : undefined,
        assignedTo:
          assignedFilterActive ||
          (unreadFilterActive && activeMainTab === "asignados")
            ? myUserId
            : undefined,
        followers:
          followedFilterActive ||
          (unreadFilterActive && activeMainTab === "seguidos")
            ? myUserId
            : undefined,
        // Advanced filter params from the filter builder. Only forward
        // them while search/filter is active — otherwise we'd narrow
        // tab-only pagination by stale filter values.
        ...(isSearchActive ? filterParams : {}),
        // Date-range window rides on every page so infinite scroll stays
        // inside the selected range.
        ...(dateFilterRange
          ? { startDate: dateFilterRange.from, endDate: dateFilterRange.to }
          : {}),
      });
      // Anti-flap guard: cursor pagination keys off `lastMessageDate`, and
      // the tail of the list can have several conversations sharing the
      // same timestamp. GHL then hands back the *same* boundary page, so
      // `nextCursor` equals the cursor we just queried. If we kept that
      // cursor, `hasMore` would stay true, the list wouldn't grow, and the
      // scroll handler would re-fire forever (the "Cargando más…" flap).
      // When the cursor doesn't advance, treat it as the end.
      const safeNextCursor =
        result.nextCursor !== null && result.nextCursor === cursor
          ? null
          : result.nextCursor;
      if (isSearchActive) {
        setSearchResults((prev) => {
          const base = prev ?? [];
          const existingIds = new Set(base.map((c) => c.id));
          const fresh = result.conversations.filter((c) => !existingIds.has(c.id));
          return fresh.length ? [...base, ...fresh] : base;
        });
        setSearchNextCursor(safeNextCursor);
      } else if (unreadFilterActive) {
        setUnreadResults((prev) => {
          const base = prev ?? [];
          const existingIds = new Set(base.map((c) => c.id));
          const fresh = result.conversations.filter((c) => !existingIds.has(c.id));
          return fresh.length ? [...base, ...fresh] : base;
        });
        setUnreadNextCursor(safeNextCursor);
      } else if (assignedFilterActive) {
        setAssignedResults((prev) => {
          const base = prev ?? [];
          const existingIds = new Set(base.map((c) => c.id));
          const fresh = result.conversations.filter((c) => !existingIds.has(c.id));
          return fresh.length ? [...base, ...fresh] : base;
        });
        setAssignedNextCursor(safeNextCursor);
      } else if (followedFilterActive) {
        setFollowedResults((prev) => {
          const base = prev ?? [];
          const existingIds = new Set(base.map((c) => c.id));
          const fresh = result.conversations.filter((c) => !existingIds.has(c.id));
          return fresh.length ? [...base, ...fresh] : base;
        });
        setFollowedNextCursor(safeNextCursor);
      } else {
        updateBootstrap((prev) => {
          const existingIds = new Set(prev.conversations.map((c) => c.id));
          const fresh = result.conversations.filter((c) => !existingIds.has(c.id));
          return {
            ...prev,
            conversations: fresh.length ? [...prev.conversations, ...fresh] : prev.conversations,
            // Stop paginating when the page added nothing new (all
            // duplicates) — otherwise the list never grows but hasMore
            // stays true and the loader flaps. Also honours the
            // cursor-stall guard above.
            conversationsNextCursor: fresh.length ? safeNextCursor : null,
          };
        });
      }
    } catch (err) {
      console.error("load more conversations failed", err);
    } finally {
      isLoadingMoreConversationsRef.current = false;
      setIsLoadingMoreConversations(false);
    }
  }, [
    advancedFilters,
    advancedLogic,
    buildServerFilterParams,
    conversationsNextCursor,
    isSearchActive,
    searchNextCursor,
    searchQuery,
    unreadFilterActive,
    unreadNextCursor,
    assignedFilterActive,
    assignedNextCursor,
    followedFilterActive,
    followedNextCursor,
    activeMainTab,
    myUserId,
    updateBootstrap,
  ]);

  const handleLoadOlderMessages = useCallback(async () => {
    if (!activeId || loadingOlderForRef.current === activeId) return;
    const cache = queryClient.getQueryData<BootstrapPayload>(BOOTSTRAP_QUERY_KEY);
    const conv = cache?.conversations.find((c) => c.id === activeId);
    if (!conv?.messagesOldestId || !conv.messagesHasMore) return;
    loadingOlderForRef.current = activeId;
    setLoadingOlderFor(activeId);
    try {
      const result = await api.conversations.messages(activeId, {
        lastMessageId: conv.messagesOldestId,
        limit: 50,
      });
      updateBootstrap((prev) => ({
        ...prev,
        conversations: prev.conversations.map((c) => {
          if (c.id !== activeId) return c;
          const existingIds = new Set(c.messages.map((m) => m.id));
          const fresh = result.messages.filter((m) => !existingIds.has(m.id));
          return {
            ...c,
            messages: [...fresh, ...c.messages],
            messagesHasMore: result.hasMore,
            messagesOldestId: result.oldestId,
          };
        }),
      }));
    } catch (err) {
      console.error("load older messages failed", err);
    } finally {
      loadingOlderForRef.current = null;
      setLoadingOlderFor(null);
    }
  }, [activeId, queryClient, updateBootstrap]);

  const handleToggleFavorite = useCallback(
    (id: string) => {
      let nextValue = false;
      updateBootstrap((prev) => ({
        ...prev,
        conversations: prev.conversations.map((c) => {
          if (c.id !== id) return c;
          nextValue = !c.isFavorite;
          return { ...c, isFavorite: nextValue };
        }),
      }));
      if (isStubConvId(id)) return;
      api.conversations
        .patch(id, { isFavorite: nextValue })
        .catch((err) => console.error("toggle favorite failed", err));
    },
    [updateBootstrap]
  );

  // "Marcar como leído" — clear the unread badge for a conversation.
  // Optimistic; the backend stamps a read time so it persists on refresh.
  const handleMarkAsRead = useCallback(
    (id: string) => {
      updateBootstrap((prev) => ({
        ...prev,
        conversations: prev.conversations.map((c) =>
          c.id === id && c.unreadCount > 0 ? { ...c, unreadCount: 0 } : c
        ),
      }));
      // When a saved view / search is active, the visible list is
      // searchResults (not the bootstrap conversations), so clear the badge
      // there too — otherwise it stays until the view is reloaded.
      setSearchResults((prev) =>
        prev
          ? prev.map((c) =>
              c.id === id && c.unreadCount > 0 ? { ...c, unreadCount: 0 } : c
            )
          : prev
      );
      // "No leídos" tab: a read conversation no longer belongs in the unread
      // list, so drop the row entirely (not just clear its badge).
      setUnreadResults((prev) => (prev ? prev.filter((c) => c.id !== id) : prev));
      // Assigned / followed tabs aren't unread-scoped — just clear the badge.
      setAssignedResults((prev) =>
        prev
          ? prev.map((c) =>
              c.id === id && c.unreadCount > 0 ? { ...c, unreadCount: 0 } : c
            )
          : prev
      );
      setFollowedResults((prev) =>
        prev
          ? prev.map((c) =>
              c.id === id && c.unreadCount > 0 ? { ...c, unreadCount: 0 } : c
            )
          : prev
      );
      if (isStubConvId(id)) return;
      api.conversations
        .patch(id, { markRead: true })
        .then(() => {
          // The backend has now zeroed GHL's unread count for this lead, so
          // refresh the GHL-wide badge so it matches the list immediately.
          queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_QUERY_KEY });
        })
        .catch((err) => console.error("mark as read failed", err));
    },
    [updateBootstrap]
  );

  // "Marcar como no leído" — flag a conversation as unread again. The inverse
  // of handleMarkAsRead. Unread is tracked locally (GHL's per-conversation
  // unread is unreliable here — see the unread-tracking notes), so this just
  // sets the local badge to 1; the No-leídos list and header count are derived
  // from `conversations`, so the row reappears there automatically. Best-effort
  // per session — a full refresh reseeds counts from GHL.
  const handleMarkAsUnread = useCallback(
    (id: string) => {
      const bump = (c: Conversation) =>
        c.id === id && (c.unreadCount ?? 0) === 0 ? { ...c, unreadCount: 1 } : c;
      updateBootstrap((prev) => ({
        ...prev,
        conversations: prev.conversations.map(bump),
      }));
      // Mirror into the server-fetched result lists so the badge shows there
      // too. (No-leídos is derived locally, so it needs no explicit patch.)
      setSearchResults((prev) => (prev ? prev.map(bump) : prev));
      setAssignedResults((prev) => (prev ? prev.map(bump) : prev));
      setFollowedResults((prev) => (prev ? prev.map(bump) : prev));
    },
    [updateBootstrap]
  );

  // Set the AI bot Active/Paused for a conversation. Optimistically flips
  // the local state, then fires the backend (which writes the GHL tag mirror
  // and triggers the bot-status workflow). Reverts on failure.
  const handleSetBotStatus = useCallback(
    (id: string, status: "active" | "paused") => {
      let prevStatus: "active" | "paused" = "active";
      updateBootstrap((prev) => ({
        ...prev,
        conversations: prev.conversations.map((c) => {
          if (c.id !== id) return c;
          prevStatus = c.botStatus ?? "active";
          return { ...c, botStatus: status };
        }),
      }));
      if (isStubConvId(id)) return;
      api.conversations.setBotStatus(id, status).catch((err) => {
        console.error("set bot status failed", err);
        updateBootstrap((prev) => ({
          ...prev,
          conversations: prev.conversations.map((c) =>
            c.id === id ? { ...c, botStatus: prevStatus } : c
          ),
        }));
      });
    },
    [updateBootstrap]
  );

  // Archive / unarchive a conversation. Optimistically flips the local
  // flag (which Index hides from displayConversations), persists via
  // PATCH, and surfaces a toast with Undo so an accidental archive can
  // be reverted in one click. The toast is omitted on unarchive — the
  // operator chose to bring it back, no extra confirmation needed.
  const handleToggleArchive = useCallback(
    (id: string) => {
      let nextValue = false;
      let participantName = "";
      let contactId = "";
      updateBootstrap((prev) => ({
        ...prev,
        conversations: prev.conversations.map((c) => {
          if (c.id !== id) return c;
          nextValue = !c.isArchived;
          participantName = c.participant?.name ?? "";
          contactId = c.contactId ?? c.participant?.id ?? "";
          return { ...c, isArchived: nextValue };
        }),
      }));
      if (!isStubConvId(id)) {
        // Send contactId so the backend can persist the archive durably and
        // re-load it for the archive view on refresh.
        api.conversations
          .patch(id, { isArchived: nextValue, contactId })
          .catch((err) => console.error("toggle archive failed", err));
      }
      // Drop focus when the active conversation just disappeared from
      // the inbox — otherwise the message area still shows it but the
      // sidebar pretends it doesn't exist.
      if (nextValue) {
        setActiveId((current) => (current === id ? null : current));
        toast({
          title: "Conversación archivada",
          description: participantName
            ? `${participantName} fue archivada.`
            : undefined,
          action: (
            <ToastAction
              altText="Deshacer"
              onClick={() => handleToggleArchive(id)}
            >
              Deshacer
            </ToastAction>
          ),
        });
      }
    },
    [toast, updateBootstrap]
  );

  // Pin or unpin a message in the active conversation. Optimistically
  // updates the local cache so the banner pops in immediately, then
  // persists via PATCH /conversations/:id. The backend keeps a
  // capped stack per conversation (in-memory flagsStore — resets on
  // backend restart).
  //   - pinned object → add to top of the stack (or refresh existing entry)
  //   - pinned === null → clear ALL pins for this conversation
  const handlePinMessage = useCallback(
    (
      id: string,
      pinned: { id: string; text: string; date?: string; senderName?: string; channel?: string } | null
    ) => {
      updateBootstrap((prev) => ({
        ...prev,
        conversations: prev.conversations.map((c) => {
          if (c.id !== id) return c;
          if (pinned === null) return { ...c, pinnedMessages: undefined };
          const snapshot = { ...pinned, pinnedAt: Date.now() };
          const rest = (c.pinnedMessages ?? []).filter((p) => p.id !== pinned.id);
          return { ...c, pinnedMessages: [snapshot, ...rest].slice(0, 10) };
        }),
      }));
      if (isStubConvId(id)) return;
      api.conversations
        .patch(id, { pinnedMessage: pinned })
        .catch((err) => console.error("pin message failed", err));
    },
    [updateBootstrap]
  );

  // Remove a single pinned snapshot by message id (per-banner X button
  // and the "Desfijar" menu item both call this). Optimistic update
  // mirrors the backend's removePinnedMessage helper.
  const handleUnpinMessage = useCallback(
    (id: string, messageId: string) => {
      updateBootstrap((prev) => ({
        ...prev,
        conversations: prev.conversations.map((c) =>
          c.id === id
            ? {
                ...c,
                pinnedMessages: (c.pinnedMessages ?? []).filter((p) => p.id !== messageId),
              }
            : c
        ),
      }));
      if (isStubConvId(id)) return;
      api.conversations
        .patch(id, { unpinMessageId: messageId })
        .catch((err) => console.error("unpin message failed", err));
    },
    [updateBootstrap]
  );

  const handleUpdateContactName = useCallback(
    (contactId: string, newName: string) => {
      updateBootstrap((prev) => ({
        ...prev,
        conversations: prev.conversations.map((c) =>
          c.participant.id === contactId
            ? { ...c, participant: { ...c.participant, name: newName } }
            : c
        ),
      }));
      api.contacts.update(contactId, { name: newName }).catch((err) => {
        console.error("contact update failed", err);
        toast({
          title: "No se pudo actualizar el contacto",
          description: String(err),
          variant: "destructive",
        });
      });
    },
    [toast, updateBootstrap]
  );

  // "Información de Contacto" fields (Teléfono / Email / Dirección / Num de
  // documento). Optimistically patch the participant on every conversation
  // that points at this contact (header + sidebar stay in sync), patch the
  // active search-result list too (it shadows the bootstrap cache when a
  // view/search is active), then PATCH GHL. Phone/email/address are native
  // fields; documentNumber rides a GHL custom field on the backend.
  const handleUpdateContactFields = useCallback(
    (
      contactId: string,
      patch: {
        phone?: string;
        email?: string;
        address?: string;
        documentNumber?: string;
      }
    ) => {
      const applyPatch = (c: Conversation) =>
        c.participant.id === contactId
          ? { ...c, participant: { ...c.participant, ...patch } }
          : c;
      updateBootstrap((prev) => ({
        ...prev,
        conversations: prev.conversations.map(applyPatch),
      }));
      setSearchResults((prev) => (prev ? prev.map(applyPatch) : prev));
      api.contacts.update(contactId, patch).catch((err) => {
        console.error("contact fields update failed", err);
        toast({
          title: "No se pudo guardar la información",
          description: (err as Error)?.message || "Inténtalo de nuevo.",
          variant: "destructive",
        });
      });
    },
    [toast, updateBootstrap]
  );

  // Tag patch for the right-rail "Etiquetas" picker. Optimistically writes
  // the new tags array to every conversation whose participant is this
  // contact (so the header chip set + the sidebar stay in sync), then
  // PATCHes GHL with the full list. GHL auto-creates location-level tag
  // entries for any names it hasn't seen before, so typing a brand-new
  // tag here also creates it in the location library on the next bootstrap.
  // On failure the optimistic patch is left in place and a toast surfaces
  // the error — the bootstrap-cache reconcile from the response (or the
  // next WS lead.updated) will normalise the state.
  const handleUpdateContactTags = useCallback(
    (contactId: string, nextTags: string[]) => {
      // Defensive dedupe + trim so a careless caller can't push duplicates
      // (case-insensitive, since GHL normalises tag names).
      const seen = new Set<string>();
      const cleaned: string[] = [];
      for (const t of nextTags) {
        const trimmed = t.trim();
        if (!trimmed) continue;
        const key = trimmed.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        cleaned.push(trimmed);
      }
      updateBootstrap((prev) => ({
        ...prev,
        conversations: prev.conversations.map((c) =>
          c.participant.id === contactId
            ? { ...c, participant: { ...c.participant, tags: cleaned } }
            : c
        ),
      }));
      api.contacts
        .update(contactId, { tags: cleaned })
        .then((updated) => {
          // Reconcile from the server response — GHL may have canonicalised
          // casing or order, and we want the cache to reflect the truth.
          updateBootstrap((prev) => ({
            ...prev,
            conversations: prev.conversations.map((c) =>
              c.participant.id === contactId
                ? { ...c, participant: { ...c.participant, tags: updated.tags ?? [] } }
                : c
            ),
          }));
        })
        .catch((err) => {
          console.error("contact tag update failed", err);
          toast({
            title: "No se pudo actualizar las etiquetas",
            description: (err as Error)?.message || "Inténtalo de nuevo.",
            variant: "destructive",
          });
        });
    },
    [toast, updateBootstrap]
  );

  // Owner / followers patch — used by ContactSidebar's Asignación section.
  // Patches every conversation row whose participant is this contact so the
  // header and the right panel stay in sync, then writes through to the
  // backend (`assignedTo` → GHL contact, `followers` → in-memory store).
  // On failure the optimistic patch is left in place but a toast surfaces the
  // error — the user can re-pick to retry.
  // Brand-new contact creation — driven by the sidebar's "Agregar contacto"
  // dialog. We don't pre-create a stub row here because the GHL ContactCreate
  // webhook will fire shortly after the API call and the lead.updated handler
  // already knows how to upsert a new lead. Returning the created contact's
  // id lets the dialog confirm success while we wait for the webhook to
  // backfill richer state (assignedTo, opportunities, etc.).
  const handleCreateContact = useCallback(
    async (payload: { name?: string; phone?: string; email?: string }) => {
      try {
        const created = await api.contacts.create(payload);
        return { id: created.id };
      } catch (err) {
        console.error("contact create failed", err);
        toast({
          title: "No se pudo agregar el contacto",
          description: String((err as Error)?.message ?? err),
          variant: "destructive",
        });
        return null;
      }
    },
    [toast]
  );

  const handleUpdateAssignment = useCallback(
    (
      contactId: string,
      patch: { assignedTo?: string | null; followers?: string[] }
    ) => {
      // Capture the previous assignment before the optimistic mutation
      // overwrites it, so we can compute the badge delta accurately.
      const prevBootstrap = queryClient.getQueryData<BootstrapPayload>(
        BOOTSTRAP_QUERY_KEY
      );
      const prevConv = prevBootstrap?.conversations.find(
        (c) => c.contactId === contactId || c.participant.id === contactId
      );
      const prevAssignedTo = prevConv?.participant.assignedTo ?? null;

      updateBootstrap((prev) => ({
        ...prev,
        conversations: prev.conversations.map((c) => {
          const matches =
            c.contactId === contactId || c.participant.id === contactId;
          if (!matches) return c;
          return {
            ...c,
            participant: {
              ...c.participant,
              ...(patch.assignedTo !== undefined
                ? { assignedTo: patch.assignedTo ?? undefined }
                : {}),
              ...(patch.followers !== undefined
                ? { followers: patch.followers }
                : {}),
            },
          };
        }),
      }));

      // Optimistically nudge the "Asignados a mí" badge so self-assigning
      // a lead bumps the count immediately, without waiting for the
      // 60s staleTime or the GHL webhook round-trip.
      if (
        myUserId &&
        patch.assignedTo !== undefined &&
        prevConv // skip if the bootstrap didn't know this contact (avoids double-count when the webhook later syncs)
      ) {
        const wasMine = prevAssignedTo === myUserId;
        const isMine = patch.assignedTo === myUserId;
        const delta = (isMine ? 1 : 0) - (wasMine ? 1 : 0);
        if (delta !== 0) {
          queryClient.setQueryData<{ count: number }>(
            assignedCountQueryKey,
            (prev) => ({ count: Math.max(0, (prev?.count ?? 0) + delta) })
          );
        }
      }

      api.contacts.update(contactId, patch).catch((err) => {
        console.error("contact assignment update failed", err);
        toast({
          title: "No se pudo guardar la asignación",
          description: String((err as Error)?.message ?? err),
          variant: "destructive",
        });
      });
    },
    [assignedCountQueryKey, myUserId, queryClient, toast, updateBootstrap]
  );

  const handleAddTask = useCallback(
    (task: Omit<Task, "id">) => {
      const optimisticId = `t-tmp-${Date.now()}`;
      // clientId travels to the backend and comes back on the create response +
      // WS broadcast, so we reconcile the optimistic row to the real one by an
      // exact key instead of title/date (which collide across identical tasks).
      const optimistic: Task = { ...task, id: optimisticId, clientId: optimisticId };
      updateBootstrap((prev) => ({ ...prev, tasks: [optimistic, ...prev.tasks] }));

      // If the user is viewing the task list, jump to the date filter that
      // actually shows the new task. Otherwise a future-dated task created
      // while the "Hoy" filter is active looks like it vanished — it's just
      // filtered out. (No-op when not in the tasks section, e.g. creating
      // from a conversation view, so we don't yank the user away.)
      if (activeMainTab.startsWith("tareas-") && task.dueAt) {
        const peruDay = (d: Date) =>
          d.toLocaleDateString("en-CA", { timeZone: "America/Lima" });
        const due = new Date(task.dueAt);
        if (!Number.isNaN(due.getTime())) {
          const today = peruDay(new Date());
          const day = peruDay(due);
          const target =
            day < today
              ? "tareas-atrasado"
              : day > today
                ? "tareas-proximos"
                : "tareas-hoy";
          if (activeMainTab !== target) setActiveMainTab(target);
        }
      }

      if (!task.conversationId) return;
      api.tasks
        .create({
          conversationId: task.conversationId,
          // Send the raw ISO instant when we have it — `task.dueDate` is now a
          // display label (e.g. "30 jun, 02:43 a. m.") that the backend's
          // parseDueDate can't read; the ISO is unambiguous.
          dueDate: task.dueAt ?? task.dueDate,
          title: task.title,
          // GHL user id picked in the "Asignado a" dropdown. GHL assigns the
          // task to this user; omitted (unassigned) when no id resolved. Guard
          // against the "agent" dedup sentinel — it is NOT a valid GHL user id
          // and GHL rejects it ("The assigned to field is invalid").
          assignedTo:
            task.assignee.id && task.assignee.id !== "agent"
              ? task.assignee.id
              : undefined,
          // Pass the contact name we already know (GHL's task response omits
          // it) so the saved row + WS broadcast don't fall back to "Contacto".
          contactName: task.contact?.name,
          clientId: optimisticId,
        })
        .then((saved) => {
          updateBootstrap((prev) => {
            const optimisticRow = prev.tasks.find((t) => t.id === optimisticId);
            // Merge: GHL's create response can drop the contact name (→ generic
            // "Contacto") and the due date, so fall back to the optimistic
            // values we already have for those.
            const savedDueValid =
              saved.dueAt && !Number.isNaN(Date.parse(saved.dueAt));
            const merged: Task = {
              ...saved,
              contact:
                (!saved.contact?.name || saved.contact.name === "Contacto") &&
                optimisticRow
                  ? optimisticRow.contact
                  : saved.contact,
              dueAt: savedDueValid ? saved.dueAt : optimisticRow?.dueAt,
              dueDate: savedDueValid ? saved.dueDate : optimisticRow?.dueDate ?? saved.dueDate,
            };
            // If the real row already arrived via WS (task.created/lead.updated),
            // just drop the optimistic — converting it would leave two rows with
            // the same id. Otherwise convert the optimistic row in place.
            const realAlreadyPresent = prev.tasks.some((t) => t.id === saved.id);
            const tasks = realAlreadyPresent
              ? prev.tasks.filter((t) => t.id !== optimisticId)
              : prev.tasks.map((t) => (t.id === optimisticId ? merged : t));
            return { ...prev, tasks };
          });
        })
        .catch((err) => {
          console.error("create task failed", err);
          updateBootstrap((prev) => ({
            ...prev,
            tasks: prev.tasks.filter((t) => t.id !== optimisticId),
          }));
          toast({
            title: "No se pudo crear la tarea",
            description: String(err),
            variant: "destructive",
          });
        });
    },
    [activeMainTab, setActiveMainTab, toast, updateBootstrap]
  );

  // Edit an existing task in place. Mirrors handleAddTask's optimistic
  // pattern: patch the local cache first, then PATCH the GHL task and
  // reconcile from the response. On failure we revert to the pre-edit
  // shape so the banner doesn't show stale state.
  const handleUpdateTask = useCallback(
    (id: string, patch: { title?: string; dueDate?: string }) => {
      let prevSnapshot: Task | undefined;
      let contactId: string | undefined;
      updateBootstrap((prev) => {
        const idx = prev.tasks.findIndex((t) => t.id === id);
        if (idx === -1) return prev;
        prevSnapshot = prev.tasks[idx];
        const conv = prev.conversations.find(
          (c) => c.id === prevSnapshot!.conversationId
        );
        // Prefer the task's own contactId (from the durable mirror).
        contactId = prevSnapshot.contactId ?? conv?.contactId ?? conv?.participant.id;
        const next = prev.tasks.slice();
        next[idx] = { ...prevSnapshot, ...patch };
        return { ...prev, tasks: next };
      });
      if (id.startsWith("t-tmp-")) return;
      // Always persist. Use contactId when known; otherwise the taskId-only
      // endpoint (backend resolves the contact from the mirror).
      (contactId
        ? api.tasks.update(contactId, id, patch)
        : api.tasks.updateById(id, patch)
      )
        .then((saved) => {
          updateBootstrap((prev) => ({
            ...prev,
            tasks: prev.tasks.map((t) =>
              t.id === id ? { ...t, ...saved } : t
            ),
          }));
        })
        .catch((err) => {
          console.error("update task failed", err);
          if (prevSnapshot) {
            const snapshot = prevSnapshot;
            updateBootstrap((prev) => ({
              ...prev,
              tasks: prev.tasks.map((t) => (t.id === id ? snapshot : t)),
            }));
          }
          toast({
            title: "No se pudo actualizar la tarea",
            description: String(err),
            variant: "destructive",
          });
        });
    },
    [toast, updateBootstrap]
  );

  const handleToggleTask = useCallback(
    (id: string) => {
      let nextStatus: Task["status"] = "completed";
      let contactId: string | undefined;
      updateBootstrap((prev) => ({
        ...prev,
        tasks: prev.tasks.map((t) => {
          if (t.id !== id) return t;
          nextStatus = t.status === "completed" ? "pending" : "completed";
          const conv = prev.conversations.find((c) => c.id === t.conversationId);
          // Prefer the task's own contactId (carried from the durable mirror);
          // fall back to the loaded conversation only if absent.
          contactId = t.contactId ?? conv?.contactId ?? conv?.participant.id;
          return { ...t, status: nextStatus };
        }),
      }));
      if (!id.startsWith("t-tmp-")) {
        // Always send to GHL. Use the contactId when known; otherwise the
        // taskId-only endpoint (backend resolves the contact from the mirror)
        // so completion persists even for tasks whose lead isn't loaded.
        const done = nextStatus === "completed";
        const req = contactId
          ? api.tasks.setCompleted(contactId, id, done)
          : api.tasks.setCompletedById(id, done);
        req.catch((err) => console.error("toggle task failed", err));
      }
    },
    [updateBootstrap]
  );

  const handleSaveView = useCallback(
    (view: SavedView) => {
      setSavedViews((prev) => {
        const exists = prev.find((v) => v.id === view.id);
        return exists ? prev.map((v) => (v.id === view.id ? view : v)) : [...prev, view];
      });
      setActiveViewId(view.id);
      // Persist durably (per-location). Optimistic local update above.
      api.views
        .upsert(view)
        .catch((err) => console.error("save view failed", err));
    },
    [setActiveViewId]
  );

  const handleDeleteView = useCallback(
    (id: string) => {
      setSavedViews((prev) => prev.filter((v) => v.id !== id));
      if (activeViewId === id) setActiveViewId(null);
      api.views
        .remove(id)
        .catch((err) => console.error("delete view failed", err));
    },
    [activeViewId, setActiveViewId]
  );

  const handleMoveOpportunity = useCallback(
    (id: string, stageId: string) => {
      // GHL requires the pipelineId when moving the stage — resolve it from
      // the opportunity so the move actually persists (not just optimistic).
      const opp = opportunities.find((o) => o.id === id);
      const pipelineId = opp?.pipelineId;
      const contactId = opp?.contactId;
      // Optimistically move the card AND live-sync the linked lead's funnel
      // badge: patch `stage` on every conversation for this opportunity's
      // contact, so the chat-list embudo badge updates without a refresh.
      updateBootstrap((prev) => ({
        ...prev,
        opportunities: prev.opportunities.map((o) => (o.id === id ? { ...o, stageId } : o)),
        conversations: contactId
          ? prev.conversations.map((c) =>
              c.participant.id === contactId ? { ...c, stage: stageId } : c
            )
          : prev.conversations,
      }));
      // Mirror into the active filtered result lists (No leídos / Asignados /
      // Seguidos / búsqueda) so the badge updates there too if one is shown.
      const patchStage = (c: Conversation) =>
        c.participant.id === contactId ? { ...c, stage: stageId } : c;
      if (contactId) {
        setSearchResults((prev) => (prev ? prev.map(patchStage) : prev));
        setUnreadResults((prev) => (prev ? prev.map(patchStage) : prev));
        setAssignedResults((prev) => (prev ? prev.map(patchStage) : prev));
        setFollowedResults((prev) => (prev ? prev.map(patchStage) : prev));
      }
      api.opportunities
        .move(id, stageId, pipelineId)
        .catch((err) => console.error("opportunity move failed", err));
      // Persist the lead's stage (flagsStore override) so it survives a
      // refresh and isn't masked by a stale override — same as the chat
      // sidebar's "Estado" dropdown does.
      const convId = contactId
        ? conversations.find((c) => c.participant.id === contactId)?.id
        : undefined;
      if (convId && !isStubConvId(convId)) {
        api.conversations
          .patch(convId, { stage: stageId })
          .catch((err) => console.error("lead stage sync failed", err));
      }
    },
    [updateBootstrap, opportunities, conversations]
  );

  // Status (open/won/lost/abandoned) + monetaryValue patches for the
  // right-rail business-status row. The backend PATCH already broadcasts
  // `opportunity.updated`, so the optimistic write here just smooths over
  // the round-trip; the WS echo reconciles for other connected clients.
  const handleUpdateOpportunity = useCallback(
    (
      id: string,
      patch: { status?: Opportunity["status"]; monetaryValue?: number }
    ) => {
      updateBootstrap((prev) => ({
        ...prev,
        opportunities: prev.opportunities.map((o) =>
          o.id === id ? { ...o, ...patch } : o
        ),
      }));
      api.opportunities
        .update(id, patch)
        .then((updated) => {
          updateBootstrap((prev) => ({
            ...prev,
            opportunities: prev.opportunities.map((o) =>
              o.id === id ? updated : o
            ),
          }));
        })
        .catch((err) => {
          console.error("opportunity update failed", err);
          toast({
            title: "No se pudo actualizar la oportunidad",
            description: (err as Error)?.message || "Inténtalo de nuevo.",
            variant: "destructive",
          });
        });
    },
    [updateBootstrap, toast]
  );

  // Lightweight create used by ContactSidebar's empty-state opportunity
  // controls. The sidebar only knows the contact and a small patch of
  // fields (status / monetaryValue); we fill in name/pipeline/stage
  // defaults here. After the create lands we follow up with a status
  // PATCH when the requested status isn't the default `open` —
  // POST /opportunities doesn't accept `status`.
  const handleCreateOpportunityForContact = useCallback(
    (
      contactId: string,
      contactName: string | undefined,
      patch: { status?: Opportunity["status"]; monetaryValue?: number }
    ) => {
      const pipeline = pipelines[0];
      const stage = pipeline?.stages[0];
      if (!pipeline || !stage) {
        toast({
          title: "No se pudo crear la oportunidad",
          description: "No hay pipelines o etapas configurados en GHL.",
          variant: "destructive",
        });
        return;
      }
      const name = (contactName ?? "").trim() || "Lead";
      api.opportunities
        .create({
          name,
          contactId,
          pipelineId: pipeline.id,
          stageId: stage.id,
          monetaryValue: patch.monetaryValue,
        })
        .then((created) => {
          updateBootstrap((prev) => ({
            ...prev,
            opportunities: prev.opportunities.some((o) => o.id === created.id)
              ? prev.opportunities.map((o) =>
                  o.id === created.id ? created : o
                )
              : [created, ...prev.opportunities],
          }));
          // Translate the requested status into a follow-up PATCH — the
          // create endpoint always lands in `open`, so any other choice
          // needs a second hop. handleUpdateOpportunity owns the
          // optimistic update + retry-on-fail.
          if (patch.status && patch.status !== "open") {
            handleUpdateOpportunity(created.id, { status: patch.status });
          }
        })
        .catch((err) => {
          console.error("create opportunity (sidebar) failed", err);
          toast({
            title: "No se pudo crear la oportunidad",
            description: String((err as Error)?.message ?? err),
            variant: "destructive",
          });
        });
    },
    [pipelines, toast, updateBootstrap, handleUpdateOpportunity]
  );

  const handleCreateOpportunity = useCallback(
    async (payload: {
      name: string;
      contactId: string;
      pipelineId: string;
      stageId: string;
      monetaryValue?: number;
    }) => {
      try {
        const created = await api.opportunities.create(payload);
        updateBootstrap((prev) => ({
          ...prev,
          opportunities: prev.opportunities.some((o) => o.id === created.id)
            ? prev.opportunities
            : [created, ...prev.opportunities],
        }));
        toast({
          title: "Oportunidad creada",
          description: `${payload.name} se agregó al pipeline.`,
        });
      } catch (err) {
        console.error("create opportunity failed", err);
        toast({
          title: "No se pudo crear la oportunidad",
          description: String((err as Error)?.message ?? err),
          variant: "destructive",
        });
      }
    },
    [toast, updateBootstrap]
  );

  const handleDeleteLead = useCallback(async (conversationId?: string) => {
    // Resolve the target: explicit id when called from the sidebar dropdown,
    // otherwise the currently active conversation (chat header trash icon).
    const cache = queryClient.getQueryData<BootstrapPayload>(BOOTSTRAP_QUERY_KEY);
    const target = conversationId
      ? cache?.conversations.find((c) => c.id === conversationId)
      : activeConversation;
    const contactId = target?.contactId ?? target?.participant.id;
    if (!contactId) return;

    await api.contacts.delete(contactId);

    // Drop the deleted contact's conversations and remember how many slots
    // opened up — we'll backfill the same number from the next page so the
    // sidebar window stays the same size after delete.
    let removedCount = 0;
    let cursorForBackfill: number | null = null;
    updateBootstrap((prev) => {
      const filtered = prev.conversations.filter(
        (c) => c.contactId !== contactId && c.participant.id !== contactId
      );
      removedCount = prev.conversations.length - filtered.length;
      cursorForBackfill = prev.conversationsNextCursor;
      return { ...prev, conversations: filtered };
    });
    // If the row being deleted is currently open, navigate away from it (drop
    // the conversation segment from the URL so it doesn't point at a dead lead).
    if (target?.id && target.id === activeIdRef.current) {
      setActiveId(null);
      navigate(activeViewId ? viewIdToPath(activeViewId) : tabToPath(activeMainTab || DEFAULT_TAB));
    }
    toast({ title: "Lead eliminado", description: "El contacto ha sido eliminado correctamente." });

    // Pull `removedCount` older conversations from GHL using the existing
    // pagination cursor. No-op when we've already loaded everything
    // (`conversationsNextCursor === null`).
    if (removedCount > 0 && cursorForBackfill != null) {
      try {
        const result = await api.conversations.list({
          limit: removedCount,
          startAfterDate: cursorForBackfill,
        });
        updateBootstrap((prev) => {
          const existingIds = new Set(prev.conversations.map((c) => c.id));
          const fresh = result.conversations.filter((c) => !existingIds.has(c.id));
          return {
            ...prev,
            conversations: fresh.length ? [...prev.conversations, ...fresh] : prev.conversations,
            conversationsNextCursor: result.nextCursor,
          };
        });
      } catch (err) {
        console.error("backfill after delete failed", err);
      }
    }
  }, [activeConversation, queryClient, updateBootstrap, toast, navigate, activeViewId, activeMainTab]);

  const setStages = useCallback(
    (next: BootstrapPayload["stages"]) => {
      updateBootstrap((prev) => ({ ...prev, stages: next }));
    },
    [updateBootstrap]
  );

  const opportunitiesPipeline = pipelines[0];

  if (isLoading) {
    // Branded splash loader for the initial app load: a spinning gradient ring
    // around a glowing chat mark, with animated dots — themed in the project's
    // primary color on the dark background.
    return (
      <div className="relative flex h-screen w-full items-center justify-center overflow-hidden bg-background">
        {/* Soft ambient glow behind the mark. */}
        <div className="pointer-events-none absolute h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex flex-col items-center gap-8">
          <div className="relative flex h-24 w-24 items-center justify-center">
            {/* Spinning conic-gradient ring (masked to a thin ring). */}
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
            {/* Gentle pulsing halo. */}
            <div className="absolute inset-1.5 animate-ping rounded-full bg-primary/10 [animation-duration:2s]" />
            {/* Inner disc with the chat mark. */}
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
              Cargando tu bandeja…
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

  if (error || !data) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center gap-2 bg-background p-6 text-center">
        <h1 className="text-xl font-semibold">No se pudo conectar al backend</h1>
        <p className="text-sm text-muted-foreground max-w-lg">
          {error instanceof Error ? error.message : "Error al cargar datos"}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <div className="h-full shrink-0 hidden md:block">
        <MainSidebar
          savedViews={savedViews}
          activeViewId={activeViewId}
          onSelectView={setActiveViewId}
          activeTab={activeMainTab}
          onSelectTab={setActiveMainTab}
          taskUserFilters={taskUserFilters}
          setTaskUserFilters={setTaskUserFilters}
          tasks={tasks}
          users={users}
          onDeleteView={handleDeleteView}
          assignedToMeCount={assignedToMeCount}
        />
      </div>

      <Sheet open={isMobileNavOpen} onOpenChange={setIsMobileNavOpen}>
        <SheetContent side="left" className="p-0 w-auto max-w-none border-r-0">
          <SheetTitle className="sr-only">Navegación</SheetTitle>
          <MainSidebar
            savedViews={savedViews}
            activeViewId={activeViewId}
            onSelectView={handleSelectViewMobile}
            activeTab={activeMainTab}
            onSelectTab={handleSelectMainTab}
            taskUserFilters={taskUserFilters}
            setTaskUserFilters={setTaskUserFilters}
            tasks={tasks}
            users={users}
            onDeleteView={handleDeleteView}
            assignedToMeCount={assignedToMeCount}
            forceExpanded
          />
        </SheetContent>
      </Sheet>

      {/* Lead-list drawer (mobile). Mirrors the second column so the agent
          can browse other conversations / tasks while keeping the active
          chat open underneath. Hidden by `md:hidden` on the trigger side;
          on md+ the second column is part of the persistent layout. */}
      <Sheet open={isChatListSheetOpen} onOpenChange={setIsChatListSheetOpen}>
        <SheetContent side="left" className="p-0 w-[88vw] sm:w-96 max-w-none border-r-0 md:hidden">
          <SheetTitle className="sr-only">
            {activeMainTab.startsWith("tareas-") ? "Tareas" : "Conversaciones"}
          </SheetTitle>
          {activeMainTab.startsWith("tareas-") ? (
            <TaskList
              tasks={tasks}
              onToggleTask={handleToggleTask}
              filterType={activeMainTab}
              selectedUsers={taskUserFilters}
              onSelectConversation={handleSelectConversationMobile}
              activeConversationId={activeId || ""}
              onOpenMobileNav={() => {
                setIsChatListSheetOpen(false);
                setIsMobileNavOpen(true);
              }}
            />
          ) : (
            <ChatSidebar
              totalUnread={totalUnread}
              onFilterChange={(f) => setUnreadFilterActive(f === "unread")}
              myUserId={myUserId}
              conversations={displayConversations}
              tasks={tasks}
              activeConversationId={activeId || ""}
              onSelectConversation={handleSelectConversationMobile}
              onToggleFavorite={handleToggleFavorite}
              onArchiveConversation={handleToggleArchive}
              onMarkAsRead={handleMarkAsRead}
              onMarkAsUnread={handleMarkAsUnread}
              activeViewId={activeViewId}
              savedViews={savedViews}
              onSaveView={handleSaveView}
              stages={stages}
              activeTab={activeMainTab}
              onLoadMore={handleLoadMoreConversations}
              hasMore={
                // Precedence MUST match handleLoadMoreConversations and
                // displayConversations (search/filter first) — otherwise a
                // filter applied while on a tab reads the wrong cursor and
                // infinite scroll stops firing.
                (isSearchActive
                  ? searchNextCursor
                  : unreadFilterActive
                    ? unreadNextCursor
                    : assignedFilterActive
                      ? assignedNextCursor
                      : followedFilterActive
                        ? followedNextCursor
                        : conversationsNextCursor) !== null
              }
              isLoadingMore={isLoadingMoreConversations}
              isLoadingList={isLoadingConversationList}
              searchValue={searchQuery}
              onSearchChange={setSearchQuery}
              onDateRangeChange={setDateFilterRange}
              isSearching={isSearching}
              onOpenMobileNav={() => {
                setIsChatListSheetOpen(false);
                setIsMobileNavOpen(true);
              }}
              onCreateContact={handleCreateContact}
              onCreateOpportunity={handleCreateOpportunity}
              pipelineId={opportunitiesPipeline?.id}
              users={users}
              availableTags={availableTags}
              advancedFilters={advancedFilters}
              advancedLogic={advancedLogic}
              advancedFiltersServerApplied={advancedFilterServerInfo.hasServerParam}
              onAdvancedFiltersChange={setAdvancedFilters}
              onAdvancedLogicChange={setAdvancedLogic}
              onDeleteConversation={(id) => {
                handleDeleteLead(id).catch((err) => {
                  console.error("delete from sidebar failed", err);
                  toast({
                    title: "No se pudo eliminar el lead",
                    description: String(err),
                    variant: "destructive",
                  });
                });
              }}
            />
          )}
        </SheetContent>
      </Sheet>

      {activeMainTab !== "oportunidades" && (
        <div className={`h-full shrink-0 ${activeId ? "hidden md:block" : "block w-full md:w-auto"}`}>
          {activeMainTab.startsWith("tareas-") ? (
            <TaskList
              tasks={tasks}
              onToggleTask={handleToggleTask}
              filterType={activeMainTab}
              selectedUsers={taskUserFilters}
              onSelectConversation={handleSelectConversation}
              activeConversationId={activeId || ""}
              onOpenMobileNav={() => setIsMobileNavOpen(true)}
            />
          ) : (
            <ChatSidebar
              totalUnread={totalUnread}
              onFilterChange={(f) => setUnreadFilterActive(f === "unread")}
              myUserId={myUserId}
              conversations={displayConversations}
              tasks={tasks}
              activeConversationId={activeId || ""}
              onSelectConversation={handleSelectConversation}
              onToggleFavorite={handleToggleFavorite}
              onArchiveConversation={handleToggleArchive}
              onMarkAsRead={handleMarkAsRead}
              onMarkAsUnread={handleMarkAsUnread}
              activeViewId={activeViewId}
              savedViews={savedViews}
              onSaveView={handleSaveView}
              stages={stages}
              activeTab={activeMainTab}
              onLoadMore={handleLoadMoreConversations}
              hasMore={
                // Precedence MUST match handleLoadMoreConversations and
                // displayConversations (search/filter first) — otherwise a
                // filter applied while on a tab reads the wrong cursor and
                // infinite scroll stops firing.
                (isSearchActive
                  ? searchNextCursor
                  : unreadFilterActive
                    ? unreadNextCursor
                    : assignedFilterActive
                      ? assignedNextCursor
                      : followedFilterActive
                        ? followedNextCursor
                        : conversationsNextCursor) !== null
              }
              isLoadingMore={isLoadingMoreConversations}
              isLoadingList={isLoadingConversationList}
              searchValue={searchQuery}
              onSearchChange={setSearchQuery}
              onDateRangeChange={setDateFilterRange}
              isSearching={isSearching}
              onOpenMobileNav={() => setIsMobileNavOpen(true)}
              onCreateContact={handleCreateContact}
              onCreateOpportunity={handleCreateOpportunity}
              pipelineId={opportunitiesPipeline?.id}
              users={users}
              availableTags={availableTags}
              advancedFilters={advancedFilters}
              advancedLogic={advancedLogic}
              advancedFiltersServerApplied={advancedFilterServerInfo.hasServerParam}
              onAdvancedFiltersChange={setAdvancedFilters}
              onAdvancedLogicChange={setAdvancedLogic}
              onDeleteConversation={(id) => {
                handleDeleteLead(id).catch((err) => {
                  console.error("delete from sidebar failed", err);
                  toast({
                    title: "No se pudo eliminar el lead",
                    description: String(err),
                    variant: "destructive",
                  });
                });
              }}
            />
          )}
        </div>
      )}

      {activeMainTab === "oportunidades" ? (
        <div className="flex-1 h-full min-w-0 overflow-hidden">
          <OpportunitiesView
            opportunities={opportunitiesForKanban}
            pipeline={opportunitiesPipeline}
            isLoading={isLoadingOpportunities}
            conversations={conversations}
            tasks={tasks}
            users={users}
            availableTags={availableTags}
            savedViews={savedViews}
            onSaveView={handleSaveView}
            onMoveOpportunity={handleMoveOpportunity}
            onCreateOpportunity={handleCreateOpportunity}
            onCreateContact={handleCreateContact}
            onOpenMobileNav={() => setIsMobileNavOpen(true)}
            onOpenChat={(contactId) => setOpportunityChatContactId(contactId)}
          />
        </div>
      ) : (
        <div className={`flex-1 h-full min-w-0 ${!activeId ? "hidden md:flex" : "flex"}`}>
          {activeConversation ? (
            <ChatMessageArea
              key={activeConversation.id}
              conversation={activeConversation}
              currentUser={currentUser}
              users={users}
              tasks={tasks}
              stages={stages}
              setStages={setStages}
              onAddTask={handleAddTask}
              onUpdateTask={handleUpdateTask}
              onToggleTask={handleToggleTask}
              onSendMessage={handleSendMessage}
              onScheduleMessage={handleScheduleMessage}
              onSendTemplateNow={handleSendTemplateNow}
              onCancelScheduledMessage={handleCancelScheduledMessage}
              onUpdateStage={handleUpdateStage}
              onClearReminder={handleClearReminder}
              onSetReminder={handleSetReminder}
              isContactSidebarOpen={isContactSidebarOpen}
              onToggleContactSidebar={handleToggleContactSidebar}
              hasOlderMessages={Boolean(activeConversation.messagesHasMore)}
              isLoadingOlderMessages={loadingOlderFor === activeId}
              onLoadOlderMessages={handleLoadOlderMessages}
              onDeleteLead={handleDeleteLead}
              onToggleFavorite={handleToggleFavorite}
              onMarkAsRead={handleMarkAsRead}
              onMarkAsUnread={handleMarkAsUnread}
              onSetBotStatus={handleSetBotStatus}
              isLoadingHistory={hydratingId === activeId}
              onPinMessage={handlePinMessage}
              onUnpinMessage={handleUnpinMessage}
              onOpenMobileNav={() => setIsMobileNavOpen(true)}
              onOpenChatList={() => setIsChatListSheetOpen(true)}
            />
          ) : activeId && hydratingId === activeId ? (
            // A conversation is selected and its data is still being fetched
            // (e.g. a deep-linked / out-of-window lead). The message-area
            // skeleton lives INSIDE ChatMessageArea, which isn't mounted yet, so
            // render a standalone chat skeleton here instead of the empty inbox.
            <div className="flex h-full w-full flex-col bg-background">
              <div className="flex h-[68px] items-center gap-3 border-b px-4">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-40 rounded" />
                  <Skeleton className="h-3 w-24 rounded" />
                </div>
              </div>
              <div className="flex-1 space-y-2 p-6">
                {[
                  { me: false, lines: ["w-40", "w-52"] },
                  { me: true, lines: ["w-56", "w-28"] },
                  { me: false, lines: ["w-44"] },
                  { me: true, lines: ["w-60", "w-48", "w-24"] },
                  { me: false, lines: ["w-36", "w-52"] },
                ].map((b, i) => (
                  <div
                    key={i}
                    className={`flex items-end gap-2 ${b.me ? "justify-end" : "justify-start"}`}
                  >
                    {!b.me && <Skeleton className="h-8 w-8 shrink-0 rounded-full" />}
                    <div
                      className={`max-w-[70%] rounded-2xl px-3.5 py-2.5 ${
                        b.me ? "bg-primary/10 rounded-br-md" : "bg-muted rounded-bl-md"
                      }`}
                    >
                      <div className="space-y-2">
                        {b.lines.map((w, j) => (
                          <Skeleton key={j} className={`h-3 rounded bg-foreground/10 ${w}`} />
                        ))}
                      </div>
                    </div>
                    {b.me && <Skeleton className="h-8 w-8 shrink-0 rounded-full" />}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center bg-muted/30 p-8 text-center">
              <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-10 w-10 text-primary"
                >
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-foreground">Bandeja de Entrada</h3>
              <p className="mt-2 max-w-sm text-muted-foreground">
                Selecciona una conversación de la barra lateral para comenzar a enviar mensajes.
              </p>
            </div>
          )}
        </div>
      )}

      {activeMainTab !== "oportunidades" && activeConversation && (
        <div
          className={cn(
            "h-full shrink-0 hidden lg:block transition-all duration-300 ease-in-out",
            isContactSidebarOpen ? "w-72 xl:w-80 2xl:w-96 border-l" : "w-0 overflow-hidden border-none"
          )}
        >
          <div className="w-72 xl:w-80 2xl:w-96 h-full">
            <ContactSidebar
              contact={activeConversation.participant}
              conversation={activeConversation}
              onUpdateContactName={(newName) =>
                handleUpdateContactName(activeConversation.participant.id, newName)
              }
              users={users}
              availableTags={availableTags}
              onUpdateTags={(tags) =>
                handleUpdateContactTags(activeConversation.participant.id, tags)
              }
              onUpdateContactFields={(patch) =>
                handleUpdateContactFields(
                  activeConversation.participant.id,
                  patch
                )
              }
              opportunity={opportunities.find(
                (o) => o.contactId === activeConversation.participant.id
              )}
              onUpdateOpportunity={handleUpdateOpportunity}
              onCreateOpportunity={(patch) =>
                handleCreateOpportunityForContact(
                  activeConversation.participant.id,
                  activeConversation.participant.name,
                  patch
                )
              }
              onUpdateAssignedTo={(userId) =>
                handleUpdateAssignment(activeConversation.participant.id, {
                  assignedTo: userId,
                })
              }
              onUpdateFollowers={(ids) =>
                handleUpdateAssignment(activeConversation.participant.id, {
                  followers: ids,
                })
              }
            />
          </div>
        </div>
      )}

      <Sheet open={isContactSheetOpen} onOpenChange={setIsContactSheetOpen}>
        <SheetContent side="right" className="p-0 w-[85vw] sm:w-96 max-w-none border-l-0 lg:hidden">
          <SheetTitle className="sr-only">Detalles del contacto</SheetTitle>
          {activeConversation && (
            <ContactSidebar
              contact={activeConversation.participant}
              conversation={activeConversation}
              onUpdateContactName={(newName) =>
                handleUpdateContactName(activeConversation.participant.id, newName)
              }
              users={users}
              availableTags={availableTags}
              onUpdateTags={(tags) =>
                handleUpdateContactTags(activeConversation.participant.id, tags)
              }
              onUpdateContactFields={(patch) =>
                handleUpdateContactFields(
                  activeConversation.participant.id,
                  patch
                )
              }
              opportunity={opportunities.find(
                (o) => o.contactId === activeConversation.participant.id
              )}
              onUpdateOpportunity={handleUpdateOpportunity}
              onCreateOpportunity={(patch) =>
                handleCreateOpportunityForContact(
                  activeConversation.participant.id,
                  activeConversation.participant.name,
                  patch
                )
              }
              onUpdateAssignedTo={(userId) =>
                handleUpdateAssignment(activeConversation.participant.id, {
                  assignedTo: userId,
                })
              }
              onUpdateFollowers={(ids) =>
                handleUpdateAssignment(activeConversation.participant.id, {
                  followers: ids,
                })
              }
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Opportunity → Chat modal. Open from a Kanban card without leaving
          the board. We resolve the conversation by contactId at render time
          (rather than capturing it in state) so live WS patches keep the
          modal's content fresh. */}
      <Dialog
        open={opportunityChatContactId !== null}
        onOpenChange={(open) => {
          if (!open) setOpportunityChatContactId(null);
        }}
      >
        <DialogContent className="max-w-[1200px] w-[95vw] h-[85vh] p-0 overflow-hidden border-none rounded-xl gap-0 bg-background flex flex-row">
          <DialogTitle className="sr-only">Conversación de la oportunidad</DialogTitle>
          {(() => {
            if (!opportunityChatContactId) return null;
            const realConv = conversations.find(
              (c) =>
                c.contactId === opportunityChatContactId ||
                c.participant.id === opportunityChatContactId
            );
            // Loading state — fetching the contact for a new
            // opportunity that doesn't have a conversation cached yet.
            if (!realConv && isLoadingOpportunityChat) {
              return (
                <div className="flex-1 flex items-center justify-center p-8 text-sm text-muted-foreground">
                  Cargando contacto…
                </div>
              );
            }
            // No real conversation AND no fallback contact loaded —
            // the fetch failed or the contact was deleted. Show the
            // original message instead of an empty modal.
            if (!realConv && !opportunityChatFallback) {
              return (
                <div className="flex-1 flex items-center justify-center p-8 text-sm text-muted-foreground text-center">
                  No se pudo cargar la información del contacto.
                </div>
              );
            }
            // Either a real conversation OR a synthesised stub backed
            // by the fetched contact. The stub uses the SPA's existing
            // `pending-${contactId}` convention so the WS lead.updated
            // handler can later swap it for the real conversation
            // when (and if) one arrives via webhook.
            const conv: Conversation =
              realConv ?? {
                id: `pending-${opportunityChatContactId}`,
                contactId: opportunityChatContactId,
                participant: opportunityChatFallback!,
                source: "whatsapp",
                recipientNumber: opportunityChatFallback?.phone ?? "",
                lastMessage: "",
                unreadCount: 0,
                timestamp: "",
                messages: [],
              };
            return (
              <>
                <div className="flex-1 min-w-0 flex flex-col">
                  <ChatMessageArea
                    key={`opp-${conv.id}`}
                    conversation={conv}
                    currentUser={currentUser}
                    users={users}
                    opportunities={opportunities}
                    pipelines={pipelines}
                    tasks={tasks}
                    stages={stages}
                    setStages={setStages}
                    onAddTask={handleAddTask}
                    onUpdateTask={handleUpdateTask}
                    onToggleTask={handleToggleTask}
                    onSendMessage={(text, attachment, channel, mentions, reminder, replyTo) =>
                      // Target conv.id explicitly — `activeId` can't be flipped
                      // synchronously before the memoized handler reads it, so
                      // the inbox selection (or null) would otherwise win.
                      handleSendMessage(
                        text,
                        attachment,
                        channel,
                        mentions,
                        reminder,
                        replyTo,
                        conv.id
                      )
                    }
                    onSendTemplateNow={handleSendTemplateNow}
                    onScheduleMessage={handleScheduleMessage}
                    onCancelScheduledMessage={handleCancelScheduledMessage}
                    onUpdateStage={handleUpdateStage}
                    onClearReminder={handleClearReminder}
                    onSetReminder={handleSetReminder}
                    onToggleFavorite={handleToggleFavorite}
                    onSetBotStatus={handleSetBotStatus}
                    // The preview has its own "Cargando contacto…" state; this
                    // flag tracks the INBOX's background hydration (hydratingId
                    // vs activeId), so it would show a spurious "Cargando
                    // historial…" pill over the preview. Keep it off here.
                    isLoadingHistory={false}
                    onPinMessage={handlePinMessage}
                    onUnpinMessage={handleUnpinMessage}
                    hasOlderMessages={Boolean(conv.messagesHasMore)}
                    isLoadingOlderMessages={loadingOlderFor === conv.id}
                    onLoadOlderMessages={handleLoadOlderMessages}
                    onDeleteLead={() => {
                      handleDeleteLead(conv.id);
                      setOpportunityChatContactId(null);
                    }}
                  />
                </div>
                {/* Right rail — same ContactSidebar instance as the
                    inbox view (Etiquetas / Información de Contacto /
                    Asignación / Documentos / Familiares). Wired with
                    the same handlers so every edit round-trips through
                    GHL identically to the inbox flow. Hidden below
                    `lg` to keep the modal usable on smaller laptops;
                    on small screens the agent works with the chat
                    panel only and uses the inbox view for contact
                    edits. */}
                <div className="hidden lg:flex w-80 xl:w-96 h-full shrink-0 border-l">
                  <div className="w-full h-full">
                    <ContactSidebar
                      contact={conv.participant}
                      conversation={conv}
                      onUpdateContactName={(newName) =>
                        handleUpdateContactName(conv.participant.id, newName)
                      }
                      users={users}
                      availableTags={availableTags}
                      onUpdateTags={(tags) =>
                        handleUpdateContactTags(conv.participant.id, tags)
                      }
                      onUpdateContactFields={(patch) =>
                        handleUpdateContactFields(conv.participant.id, patch)
                      }
                      opportunity={opportunities.find(
                        (o) => o.contactId === conv.participant.id
                      )}
                      onUpdateOpportunity={handleUpdateOpportunity}
                      onCreateOpportunity={(patch) =>
                        handleCreateOpportunityForContact(
                          conv.participant.id,
                          conv.participant.name,
                          patch
                        )
                      }
                      onUpdateAssignedTo={(userId) =>
                        handleUpdateAssignment(conv.participant.id, {
                          assignedTo: userId,
                        })
                      }
                      onUpdateFollowers={(ids) =>
                        handleUpdateAssignment(conv.participant.id, {
                          followers: ids,
                        })
                      }
                    />
                  </div>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
