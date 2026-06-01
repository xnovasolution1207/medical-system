import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import {
  DEFAULT_TAB,
  pathToNav,
  tabToPath,
  viewIdToPath,
} from "@/lib/chattingRoutes";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { TaskList } from "@/components/chat/TaskList";
import { ChatMessageArea } from "@/components/chat/ChatMessageArea";
import { ContactSidebar } from "@/components/chat/ContactSidebar";
import { MainSidebar } from "@/components/chat/MainSidebar";
import { OpportunitiesView } from "@/components/chat/OpportunitiesView";
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
  "lead nuevo": "bg-sky-500",
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
    .trim()
    .toLowerCase();
}

function applyStageColorOverrides<T extends { label: string; color: string }>(
  list: T[]
): T[] {
  return list.map((s) => {
    const override =
      STAGE_COLOR_OVERRIDES[normaliseStageLabel(s.label)] ??
      // Also try the accented form so "no asistió" (with accent) matches
      // the canonical "no asistio" entry without losing the accented copy.
      STAGE_COLOR_OVERRIDES[s.label.trim().toLowerCase()];
    return override ? { ...s, color: override } : s;
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
  const { tab: activeMainTab, viewId: activeViewId } = useMemo(
    () => pathToNav(location.pathname),
    [location.pathname]
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
  const totalUnread = unreadCountData?.total ?? 0;
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
      const result = await api.conversations.list({
        assignedTo: myUserId,
        limit: 100,
      });
      return { count: result.conversations.length };
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
            if (idx === -1) {
              return {
                ...prev,
                conversations: [bundle.conversation!, ...prev.conversations],
              };
            }
            const next = prev.conversations.slice();
            // Replace the conversation outright so the modal sees the
            // fresh GHL data, not whatever stale messages were in the
            // bootstrap window or the chat-window cache. Preserve a
            // couple of local-only bits (per-conv stage override,
            // scheduled messages) that the bundle endpoint doesn't
            // carry because they're flagsStore-derived.
            next[idx] = {
              ...bundle.conversation!,
              stage: prev.conversations[idx].stage ?? bundle.conversation!.stage,
              scheduledMessages:
                prev.conversations[idx].scheduledMessages ??
                bundle.conversation!.scheduledMessages,
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

  // Wraps `setActiveId` so that picking a row in the mobile lead-list drawer
  // also dismisses the drawer — otherwise the user has to tap outside the
  // sheet after every selection.
  const handleSelectConversationMobile = useCallback((id: string) => {
    setActiveId(id);
    setIsChatListSheetOpen(false);
  }, []);

  const [isLoadingMoreConversations, setIsLoadingMoreConversations] = useState(false);
  const [loadingOlderFor, setLoadingOlderFor] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Conversation[] | null>(null);
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

  // Auto-select the first conversation once the bootstrap arrives (only when
  // the user hasn't already picked one).
  useEffect(() => {
    if (data && activeId === null && data.conversations.length > 0) {
      setActiveId(data.conversations[0].id);
    }
  }, [data, activeId]);

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
            conversations: moveConversationToFront(prev.conversations, c.id, {
              messages: nextMessages,
              lastMessage: event.message.text || c.lastMessage,
              timestamp: event.message.timestamp || c.timestamp,
              unreadCount: nextUnreadCount,
            }),
          };
        });
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
          next[idx] = event.opportunity;
          return { ...prev, opportunities: next };
        });
      } else if (event.type === "task.created") {
        updateBootstrap((prev) => {
          // Already present by id — POST .then probably ran first. No-op.
          if (prev.tasks.some((t) => t.id === event.task.id)) return prev;

          // Otherwise look for an optimistic row from `handleAddTask` that's
          // still carrying its temp id. Without this branch the WS broadcast
          // races ahead of the POST response: the optimistic stays in state,
          // the WS event appends a second row with the real id, and then the
          // POST .then maps the optimistic into a *third* row with the same
          // real id — two visible duplicates that React can't key.
          const optimisticIdx = prev.tasks.findIndex(
            (t) =>
              t.id.startsWith("t-tmp-") &&
              t.conversationId === event.task.conversationId &&
              t.title === event.task.title
          );
          if (optimisticIdx !== -1) {
            const next = prev.tasks.slice();
            next[optimisticIdx] = event.task;
            return { ...prev, tasks: next };
          }

          return { ...prev, tasks: [event.task, ...prev.tasks] };
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
              const hasNewActivity = mergedMessages.length > existing.messages.length;
              const merged: Conversation = {
                ...inc,
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

          // 3. Upsert tasks (add new, update existing, never remove).
          //
          // Before the upsert, drop any still-pending optimistic rows
          // (`t-tmp-…` ids inserted by handleAddTask) that the incoming
          // payload is about to provide with a real GHL id. Without
          // this, creating a task races: the SPA's POST .then or the
          // direct `task.created` WS event reconciles the optimistic
          // → real row, but GHL also fires its own `TaskCreate`
          // webhook which bounces back through here as a fresh
          // lead.updated. By that point the optimistic may still be in
          // state (if lead.updated arrives before .then), and a naive
          // upsert-by-id would leave both rows visible as duplicates.
          const incomingMatchKeys = new Set<string>();
          for (const t of event.lead.tasks) {
            incomingMatchKeys.add(`${t.conversationId}|${t.title}`);
          }
          const dedupedPrev = prev.tasks.filter(
            (t) =>
              !t.id.startsWith("t-tmp-") ||
              !incomingMatchKeys.has(`${t.conversationId}|${t.title}`)
          );
          const taskMap = new Map(dedupedPrev.map((t) => [t.id, t]));
          for (const t of event.lead.tasks) taskMap.set(t.id, t);

          return { ...prev, conversations, tasks: Array.from(taskMap.values()) };
        });
      }
    });
    return () => sub.close();
  }, [updateBootstrap]);

  // ---- Lazy-hydrate full message list when a conversation is selected ----
  useEffect(() => {
    if (!activeId) return;
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
        updateBootstrap((prev) => {
          const idx = prev.conversations.findIndex((c) => c.id === full.id);
          if (idx === -1) return { ...prev, conversations: [full, ...prev.conversations] };
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
  }, [activeId, updateBootstrap]);

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
    if (!q && !hasServerParam) {
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
          limit: 25,
          ...(q ? { query: q } : {}),
          ...(assignedFilterActive && myUserId
            ? { assignedTo: myUserId }
            : {}),
          ...(followedFilterActive && myUserId
            ? { followers: myUserId }
            : {}),
          ...(unreadFilterActive ? { status: "unread" } : {}),
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
    myUserId,
  ]);

  // Active iff the search effect is actually fetching: a text query, or at
  // least one *valued* filter condition that translates to a GHL param.
  // Half-built filter rows (no value yet, or only client-side fields like
  // embudo / ans) leave the local cache visible — the alternative was a
  // blank list while the user was still picking a value, which the previous
  // implementation suffered from.
  const isSearchActive =
    searchQuery.trim().length > 0 || advancedFilterServerInfo.hasServerParam;

  // Fetch the first GHL-wide unread page whenever the No leídos tab
  // activates. Combined with the active sidebar tab — clicking
  // "No leídos" while on "Asignados a mí" fetches with both
  // assignedTo and status=unread so the list narrows to "unread AND
  // assigned to me". Re-runs on `lead.updated` (via `totalUnread`)
  // and on tab toggles so it stays current.
  useEffect(() => {
    if (!unreadFilterActive) {
      setUnreadResults(null);
      setUnreadNextCursor(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const result = await api.conversations.list({
          status: "unread",
          assignedTo: assignedFilterActive ? myUserId : undefined,
          followers: followedFilterActive ? myUserId : undefined,
          limit: 25,
        });
        if (!cancelled) {
          setUnreadResults(result.conversations);
          setUnreadNextCursor(result.nextCursor);
        }
      } catch (err) {
        if (!cancelled) {
          console.warn("[unread] fetch failed", err);
          setUnreadResults([]);
          setUnreadNextCursor(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    unreadFilterActive,
    assignedFilterActive,
    followedFilterActive,
    myUserId,
    totalUnread,
  ]);

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
  }, [assignedFilterActive, myUserId, totalUnread]);

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
  }, [followedFilterActive, myUserId, totalUnread]);

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
  const displayConversationsBase = archivedFilterActive
    ? conversations.filter((c) => c.isArchived)
    : isSearchActive
      ? searchResults ?? []
      : unreadFilterActive
        ? unreadResults ?? conversations.filter((c) => (c.unreadCount ?? 0) > 0)
        : assignedFilterActive
          ? assignedResults ?? []
          : followedFilterActive
            ? followedResults ?? []
            : conversations;
  // Everywhere except the Archivados tab, archived rows are hidden so
  // they don't pollute the working inbox. The flag is patched
  // optimistically by handleToggleArchive, so a row vanishes the
  // moment the operator clicks "Archivar".
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
    (followedFilterActive && Boolean(myUserId) && followedResults === null) ||
    (unreadFilterActive && unreadResults === null);
  const activeConversation = conversations.find((c) => c.id === activeId);

  // ---- Handlers — all mutate the React Query cache via updateBootstrap ----
  const handleSendMessage = useCallback(
    (
      text: string,
      attachment?: Message["attachment"],
      channel: Message["channel"] = "sms",
      mentions?: string[],
      reminder?: string,
      replyTo?: Message["replyTo"]
    ) => {
      if (!activeId) return;
      if (isStubConvId(activeId)) {
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
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        isRead: true,
        attachment,
        channel,
        mentions,
        reminder,
        replyTo,
        status: "sent",
      };

      updateBootstrap((prev) => {
        const idx = prev.conversations.findIndex((c) => c.id === activeId);
        if (idx === -1) return prev;
        const c = prev.conversations[idx];
        return {
          ...prev,
          conversations: moveConversationToFront(prev.conversations, activeId, {
            messages: [...c.messages, optimistic],
            lastMessage: text || "Archivo adjunto",
            timestamp: optimistic.timestamp,
            // Agent/manager replied → the lead's chat is now considered seen.
            unreadCount: 0,
            ...(reminder ? { activeReminder: reminder } : {}),
          }),
        };
      });

      api.conversations
        .send(activeId, { text, channel, attachment, mentions, reminder, clientId: optimisticId })
        .then((sent) => {
          updateBootstrap((prev) => ({
            ...prev,
            conversations: prev.conversations.map((conv) =>
              conv.id === activeId
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
        })
        .catch((err) => {
          console.error("send failed", err);
          updateBootstrap((prev) => ({
            ...prev,
            conversations: prev.conversations.map((conv) =>
              conv.id === activeId
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
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
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
        attachment: template.attachment,
      };
      updateBootstrap((prev) => {
        const idx = prev.conversations.findIndex((c) => c.id === conversationId);
        if (idx === -1) return prev;
        const c = prev.conversations[idx];
        return {
          ...prev,
          conversations: moveConversationToFront(prev.conversations, conversationId, {
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
        // Existing opportunity → move it to the new stage.
        if (opp.stageId !== stage) {
          api.opportunities
            .move(opp.id, stage)
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
      });
      if (isSearchActive) {
        setSearchResults((prev) => {
          const base = prev ?? [];
          const existingIds = new Set(base.map((c) => c.id));
          const fresh = result.conversations.filter((c) => !existingIds.has(c.id));
          return fresh.length ? [...base, ...fresh] : base;
        });
        setSearchNextCursor(result.nextCursor);
      } else if (unreadFilterActive) {
        setUnreadResults((prev) => {
          const base = prev ?? [];
          const existingIds = new Set(base.map((c) => c.id));
          const fresh = result.conversations.filter((c) => !existingIds.has(c.id));
          return fresh.length ? [...base, ...fresh] : base;
        });
        setUnreadNextCursor(result.nextCursor);
      } else if (assignedFilterActive) {
        setAssignedResults((prev) => {
          const base = prev ?? [];
          const existingIds = new Set(base.map((c) => c.id));
          const fresh = result.conversations.filter((c) => !existingIds.has(c.id));
          return fresh.length ? [...base, ...fresh] : base;
        });
        setAssignedNextCursor(result.nextCursor);
      } else if (followedFilterActive) {
        setFollowedResults((prev) => {
          const base = prev ?? [];
          const existingIds = new Set(base.map((c) => c.id));
          const fresh = result.conversations.filter((c) => !existingIds.has(c.id));
          return fresh.length ? [...base, ...fresh] : base;
        });
        setFollowedNextCursor(result.nextCursor);
      } else {
        updateBootstrap((prev) => {
          const existingIds = new Set(prev.conversations.map((c) => c.id));
          const fresh = result.conversations.filter((c) => !existingIds.has(c.id));
          return {
            ...prev,
            conversations: fresh.length ? [...prev.conversations, ...fresh] : prev.conversations,
            conversationsNextCursor: result.nextCursor,
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
      if (isStubConvId(id)) return;
      api.conversations
        .patch(id, { markRead: true })
        .catch((err) => console.error("mark as read failed", err));
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
      const optimistic: Task = { ...task, id: optimisticId };
      updateBootstrap((prev) => ({ ...prev, tasks: [optimistic, ...prev.tasks] }));
      if (!task.conversationId) return;
      api.tasks
        .create({
          conversationId: task.conversationId,
          title: task.title,
          dueDate: task.dueDate,
          // GHL's `assignedTo` expects a user id, not a display name. Until
          // the GHL token is granted `users.readonly` (and we can pick from
          // a real roster), leave the GHL task unassigned. The local Task's
          // `assignee.name` still drives the UI label.
        })
        .then((saved) => {
          updateBootstrap((prev) => ({
            ...prev,
            tasks: prev.tasks.map((t) => (t.id === optimisticId ? saved : t)),
          }));
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
    [toast, updateBootstrap]
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
        contactId = conv?.contactId ?? conv?.participant.id;
        const next = prev.tasks.slice();
        next[idx] = { ...prevSnapshot, ...patch };
        return { ...prev, tasks: next };
      });
      if (!contactId || id.startsWith("t-tmp-")) return;
      api.tasks
        .update(contactId, id, patch)
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
          contactId = conv?.contactId ?? conv?.participant.id;
          return { ...t, status: nextStatus };
        }),
      }));
      if (contactId && !id.startsWith("t-tmp-")) {
        api.tasks
          .setCompleted(contactId, id, nextStatus === "completed")
          .catch((err) => console.error("toggle task failed", err));
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
      updateBootstrap((prev) => ({
        ...prev,
        opportunities: prev.opportunities.map((o) => (o.id === id ? { ...o, stageId } : o)),
      }));
      api.opportunities
        .move(id, stageId)
        .catch((err) => console.error("opportunity move failed", err));
    },
    [updateBootstrap]
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
    // If the row being deleted is currently open, navigate away from it.
    setActiveId((current) => (current && current === (target?.id ?? null) ? null : current));
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
  }, [activeConversation, queryClient, updateBootstrap, toast]);

  const setStages = useCallback(
    (next: BootstrapPayload["stages"]) => {
      updateBootstrap((prev) => ({ ...prev, stages: next }));
    },
    [updateBootstrap]
  );

  const opportunitiesPipeline = pipelines[0];

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background text-muted-foreground">
        Cargando datos de GoHighLevel…
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
              activeViewId={activeViewId}
              savedViews={savedViews}
              onSaveView={handleSaveView}
              stages={stages}
              activeTab={activeMainTab}
              onLoadMore={handleLoadMoreConversations}
              hasMore={
                (unreadFilterActive
                  ? unreadNextCursor
                  : assignedFilterActive
                    ? assignedNextCursor
                    : followedFilterActive
                      ? followedNextCursor
                      : isSearchActive
                        ? searchNextCursor
                        : conversationsNextCursor) !== null
              }
              isLoadingMore={isLoadingMoreConversations}
              isLoadingList={isLoadingConversationList}
              searchValue={searchQuery}
              onSearchChange={setSearchQuery}
              isSearching={isSearching}
              onOpenMobileNav={() => {
                setIsChatListSheetOpen(false);
                setIsMobileNavOpen(true);
              }}
              onCreateContact={handleCreateContact}
              onCreateOpportunity={handleCreateOpportunity}
              pipelineId={opportunitiesPipeline?.id}
              users={users}
              advancedFilters={advancedFilters}
              advancedLogic={advancedLogic}
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
              onSelectConversation={setActiveId}
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
              onSelectConversation={setActiveId}
              onToggleFavorite={handleToggleFavorite}
              onArchiveConversation={handleToggleArchive}
              onMarkAsRead={handleMarkAsRead}
              activeViewId={activeViewId}
              savedViews={savedViews}
              onSaveView={handleSaveView}
              stages={stages}
              activeTab={activeMainTab}
              onLoadMore={handleLoadMoreConversations}
              hasMore={
                (unreadFilterActive
                  ? unreadNextCursor
                  : assignedFilterActive
                    ? assignedNextCursor
                    : followedFilterActive
                      ? followedNextCursor
                      : isSearchActive
                        ? searchNextCursor
                        : conversationsNextCursor) !== null
              }
              isLoadingMore={isLoadingMoreConversations}
              isLoadingList={isLoadingConversationList}
              searchValue={searchQuery}
              onSearchChange={setSearchQuery}
              isSearching={isSearching}
              onOpenMobileNav={() => setIsMobileNavOpen(true)}
              onCreateContact={handleCreateContact}
              onCreateOpportunity={handleCreateOpportunity}
              pipelineId={opportunitiesPipeline?.id}
              users={users}
              advancedFilters={advancedFilters}
              advancedLogic={advancedLogic}
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
            opportunities={opportunities}
            pipeline={opportunitiesPipeline}
            conversations={conversations}
            tasks={tasks}
            users={users}
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
              onSetBotStatus={handleSetBotStatus}
              isLoadingHistory={hydratingId === activeId}
              onPinMessage={handlePinMessage}
              onUnpinMessage={handleUnpinMessage}
              onOpenMobileNav={() => setIsMobileNavOpen(true)}
              onOpenChatList={() => setIsChatListSheetOpen(true)}
            />
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
                    onSendMessage={(text, attachment, channel, mentions, reminder, replyTo) => {
                      // Temporarily route through the same handler — it
                      // expects the active conversation, so flip activeId
                      // for this send only. The optimistic insert lands
                      // against conv.id; we restore activeId on the next
                      // tick so the sidebar selection isn't disturbed.
                      const previous = activeId;
                      setActiveId(conv.id);
                      handleSendMessage(text, attachment, channel, mentions, reminder, replyTo);
                      setTimeout(() => setActiveId(previous), 0);
                    }}
                    onScheduleMessage={handleScheduleMessage}
                    onCancelScheduledMessage={handleCancelScheduledMessage}
                    onUpdateStage={handleUpdateStage}
                    onClearReminder={handleClearReminder}
                    onSetReminder={handleSetReminder}
                    onToggleFavorite={handleToggleFavorite}
                    onSetBotStatus={handleSetBotStatus}
              isLoadingHistory={hydratingId === activeId}
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
