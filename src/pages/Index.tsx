import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { TaskList } from "@/components/chat/TaskList";
import { ChatMessageArea } from "@/components/chat/ChatMessageArea";
import { ContactSidebar } from "@/components/chat/ContactSidebar";
import { MainSidebar } from "@/components/chat/MainSidebar";
import { OpportunitiesView } from "@/components/chat/OpportunitiesView";
import {
  Message,
  Conversation,
  SavedView,
  Task,
  User,
} from "@/components/chat/types";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { api, BootstrapPayload } from "@/lib/api";
import { subscribe } from "@/lib/socket";
import { useToast } from "@/hooks/use-toast";

const INITIAL_SAVED_VIEWS: SavedView[] = [
  { id: "v1", name: "Meta", filters: [], logic: "AND" },
  { id: "v2", name: "Tik Tok", filters: [], logic: "AND" },
  { id: "v3", name: "Google", filters: [], logic: "AND" },
  { id: "v4", name: "Caliente", filters: [], logic: "AND" },
  { id: "v5", name: "Seguimiento", filters: [], logic: "AND" },
];

const FALLBACK_USER: User = { id: "agent", name: "Agente de Ventas", status: "online" };

// Single React Query key holding the full app payload. WS events mutate the
// cache via setQueryData; the query itself never refetches on its own (the
// backend is webhook-driven, so the WS stream is the only update channel).
const BOOTSTRAP_QUERY_KEY = ["bootstrap"] as const;

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
  const pipelines = data?.pipelines ?? [];
  const stages = data?.stages ?? [];
  const currentUser = data?.currentUser ?? FALLBACK_USER;
  const conversationsNextCursor = data?.conversationsNextCursor ?? null;

  // Local UI state — not part of the bootstrap payload because it's purely
  // client-side: which conversation/tab is open, search input, etc.
  const [savedViews, setSavedViews] = useState<SavedView[]>(INITIAL_SAVED_VIEWS);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [activeMainTab, setActiveMainTab] = useState("todos");
  const [taskUserFilters, setTaskUserFilters] = useState<string[]>([]);
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

  const handleToggleContactSidebar = useCallback(() => {
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches) {
      setIsContactSidebarOpen((prev) => !prev);
    } else {
      setIsContactSheetOpen(true);
    }
  }, []);

  const handleSelectMainTab = useCallback((id: string) => {
    setActiveMainTab(id);
    setIsMobileNavOpen(false);
  }, []);

  const handleSelectViewMobile = useCallback((id: string | null) => {
    setActiveViewId(id);
    setIsMobileNavOpen(false);
  }, []);

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
  const [searchNextCursor, setSearchNextCursor] = useState<number | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const hydratedConversations = useRef<Set<string>>(new Set());
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
              // Preserve the richer local message list; append only genuinely
              // new messages from GHL (identified by id not yet in cache).
              const existingIds = new Set(existing.messages.map((m) => m.id));
              const freshMsgs = inc.messages.filter((m) => !existingIds.has(m.id));
              const merged: Conversation = {
                ...inc,
                messages: freshMsgs.length
                  ? [...existing.messages, ...freshMsgs]
                  : existing.messages,
                scheduledMessages:
                  existing.scheduledMessages ?? inc.scheduledMessages,
              };
              conversations = moveConversationToFront(conversations, inc.id, merged);
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
          const taskMap = new Map(prev.tasks.map((t) => [t.id, t]));
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
      })
      .catch((err) => console.error("conversation fetch failed", err));
  }, [activeId, updateBootstrap]);

  // ---- Server-side search (debounced) ----
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults(null);
      setSearchNextCursor(null);
      setIsSearching(false);
      return;
    }
    let cancelled = false;
    setIsSearching(true);
    const handle = window.setTimeout(() => {
      api.conversations
        .list({ limit: 25, query: q })
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
  }, [searchQuery]);

  const isSearchActive = searchQuery.trim().length > 0;
  const displayConversations = isSearchActive ? searchResults ?? [] : conversations;
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
          toast({
            title: "No se pudo enviar el mensaje",
            description: String(err),
            variant: "destructive",
          });
        });
    },
    [activeId, currentUser.id, toast, updateBootstrap]
  );

  const handleScheduleMessage = useCallback(
    (conversationId: string, text: string, date: string, channel: Message["channel"]) => {
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
                  { id: optimisticId, text, scheduledFor: date, channel: localChannel },
                ],
              }
            : c
        ),
      }));
      api.conversations
        .schedule(conversationId, { text, scheduledFor: date, channel: localChannel })
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
    const cursor = q ? searchNextCursor : conversationsNextCursor;
    if (!cursor || isLoadingMoreConversationsRef.current) return;
    isLoadingMoreConversationsRef.current = true;
    setIsLoadingMoreConversations(true);
    try {
      const result = await api.conversations.list({
        limit: 25,
        startAfterDate: cursor,
        query: q || undefined,
      });
      if (q) {
        setSearchResults((prev) => {
          const base = prev ?? [];
          const existingIds = new Set(base.map((c) => c.id));
          const fresh = result.conversations.filter((c) => !existingIds.has(c.id));
          return fresh.length ? [...base, ...fresh] : base;
        });
        setSearchNextCursor(result.nextCursor);
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
  }, [conversationsNextCursor, searchNextCursor, searchQuery, updateBootstrap]);

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

  const handleSaveView = useCallback((view: SavedView) => {
    setSavedViews((prev) => {
      const exists = prev.find((v) => v.id === view.id);
      return exists ? prev.map((v) => (v.id === view.id ? view : v)) : [...prev, view];
    });
    setActiveViewId(view.id);
  }, []);

  const handleDeleteView = useCallback((id: string) => {
    setSavedViews((prev) => prev.filter((v) => v.id !== id));
    setActiveViewId((current) => (current === id ? null : current));
  }, []);

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
          onDeleteView={handleDeleteView}
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
            onDeleteView={handleDeleteView}
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
              conversations={displayConversations}
              tasks={tasks}
              activeConversationId={activeId || ""}
              onSelectConversation={handleSelectConversationMobile}
              onToggleFavorite={handleToggleFavorite}
              activeViewId={activeViewId}
              savedViews={savedViews}
              onSaveView={handleSaveView}
              stages={stages}
              activeTab={activeMainTab}
              onLoadMore={handleLoadMoreConversations}
              hasMore={(isSearchActive ? searchNextCursor : conversationsNextCursor) !== null}
              isLoadingMore={isLoadingMoreConversations}
              searchValue={searchQuery}
              onSearchChange={setSearchQuery}
              isSearching={isSearching}
              onOpenMobileNav={() => {
                setIsChatListSheetOpen(false);
                setIsMobileNavOpen(true);
              }}
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
              conversations={displayConversations}
              tasks={tasks}
              activeConversationId={activeId || ""}
              onSelectConversation={setActiveId}
              onToggleFavorite={handleToggleFavorite}
              activeViewId={activeViewId}
              savedViews={savedViews}
              onSaveView={handleSaveView}
              stages={stages}
              activeTab={activeMainTab}
              onLoadMore={handleLoadMoreConversations}
              hasMore={(isSearchActive ? searchNextCursor : conversationsNextCursor) !== null}
              isLoadingMore={isLoadingMoreConversations}
              searchValue={searchQuery}
              onSearchChange={setSearchQuery}
              isSearching={isSearching}
              onOpenMobileNav={() => setIsMobileNavOpen(true)}
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
            onMoveOpportunity={handleMoveOpportunity}
            onCreateOpportunity={handleCreateOpportunity}
            onOpenMobileNav={() => setIsMobileNavOpen(true)}
          />
        </div>
      ) : (
        <div className={`flex-1 h-full min-w-0 ${!activeId ? "hidden md:flex" : "flex"}`}>
          {activeConversation ? (
            <ChatMessageArea
              key={activeConversation.id}
              conversation={activeConversation}
              currentUser={currentUser}
              tasks={tasks}
              stages={stages}
              setStages={setStages}
              onAddTask={handleAddTask}
              onToggleTask={handleToggleTask}
              onSendMessage={handleSendMessage}
              onScheduleMessage={handleScheduleMessage}
              onCancelScheduledMessage={handleCancelScheduledMessage}
              onBack={() => setActiveId(null)}
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
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
