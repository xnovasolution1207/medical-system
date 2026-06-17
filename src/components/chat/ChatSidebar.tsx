import React, { useState, useCallback, useEffect } from "react";
import { api } from "@/lib/api";
import { ChannelAvatar } from "./ChannelAvatar";
import { Search, Plus, MoreHorizontal, Filter, Calendar, ListFilter, Save, X, Star, Archive, CheckCheck, Mail, Trash2, Bell, AtSign, StickyNote, CheckSquare, LayoutList, List, AlignJustify, Loader2, Menu, CornerDownLeft, Clock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AgentUser, Conversation, TagSummary } from "./types";
import { cn } from "@/lib/utils";
import { TAB_LIST_CLASS, TAB_TRIGGER_CLASS } from "@/lib/tabStyles";
import { stageBadgeClasses } from "@/lib/stageColors";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FilterBuilder } from "./FilterBuilder";
import { AddContactDialog } from "./AddContactDialog";
import { FilterCondition, SavedView } from "./types";
import { UserPlus, Users } from "lucide-react";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { format } from "date-fns";
import { es } from "date-fns/locale";
interface ChatSidebarProps {
  conversations: Conversation[];
  tasks?: import("./types").Task[];
  activeConversationId: string;
  onSelectConversation: (id: string) => void;
  onToggleFavorite?: (id: string) => void;
  // Toggle the conversation's local archive flag. Index.tsx hides
  // archived rows from every inbox view and surfaces an Undo toast,
  // so the row vanishes the instant this callback fires.
  onArchiveConversation?: (id: string) => void;
  // "Marcar como leído" — clears the conversation's unread badge.
  onMarkAsRead?: (id: string) => void;
  onMarkAsUnread?: (id: string) => void;
  savedViews?: SavedView[];
  activeViewId?: string | null;
  onSaveView?: (view: SavedView) => void;
  stages?: { id: string; label: string; color: string; }[];
  activeTab?: string;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  // True while the first page of the active tab's scoped result set
  // (Asignados / Seguidos / No leídos) is still in flight. Drives a
  // spinner in the empty-state so the user doesn't briefly see
  // "No hay conversaciones" before the fetch lands.
  isLoadingList?: boolean;
  // Search is controlled by the parent: typing in the input drives a
  // server-side query against the whole GHL location (not just the loaded
  // window), so name matching must live outside this component.
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  isSearching?: boolean;
  // Reports the active "Filtrar por fecha" window (epoch ms) up to Index so it
  // can fetch the WHOLE GHL location for that range with cursor pagination,
  // instead of only narrowing the locally-loaded page. null = no date filter.
  onDateRangeChange?: (range: { from: number; to: number } | null) => void;
  // May be async — the parent kicks off an HTTP delete + backfill chain.
  // We await it so the dialog stays open ("Eliminando…") until the work
  // finishes.
  onDeleteConversation?: (id: string) => void | Promise<void>;
  // Opens the MainSidebar drawer on screens below `md`. Index.tsx provides it;
  // the hamburger button below renders only when this prop is set.
  onOpenMobileNav?: () => void;
  // Persists a brand-new contact via POST /api/contacts. Resolves to the
  // created contact id (or null on failure). Index.tsx provides this so the
  // SPA can optimistically update the cache while the webhook lands.
  onCreateContact?: (payload: {
    name?: string;
    phone?: string;
    email?: string;
  }) => Promise<{ id: string } | null>;
  // Optional opportunity hook — forwarded to AddContactDialog so the
  // "Etapa de oportunidad" picker on the new-contact form can chain
  // an opportunity create after the contact is saved (mirrors the
  // Oportunidades view's Agregar contacto flow).
  onCreateOpportunity?: (payload: {
    name: string;
    contactId: string;
    pipelineId: string;
    stageId: string;
    monetaryValue?: number;
  }) => void | Promise<void>;
  // Active GHL pipeline id, required to chain an opportunity from
  // the AddContactDialog stage picker. Omit when the pipeline isn't
  // loaded yet — the picker still renders, just doesn't write.
  pipelineId?: string;
  // Agent roster from the bootstrap payload — drives the FilterBuilder's
  // user pickers (Asignado / Seguidor / Mención).
  users?: AgentUser[];
  // Location tag library — drives the FilterBuilder's "Etiqueta" value
  // dropdown (same list as the contact panel's "Etiquetas" picker).
  availableTags?: TagSummary[];
  // Advanced filter state (lifted to Index.tsx so the search/fetch
  // pipeline can forward translatable conditions to GHL). Pass-through
  // for FilterBuilder.
  advancedFilters?: FilterCondition[];
  advancedLogic?: "AND" | "OR";
  onAdvancedFiltersChange?: (filters: FilterCondition[]) => void;
  onAdvancedLogicChange?: (logic: "AND" | "OR") => void;
  // Total count of unread conversations across the entire GHL location
  // (not just the locally-loaded page). Index.tsx queries the backend
  // and refreshes on `lead.updated` WS events. Falls back to summing
  // local `conversations` when undefined.
  totalUnread?: number;
  // Notifies the parent when the user switches between the "No leídos"
  // / "Todos" / "Recientes" / "Favoritos" tabs. Index.tsx uses this to
  // refetch from GHL with `status=unread` so the unread tab shows every
  // unread lead, not just those in the locally-loaded page.
  onFilterChange?: (filter: "all" | "unread" | "recent" | "favorites") => void;
  // Logged-in agent's GHL user id, used by the "Asignados a mí" /
  // "Seguidos por mí" sidebar tabs to narrow the list to conversations
  // assigned to / followed by the current user. Index.tsx derives this
  // by matching `currentUser.name` against the agent roster — empty
  // string when no roster is loaded (so those tabs degrade to "show
  // nothing" rather than show everything).
  myUserId?: string;
}

export function ChatSidebar({
  conversations,
  tasks = [],
  activeConversationId,
  onSelectConversation,
  onToggleFavorite,
  onArchiveConversation,
  onMarkAsRead,
  onMarkAsUnread,
  savedViews = [],
  activeViewId = null,
  onSaveView,
  stages = [],
  activeTab = "todos",
  onLoadMore,
  hasMore = false,
  isLoadingMore = false,
  isLoadingList = false,
  searchValue,
  onSearchChange,
  onDateRangeChange,
  isSearching = false,
  myUserId,
  onDeleteConversation,
  onOpenMobileNav,
  onCreateContact,
  onCreateOpportunity,
  pipelineId,
  users = [],
  availableTags = [],
  advancedFilters,
  advancedLogic,
  onAdvancedFiltersChange,
  onAdvancedLogicChange,
  totalUnread: totalUnreadFromParent,
  onFilterChange,
}: ChatSidebarProps) {
  const [filter, setFilter] = useState<"all" | "unread" | "recent" | "favorites">("all");
  // Forward any filter change so the parent can refetch from GHL when
  // the unread tab activates. Internal state stays the source of truth
  // for the in-component filter logic; the callback is purely a notice.
  useEffect(() => {
    onFilterChange?.(filter);
  }, [filter, onFilterChange]);
  // Fallback local search for standalone/test usage when the parent doesn't
  // control the search input; the parent in Index.tsx always provides it.
  const [internalSearch, setInternalSearch] = useState("");
  const search = searchValue ?? internalSearch;
  const setSearch = (value: string) => {
    if (onSearchChange) onSearchChange(value);
    else setInternalSearch(value);
  };
  const [dateFilter, setDateFilter] = useState<string>("");
  const [dateRange, setDateRange] = useState<any>();
  const [viewMode, setViewMode] = useState<"normal" | "compact" | "small">("normal");
  const [isNewConversationOpen, setIsNewConversationOpen] = useState(false);
  const [isAddContactOpen, setIsAddContactOpen] = useState(false);
  // Add-contact form state lives inside AddContactDialog now.
  // New-conversation search: lets the user pick an existing contact (by name
  // / phone / email) and navigate to their conversation. Powered by the same
  // server-side conversation-list query used by the sidebar's main search.
  const [newConvSearch, setNewConvSearch] = useState("");
  const [newConvResults, setNewConvResults] = useState<Conversation[]>([]);
  const [isSearchingNewConv, setIsSearchingNewConv] = useState(false);

  // Debounced server-side search for the Nueva conversación dialog. Skips
  // when the dialog is closed or the query is short to avoid pinging GHL on
  // every keystroke. Cancellation guards prevent stale responses from
  // overwriting newer ones when the user types quickly.
  useEffect(() => {
    if (!isNewConversationOpen) return;
    const q = newConvSearch.trim();
    if (q.length < 2) {
      setNewConvResults([]);
      setIsSearchingNewConv(false);
      return;
    }
    let cancelled = false;
    setIsSearchingNewConv(true);
    const timer = window.setTimeout(() => {
      api.conversations
        .list({ limit: 25, query: q })
        .then((result) => {
          if (cancelled) return;
          setNewConvResults(result.conversations);
        })
        .catch((err) => {
          if (cancelled) return;
          console.error("new-conversation search failed", err);
          setNewConvResults([]);
        })
        .finally(() => {
          if (!cancelled) setIsSearchingNewConv(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isNewConversationOpen, newConvSearch]);
  // Delete-confirmation state. We keep the lead's name alongside the id so
  // the dialog copy can read "Se eliminará a {name}…" without re-deriving it
  // from the conversations array at render time (the row may have already
  // been optimistically removed by the time the dialog re-renders).
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const { toast } = useToast();

  // Filter state: prefer parent (Index.tsx) when controlled — that lets the
  // server-fetch pipeline forward translatable conditions to GHL. Falls back
  // to local state when the component is rendered standalone (tests, Storybook).
  const [internalBuilderFilters, setInternalBuilderFilters] = useState<FilterCondition[]>([]);
  const [internalBuilderLogic, setInternalBuilderLogic] = useState<"AND" | "OR">("AND");
  const builderFilters = advancedFilters ?? internalBuilderFilters;
  const builderLogic = advancedLogic ?? internalBuilderLogic;
  const setBuilderFilters = (f: FilterCondition[]) => {
    if (onAdvancedFiltersChange) onAdvancedFiltersChange(f);
    else setInternalBuilderFilters(f);
  };
  const setBuilderLogic = (l: "AND" | "OR") => {
    if (onAdvancedLogicChange) onAdvancedLogicChange(l);
    else setInternalBuilderLogic(l);
  };
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      if (!hasMore || isLoadingMore || !onLoadMore) return;
      const el = e.currentTarget;
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
        onLoadMore();
      }
    },
    [hasMore, isLoadingMore, onLoadMore]
  );

  React.useEffect(() => {
    const handleOpenFilter = (e: any) => {
      setIsFilterOpen(true);
    };
    document.addEventListener('open-filter-builder', handleOpenFilter);
    return () => document.removeEventListener('open-filter-builder', handleOpenFilter);
  }, []);

  const activeView = savedViews.find(v => v.id === activeViewId);
  
  // Human-friendly labels for the active-filter chips. Conditions store
  // raw GHL ids / channel slugs / direction codes, which are inscrutable
  // when surfaced directly ("seguidor: BCZIHFSqMNAW3zx7fT2V"). The helpers
  // below resolve those values back to the names the user sees in the
  // FilterBuilder dropdowns.
  const FIELD_LABELS: Record<string, string> = {
    asignado: "Asignado",
    seguidor: "Seguidor",
    mencion: "Mención",
    direccion_ultimo_mensaje: "Dirección último mensaje",
    tipo_ultimo_mensaje_saliente: "Tipo último saliente",
    canal_ultimo_mensaje: "Canal último mensaje",
    etiqueta: "Etiqueta",
    ans: "ANS",
    embudo_actual: "Embudo",
  };
  const CHANNEL_LABELS_DICT: Record<string, string> = {
    whatsapp: "WhatsApp",
    sms: "SMS",
    email: "Email",
    instagram: "Instagram",
    messenger: "Messenger",
    tiktok: "TikTok",
  };
  const formatConditionValue = (cond: FilterCondition): string => {
    if (!cond.value) return "";
    if (
      cond.field === "asignado" ||
      cond.field === "seguidor" ||
      cond.field === "mencion"
    ) {
      const u = users.find((u) => u.id === cond.value);
      return u?.name ?? cond.value;
    }
    if (
      cond.field === "canal_ultimo_mensaje" ||
      cond.field === "tipo_ultimo_mensaje_saliente"
    ) {
      return CHANNEL_LABELS_DICT[cond.value] ?? cond.value;
    }
    if (cond.field === "direccion_ultimo_mensaje") {
      if (cond.value === "inbound") return "Entrante";
      if (cond.value === "outbound") return "Saliente";
      return cond.value;
    }
    if (cond.field === "embudo_actual") {
      return stages.find((s) => s.id === cond.value)?.label ?? cond.value;
    }
    return cond.value;
  };
  const OPERATOR_SHORT: Record<string, string> = {
    es: "es",
    no_es: "no es",
    contiene: "contiene",
    no_contiene: "no contiene",
  };

  // When the component is rendered uncontrolled (no advancedFilters prop),
  // we still need to hydrate from the active saved view. Index.tsx owns
  // this effect when controlled — see its `activeViewId` useEffect. The
  // guard avoids duplicating the patch and racing the parent's update.
  React.useEffect(() => {
    if (advancedFilters !== undefined) return;
    if (activeView) {
      setInternalBuilderFilters(activeView.filters);
      setInternalBuilderLogic(activeView.logic);
    }
  }, [activeView, advancedFilters]);

  const currentFilters = builderFilters;
  const currentLogic = builderLogic;

  // ---- "Seguidor" / "Mención" filter support ----
  // Conversation-list rows don't carry followers (and only carry hydrated
  // mentions), so client-side evaluation of these two fields — needed for the
  // `no es` / `contiene` operators that can't be expressed as a single GHL
  // query param — would silently miss. We resolve them via GHL's native
  // `followers` / `mentions` conversation search: for each distinct value in
  // the active filter set, fetch the contactIds that match, then test
  // membership in the evaluator. Covers the whole location, every operator.
  const followerFilterValues = React.useMemo(() => {
    const vals = new Set<string>();
    for (const c of currentFilters) {
      if (c.field === "seguidor" && c.value) vals.add(c.value);
    }
    return Array.from(vals);
  }, [currentFilters]);
  const mentionFilterValues = React.useMemo(() => {
    const vals = new Set<string>();
    for (const c of currentFilters) {
      if (c.field === "mencion" && c.value) vals.add(c.value);
    }
    return Array.from(vals);
  }, [currentFilters]);

  const [followerContactsByValue, setFollowerContactsByValue] = useState<
    Map<string, Set<string>>
  >(() => new Map());
  const [mentionContactsByValue, setMentionContactsByValue] = useState<
    Map<string, Set<string>>
  >(() => new Map());

  useEffect(() => {
    let cancelled = false;
    const run = async (
      values: string[],
      param: "followers" | "mentions",
      set: (m: Map<string, Set<string>>) => void
    ) => {
      if (values.length === 0) {
        set(new Map());
        return;
      }
      const entries = await Promise.all(
        values.map(async (val) => {
          try {
            const res = await api.conversations.list({ [param]: val, limit: 100 });
            const ids = new Set<string>();
            for (const c of res.conversations) {
              const cid = c.contactId ?? c.participant?.id;
              if (cid) ids.add(cid);
            }
            return [val, ids] as const;
          } catch {
            return [val, new Set<string>()] as const;
          }
        })
      );
      if (!cancelled) set(new Map(entries));
    };
    run(followerFilterValues, "followers", setFollowerContactsByValue);
    run(mentionFilterValues, "mentions", setMentionContactsByValue);
    return () => {
      cancelled = true;
    };
  }, [followerFilterValues, mentionFilterValues]);

  // Resolve the active date filter into a concrete [from, to] epoch-ms
  // window. The 6 preset labels map to fixed ranges (today / yesterday /
  // ISO-week / last ISO-week / month / last month). Anything else means the
  // user picked from the inline calendar — we trust `dateRange.from/to`
  // directly so we don't have to round-trip the formatted display string.
  // Returns null when no filter is active.
  const dateFilterRange = React.useMemo<{ from: number; to: number } | null>(() => {
    if (!dateFilter && !dateRange?.from) return null;
    const PRESETS = new Set([
      "Hoy",
      "Ayer",
      "Esta Semana",
      "Semana pasada",
      "Este mes",
      "Mes Pasado",
    ]);
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (dateFilter === "Hoy") {
      const from = startOfToday.getTime();
      const to = from + 24 * 60 * 60 * 1000;
      return { from, to };
    }
    if (dateFilter === "Ayer") {
      const to = startOfToday.getTime();
      const from = to - 24 * 60 * 60 * 1000;
      return { from, to };
    }
    if (dateFilter === "Esta Semana") {
      // Spanish-locale week starts on Monday. JS getDay(): Sun=0..Sat=6.
      const dow = startOfToday.getDay() === 0 ? 7 : startOfToday.getDay();
      const from = startOfToday.getTime() - (dow - 1) * 24 * 60 * 60 * 1000;
      const to = from + 7 * 24 * 60 * 60 * 1000;
      return { from, to };
    }
    if (dateFilter === "Semana pasada") {
      const dow = startOfToday.getDay() === 0 ? 7 : startOfToday.getDay();
      const thisMonday = startOfToday.getTime() - (dow - 1) * 24 * 60 * 60 * 1000;
      const from = thisMonday - 7 * 24 * 60 * 60 * 1000;
      const to = thisMonday;
      return { from, to };
    }
    if (dateFilter === "Este mes") {
      const from = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
      return { from, to };
    }
    if (dateFilter === "Mes Pasado") {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
      const to = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      return { from, to };
    }
    // Custom range from the inline calendar: dateFilter is the formatted
    // display string and the actual Date objects live on `dateRange`.
    if (!PRESETS.has(dateFilter) && dateRange?.from) {
      const fromDate = new Date(dateRange.from);
      const toDate = dateRange.to ? new Date(dateRange.to) : new Date(dateRange.from);
      // Inclusive day boundaries: 00:00:00 of the start day, exclusive end at
      // 24:00:00 of the end day so the chosen end-day's messages are matched.
      const from = new Date(
        fromDate.getFullYear(),
        fromDate.getMonth(),
        fromDate.getDate()
      ).getTime();
      const to = new Date(
        toDate.getFullYear(),
        toDate.getMonth(),
        toDate.getDate() + 1
      ).getTime();
      return { from, to };
    }
    return null;
  }, [dateFilter, dateRange]);

  // Report the active date window up to Index so it fetches the whole GHL
  // location for that range (with infinite scroll), not just the loaded page.
  // The local filter below stays as a same-bounds safety net.
  React.useEffect(() => {
    onDateRangeChange?.(dateFilterRange);
  }, [dateFilterRange, onDateRangeChange]);

  const filteredConversations = conversations.filter((conv) => {
    if (activeTab === "recordatorios" && !conv.activeReminder) {
      return false;
    }
    // "Asignados a mí" and "Seguidos por mí" are pre-filtered
    // server-side by Index.tsx (it fires api.conversations.list with
    // assignedTo / followers params). The `conversations` prop we
    // receive in those modes is already the correct subset, so we
    // don't re-filter here — doing so would silently drop everything
    // because the conversation-list response shape doesn't carry
    // participant.assignedTo / participant.followers (only the lead-
    // bundle endpoint does).

    // Name matching is handled server-side against the full GHL contact set —
    // don't re-filter here, or conversations whose match is on phone/email/
    // tags would get dropped by the UI.
    if (filter === "unread" && conv.unreadCount === 0) {
      return false;
    }
    if (filter === "favorites" && !conv.isFavorite) {
      return false;
    }

    // Date filter: drop conversations whose last message falls outside the
    // selected window. Conversations with no `lastMessageAt` (stub rows for
    // contacts that haven't messaged yet) are always excluded when a date
    // filter is active — there's no last-activity timestamp to compare.
    if (dateFilterRange) {
      if (!conv.lastMessageAt) return false;
      const ts = Date.parse(conv.lastMessageAt);
      if (Number.isNaN(ts)) return false;
      if (ts < dateFilterRange.from || ts >= dateFilterRange.to) return false;
    }

    // Advanced filters — each FilterCondition is evaluated independently;
    // the active logic (AND / OR) decides how their booleans are combined.
    if (currentFilters.length > 0) {
      const usersByName = new Map(
        users.map((u) => [u.name.toLowerCase(), u.id])
      );
      // For text-input asignado/seguidor/mención (when the agent roster
      // isn't loaded), we compare loosely so the user can type a name and
      // still match the underlying userId.
      const resolveUserIds = (raw: string): string[] => {
        const v = raw.trim();
        if (!v) return [];
        const exact = usersByName.get(v.toLowerCase());
        if (exact) return [exact];
        // No name match — treat the value itself as a userId (or partial).
        return [v];
      };

      const passesFilters = currentFilters.map((cond) => {
        if (!cond.value) return true;
        const v = cond.value;
        const valLower = v.toLowerCase();
        const isNegated =
          cond.operator === "no_es" || cond.operator === "no_contiene";
        const isEquality = cond.operator === "es" || cond.operator === "no_es";

        let match = false;
        switch (cond.field) {
          case "asignado": {
            const candidates = resolveUserIds(v);
            const a = conv.participant.assignedTo;
            if (!a) match = false;
            else if (isEquality) {
              match = candidates.includes(a);
            } else {
              match = candidates.some((c) =>
                a.toLowerCase().includes(c.toLowerCase())
              );
            }
            break;
          }
          case "seguidor": {
            // Authoritative: GHL's native followers search resolved this value
            // to a contactId set (covers the whole location, all operators).
            const set = followerContactsByValue.get(v);
            if (set) {
              match = set.has(conv.contactId ?? conv.participant.id);
              break;
            }
            // Fallback while the lookup is in flight (rows rarely carry it).
            const candidates = resolveUserIds(v);
            const followers = conv.participant.followers ?? [];
            if (followers.length === 0) match = false;
            else if (isEquality) {
              match = candidates.some((c) => followers.includes(c));
            } else {
              match = candidates.some((c) =>
                followers.some((f) => f.toLowerCase().includes(c.toLowerCase()))
              );
            }
            break;
          }
          case "mencion": {
            // Authoritative: GHL's native mentions search resolved this value
            // to a contactId set (covers the whole location, all operators).
            const set = mentionContactsByValue.get(v);
            if (set) {
              match = set.has(conv.contactId ?? conv.participant.id);
              break;
            }
            // Fallback while the lookup is in flight: only hydrated messages
            // carry `mentions`, so unloaded conversations are non-matching.
            const candidates = resolveUserIds(v);
            const mentioned = conv.messages.flatMap((m) => m.mentions ?? []);
            if (mentioned.length === 0) match = false;
            else if (isEquality) {
              match = candidates.some((c) => mentioned.includes(c));
            } else {
              match = candidates.some((c) =>
                mentioned.some((m) => m.toLowerCase().includes(c.toLowerCase()))
              );
            }
            break;
          }
          case "direccion_ultimo_mensaje": {
            const dir = conv.lastMessageDirection;
            match = dir === valLower;
            break;
          }
          case "tipo_ultimo_mensaje_saliente": {
            // The wire conversation only carries the channel of the
            // *last* message. Only treat it as the last outbound channel
            // when the last message direction is outbound — otherwise
            // we don't know and exclude.
            if (conv.lastMessageDirection !== "outbound") {
              match = false;
            } else {
              match = conv.source === valLower;
            }
            break;
          }
          case "canal_ultimo_mensaje":
            match = conv.source === valLower;
            break;
          case "etiqueta": {
            const tags = conv.participant.tags ?? [];
            if (isEquality) {
              match = tags.some((t) => t.toLowerCase() === valLower);
            } else {
              match = tags.some((t) => t.toLowerCase().includes(valLower));
            }
            break;
          }
          case "embudo_actual": {
            const stage = (conv.stage ?? "").toLowerCase();
            if (isEquality) {
              match = stage === valLower;
            } else {
              match = stage.includes(valLower);
            }
            break;
          }
          case "ans": {
            // ANS / SLA: no canonical mapping in the GHL data we surface.
            // Treat the value as a number-of-hours threshold and pass any
            // conversation whose last message was older than that — so the
            // filter is at least usable for "stale leads". Empty / non-
            // numeric values fall through to a no-op (passes).
            const hours = Number(v);
            if (!Number.isFinite(hours) || !conv.lastMessageAt) {
              match = true;
              break;
            }
            const ageMs = Date.now() - Date.parse(conv.lastMessageAt);
            const aged = ageMs >= hours * 60 * 60 * 1000;
            // For ANS, "es N horas" means "stale ≥ N h"; "no es" means fresher.
            match = aged;
            break;
          }
          default:
            match = true;
        }

        return isNegated ? !match : match;
      });

      if (currentLogic === "AND") {
        if (!passesFilters.every(Boolean)) return false;
      } else {
        if (!passesFilters.some(Boolean)) return false;
      }
    }

    return true;
  });

  const handleSaveView = (name: string, viewId?: string) => {
    if (onSaveView) {
      onSaveView({
        id: viewId || Math.random().toString(36).substr(2, 9),
        name,
        filters: builderFilters,
        logic: builderLogic
      });
      setIsFilterOpen(false);
      toast({
        title: viewId ? "Vista actualizada" : "Vista guardada",
        description: viewId ? `La vista "${name}" ha sido actualizada exitosamente.` : `La vista "${name}" ha sido guardada exitosamente.`,
      });
    }
  };

  const hasActiveFilters = currentFilters.length > 0 || dateFilter !== "";
  // Prefer the GHL-wide count from the parent — sums of locally-loaded
  // conversations only count what's been hydrated. Fallback keeps the
  // component usable in standalone tests where Index.tsx isn't wrapping it.
  const totalUnread =
    totalUnreadFromParent ??
    conversations.reduce((acc, curr) => acc + (curr.unreadCount || 0), 0);

  const clearFilters = () => {
    setBuilderFilters([]);
    setDateFilter("");
    setDateRange(undefined);
  };

  return (
    <div className="flex h-full w-full flex-col border-r bg-card text-card-foreground md:w-72 lg:w-80 xl:w-[350px]">
      {/* Sidebar Header */}
      <div className="flex h-[68px] items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          {onOpenMobileNav && (
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden h-8 w-8 rounded-full shrink-0"
              onClick={onOpenMobileNav}
              aria-label="Abrir navegación"
            >
              <Menu className="h-5 w-5" />
            </Button>
          )}
          <h2 className="text-lg font-bold tracking-tight truncate">Conversaciones</h2>
        </div>
        <div className="flex gap-1 shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full">
                <Plus className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem className="cursor-pointer" onClick={() => setIsNewConversationOpen(true)}>
                Nueva conversación
              </DropdownMenuItem>
              <DropdownMenuItem className="cursor-pointer" onClick={() => setIsAddContactOpen(true)}>
                Agregar contacto
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {/* Comprehensive Agregar contacto modal — shared with the
              Oportunidades view so a contact created from either
              surface captures the same fields (name/phone/email +
              address/birthdate/document + family links + optional
              opportunity stage). */}
          <AddContactDialog
            open={isAddContactOpen}
            onOpenChange={setIsAddContactOpen}
            onCreateContact={onCreateContact}
            onCreateOpportunity={onCreateOpportunity}
            pipelineId={pipelineId}
            stages={stages}
          />
          <Dialog
            open={isNewConversationOpen}
            onOpenChange={(open) => {
              setIsNewConversationOpen(open);
              if (!open) {
                setNewConvSearch("");
                setNewConvResults([]);
              }
            }}
          >
            <DialogContent className="sm:max-w-[480px] rounded-[24px] p-6 border-none shadow-2xl bg-white dark:bg-slate-950">
              <DialogHeader className="mb-4">
                <DialogTitle className="text-xl font-semibold text-slate-900 dark:text-white">
                  Nueva conversación
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    autoFocus
                    placeholder="Buscar contacto por nombre, teléfono o email…"
                    value={newConvSearch}
                    onChange={(e) => setNewConvSearch(e.target.value)}
                    className="h-10 pl-9 pr-9 bg-muted/40"
                  />
                  {isSearchingNewConv && (
                    <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                </div>
                <div className="max-h-[360px] overflow-y-auto -mx-1 px-1">
                  {newConvSearch.trim().length < 2 ? (
                    <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                      Escribe al menos 2 caracteres para buscar.
                    </p>
                  ) : !isSearchingNewConv && newConvResults.length === 0 ? (
                    <div className="px-2 py-8 text-center text-sm text-muted-foreground space-y-3">
                      <p>No se encontraron conversaciones.</p>
                      {onCreateContact && (
                        <button
                          type="button"
                          className="text-primary hover:underline"
                          onClick={() => {
                            setIsNewConversationOpen(false);
                            // Pre-fill the add-contact form with whatever the
                            // user typed so they don't have to re-type the name.
                            setContactName(newConvSearch.trim());
                            setIsAddContactOpen(true);
                          }}
                        >
                          Agregar &quot;{newConvSearch.trim()}&quot; como nuevo contacto
                        </button>
                      )}
                    </div>
                  ) : (
                    <ul className="space-y-1">
                      {newConvResults.map((conv) => (
                        <li key={conv.id}>
                          <button
                            type="button"
                            className="w-full flex items-center gap-3 rounded-xl border border-transparent hover:border-border/60 hover:bg-muted/40 transition-colors p-2.5 text-left"
                            onClick={() => {
                              onSelectConversation(conv.id);
                              setIsNewConversationOpen(false);
                              setNewConvSearch("");
                              setNewConvResults([]);
                            }}
                          >
                            <ChannelAvatar
                              name={conv.participant.name}
                              src={conv.participant.avatar}
                              channel={conv.source}
                              className="h-10 w-10 shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm truncate">
                                {conv.participant.name}
                              </div>
                              <div className="text-xs text-muted-foreground truncate">
                                {conv.participant.phone || conv.participant.email || conv.recipientNumber || conv.source}
                              </div>
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </DialogContent>
          </Dialog>
          <Popover open={isFilterOpen} onOpenChange={setIsFilterOpen}>
            <PopoverTrigger asChild>
              <Button variant={currentFilters.length > 0 ? "secondary" : "ghost"} size="icon" className="h-8 w-8 rounded-full relative">
                <ListFilter className="h-4 w-4" />
                {currentFilters.length > 0 && (
                  <span className="absolute top-0 right-0 h-2 w-2 rounded-full bg-primary" />
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent 
              align="end" 
              className="w-auto p-0 border-none bg-transparent shadow-none" 
              sideOffset={8}
              onInteractOutside={(e) => {
                const target = e.target as HTMLElement;
                if (target.closest('button')) {
                  e.preventDefault();
                }
              }}
              onFocusOutside={(e) => {
                e.preventDefault();
              }}
            >
              <FilterBuilder
                filters={currentFilters}
                logic={currentLogic}
                onFiltersChange={setBuilderFilters}
                onLogicChange={setBuilderLogic}
                onClose={() => setIsFilterOpen(false)}
                onClear={() => setBuilderFilters([])}
                onSaveView={handleSaveView}
                stages={stages}
                activeViewId={activeViewId}
                initialViewName={activeView?.name}
                users={users}
                availableTags={availableTags}
              />
            </PopoverContent>
          </Popover>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant={dateFilter !== "" ? "secondary" : "ghost"} size="icon" className="h-8 w-8 rounded-full relative">
                <MoreHorizontal className="h-4 w-4" />
                {dateFilter !== "" && (
                  <span className="absolute top-0 right-0 h-2 w-2 rounded-full bg-primary" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Filtrar por fecha</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup value={dateFilter} onValueChange={setDateFilter}>
                <DropdownMenuRadioItem value="Hoy">Hoy</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="Ayer">Ayer</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="Esta Semana">Esta Semana</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="Semana pasada">Semana pasada</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="Este mes">Este mes</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="Mes Pasado">Mes Pasado</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  <span className="whitespace-nowrap">Fecha personalizada</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="p-0 border-none rounded-xl shadow-xl">
                  <CalendarComponent
                    mode="range"
                    selected={dateRange}
                    onSelect={(range: any) => {
                      setDateRange(range);
                      if (range?.from) {
                        if (range.to) {
                          setDateFilter(`${format(range.from, "dd MMM", { locale: es })} - ${format(range.to, "dd MMM, yyyy", { locale: es })}`);
                        } else {
                          setDateFilter(format(range.from, "dd MMM, yyyy", { locale: es }));
                        }
                      } else {
                        setDateFilter("");
                      }
                    }}
                    initialFocus
                    className="bg-card rounded-xl border"
                  />
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-4 pt-3">
        <Tabs defaultValue="all" onValueChange={(v) => setFilter(v as any)} className="w-full">
          <TabsList className={cn(TAB_LIST_CLASS, "items-center justify-center text-muted-foreground w-full flex")}>
            <TabsTrigger value="unread" className={cn(TAB_TRIGGER_CLASS, "flex-1 text-[11px] flex items-center justify-center gap-1.5")}>
              No leídos
              {totalUnread > 0 && (
                <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary/10 px-1.5 text-[10px] font-bold text-primary">
                  {totalUnread}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="all" className={cn(TAB_TRIGGER_CLASS, "flex-1 text-[11px]")}>Todos</TabsTrigger>
            <TabsTrigger value="recent" className={cn(TAB_TRIGGER_CLASS, "flex-1 text-[11px]")}>Recientes</TabsTrigger>
            <TabsTrigger value="favorites" className={cn(TAB_TRIGGER_CLASS, "w-10 shrink-0 text-[11px] flex items-center justify-center")} title="Favoritos">
              <Star className="h-4 w-4" />
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Search Bar */}
      <div className="p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Buscar..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-muted pl-9 pr-9 shadow-none focus-visible:ring-primary h-9"
            />
            {isSearching && (
              <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>
          <div className="flex items-center border rounded-md p-0.5 bg-muted/30 shrink-0">
            <Button variant={viewMode === "normal" ? "secondary" : "ghost"} size="icon" className="h-8 w-8 rounded-sm" onClick={() => setViewMode("normal")} title="Vista Normal">
              <LayoutList className="h-4 w-4" />
            </Button>
            <Button variant={viewMode === "compact" ? "secondary" : "ghost"} size="icon" className="h-8 w-8 rounded-sm" onClick={() => setViewMode("compact")} title="Vista Compacta">
              <List className="h-4 w-4" />
            </Button>
            <Button variant={viewMode === "small" ? "secondary" : "ghost"} size="icon" className="h-8 w-8 rounded-sm" onClick={() => setViewMode("small")} title="Vista Pequeña">
              <AlignJustify className="h-4 w-4" />
            </Button>
          </div>
        </div>
        
        {/* Active Filters & Save View */}
        {hasActiveFilters && (
          <div className="flex flex-col gap-3 rounded-xl bg-slate-50/80 dark:bg-slate-900/50 p-3.5 border border-slate-200/60 dark:border-slate-800/60">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-500 dark:text-slate-400">Filtros activos:</span>
              <button 
                onClick={clearFilters}
                className="text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
              >
                Limpiar
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {dateFilter && (
                <Badge variant="secondary" className="text-xs h-6 px-2.5 font-normal flex items-center gap-1.5 rounded-full bg-slate-200/50 dark:bg-slate-800/50 text-slate-700 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800/70 border-0">
                  {dateFilter}
                  <X className="h-3.5 w-3.5 cursor-pointer opacity-70 hover:opacity-100 transition-opacity" onClick={() => { setDateFilter(""); setDateRange(undefined); }} />
                </Badge>
              )}
              {currentFilters.map((cond) => {
                if (!cond.field || !cond.value) return null;
                const fieldLabel = FIELD_LABELS[cond.field] ?? cond.field;
                const opLabel = OPERATOR_SHORT[cond.operator] ?? cond.operator;
                const valueLabel = formatConditionValue(cond);
                return (
                  <Badge
                    key={cond.id}
                    variant="secondary"
                    className="text-xs h-6 px-2.5 font-normal flex items-center gap-1.5 rounded-full bg-slate-200/50 dark:bg-slate-800/50 text-slate-700 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800/70 border-0 max-w-[260px]"
                    title={`${fieldLabel} ${opLabel} ${valueLabel}`}
                  >
                    <span className="truncate">
                      <span className="font-medium">{fieldLabel}</span>
                      <span className="text-muted-foreground"> {opLabel} </span>
                      <span>{valueLabel}</span>
                    </span>
                    <X
                      className="h-3.5 w-3.5 cursor-pointer opacity-70 hover:opacity-100 transition-opacity shrink-0"
                      onClick={() => {
                        const newFilters = currentFilters.filter((f) => f.id !== cond.id);
                        setBuilderFilters(newFilters);
                      }}
                    />
                  </Badge>
                );
              })}
            </div>
            {!activeViewId && currentFilters.length > 0 && (
              <Button 
                variant="outline" 
                className="w-full h-9 mt-1 text-sm font-medium flex items-center justify-center gap-2 rounded-full bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm"
                onClick={() => setIsFilterOpen(true)}
              >
                <Save className="h-4 w-4" />
                Guardar vista actual
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto" onScroll={handleScroll}>
        <div className="flex flex-col gap-0.5 p-2">
          {filteredConversations.length === 0 ? (
            <div className="flex items-center justify-center gap-2 p-4 text-sm text-muted-foreground">
              {search.trim() ? (
                isSearching ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Buscando en GoHighLevel...</span>
                  </>
                ) : (
                  <span>{`Sin resultados para "${search.trim()}"`}</span>
                )
              ) : isLoadingList ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Cargando conversaciones...</span>
                </>
              ) : (
                <span>No hay conversaciones</span>
              )}
            </div>
          ) : (
            filteredConversations.map((conv) => {
              const hasMentions = conv.messages?.some(m => m.mentions && m.mentions.length > 0);
              // Real internal notes only — system events (opportunity
              // created/moved, assignment changes) also use the "internal"
              // channel, so a brand-new lead would otherwise show the note
              // icon with no actual comment. Exclude them.
              // Prefer the backend flag (`hasInternalComment`) so the icon shows
              // without opening the lead to hydrate its messages; fall back to a
              // local message scan once the conversation has been opened.
              const hasInternalComments =
                conv.hasInternalComment ||
                conv.messages?.some((m) => m.channel === "internal" && !m.systemEvent);
              const hasPendingTasks = tasks.some(t => t.conversationId === conv.id && t.status === "pending");
              const hasScheduled = (conv.scheduledMessages?.length ?? 0) > 0;
              
              return (
              // role=button + keyboard handling instead of a real <button>
              // because this row contains an inner DropdownMenu trigger (also
              // a <button>); a nested-button DOM is invalid and React warns.
              <div
                key={conv.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectConversation(conv.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectConversation(conv.id);
                  }
                }}
                className={cn(
                  "group relative flex items-center gap-3 rounded-lg text-left transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  viewMode === "normal" ? "p-3" : viewMode === "compact" ? "p-2" : "p-1.5 px-3",
                  activeConversationId === conv.id
                    ? "bg-accent/80 text-accent-foreground shadow-sm ring-1 ring-border/50"
                    : "hover:bg-muted/50"
                )}
              >
                {activeConversationId === conv.id && (
                  <div className="absolute left-0 top-2 bottom-2 w-1 rounded-r-md bg-primary" />
                )}
                <ChannelAvatar 
                  name={conv.participant.name} 
                  src={conv.participant.avatar} 
                  channel={conv.source} 
                  status={conv.participant.status}
                  className={cn(
                    viewMode === "normal" ? "h-12 w-12" : viewMode === "compact" ? "h-10 w-10" : "h-8 w-8"
                  )}
                  isActive={activeConversationId === conv.id}
                />

                <div className="flex flex-1 flex-col overflow-hidden min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn("truncate min-w-0 flex-1 font-semibold text-foreground", viewMode === "small" ? "text-xs" : "text-sm")}>
                      {conv.participant.name}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                        {conv.timestamp}
                      </span>
                      <div onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className={cn("h-6 w-6 rounded-full opacity-0 group-hover:opacity-100 transition-opacity", viewMode !== "small" || conv.unreadCount === 0 ? "-mr-2" : "")}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem 
                              className="gap-2 cursor-pointer"
                              onClick={(e) => {
                                e.stopPropagation();
                                onToggleFavorite?.(conv.id);
                              }}
                            >
                              <Star className={cn("h-4 w-4", conv.isFavorite && "fill-yellow-400 text-yellow-400")} />
                              <span>{conv.isFavorite ? "Quitar de favoritos" : "Favorito"}</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="gap-2 cursor-pointer"
                              onClick={(e) => {
                                e.stopPropagation();
                                onArchiveConversation?.(conv.id);
                              }}
                            >
                              <Archive className="h-4 w-4" />
                              <span>{conv.isArchived ? "Desarchivar" : "Archivar"}</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="gap-2 cursor-pointer"
                              disabled={!conv.unreadCount}
                              onClick={(e) => {
                                e.stopPropagation();
                                onMarkAsRead?.(conv.id);
                              }}
                            >
                              <CheckCheck className="h-4 w-4" />
                              <span>Marcar como leído</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="gap-2 cursor-pointer"
                              disabled={conv.unreadCount > 0}
                              onClick={(e) => {
                                e.stopPropagation();
                                onMarkAsUnread?.(conv.id);
                              }}
                            >
                              <Mail className="h-4 w-4" />
                              <span>Marcar como no leído</span>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="gap-2 text-destructive focus:text-destructive cursor-pointer"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPendingDelete({ id: conv.id, name: conv.participant.name });
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                              <span>Eliminar</span>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      {viewMode === "small" && conv.unreadCount > 0 && (
                        <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                          {conv.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                  
                  {viewMode !== "small" && (
                    <div className="flex items-start justify-between gap-2 mt-0.5">
                      <span className="flex min-w-0 flex-1 items-center gap-1 pr-2">
                        {/* Read/direction indicator (WhatsApp-style): the
                            last message was outbound (blue ✓✓ = enviado/
                            leído) or inbound (↵ = recibido). */}
                        {conv.lastMessageDirection === "outbound" ? (
                          <CheckCheck className="h-3.5 w-3.5 shrink-0 text-sky-500" />
                        ) : conv.lastMessageDirection === "inbound" ? (
                          <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        ) : null}
                        <span
                          className={cn(
                            // min-w-0 lets the span shrink inside the flex row;
                            // without it the unbroken text overflows and pushes
                            // the trailing unread badge off the right edge.
                            "line-clamp-1 min-w-0 text-xs leading-tight",
                            conv.unreadCount > 0
                              ? "font-semibold text-foreground"
                              : "text-muted-foreground"
                          )}
                          title={conv.lastMessage}
                        >
                          {conv.lastMessage}
                        </span>
                      </span>
                      {conv.unreadCount > 0 && (
                        <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                          {conv.unreadCount}
                        </span>
                      )}
                    </div>
                  )}

                  {viewMode === "normal" && (
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      {(() => {
                        // Always show a funnel ("embudo") badge. When the
                        // conversation has no resolved stage yet (e.g. a lead
                        // without an opportunity, common in the unread tab),
                        // fall back to the first pipeline stage so the badge
                        // is never missing — matches the design reference.
                        const stageId = conv.stage || stages[0]?.id;
                        if (!stageId) return null;
                        const currentStage = stages.find(s => s.id === stageId) || { label: stageId, color: "bg-slate-500" };

                        // Match the badge to the stage's own colour family
                        // (Kiwi → lime, Consulta → pink, Web → cyan, …)
                        // instead of defaulting most stages to grey.
                        const colorClasses = stageBadgeClasses(currentStage.color);

                        return (
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px] h-5 px-2 py-0 uppercase tracking-wider font-medium border-transparent",
                              colorClasses
                            )}
                          >
                            {currentStage.label}
                          </Badge>
                        );
                      })()}
                      {conv.activeReminder && (
                        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400" title={`Recordatorio: ${conv.activeReminder}`}>
                          <Bell className="h-3 w-3" />
                        </div>
                      )}
                      {hasMentions && (
                        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400" title="Contiene menciones">
                          <AtSign className="h-3 w-3" />
                        </div>
                      )}
                      {hasInternalComments && (
                        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400" title="Contiene comentarios internos">
                          <StickyNote className="h-3 w-3" />
                        </div>
                      )}
                      {hasPendingTasks && (
                        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400" title="Tiene tareas pendientes">
                          <CheckSquare className="h-3 w-3" />
                        </div>
                      )}
                      {hasScheduled && (
                        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-400" title="Tiene mensajes programados">
                          <Clock className="h-3 w-3" />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )})
          )}
          {isLoadingMore && (
            <div className="flex justify-center py-3 text-xs text-muted-foreground">
              Cargando más conversaciones…
            </div>
          )}
          {!hasMore && filteredConversations.length > 0 && (
            <div className="flex justify-center py-2 text-[11px] text-muted-foreground/50">
              Todas las conversaciones cargadas
            </div>
          )}
        </div>
      </div>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !isDeleting) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar lead?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará permanentemente a{" "}
              <span className="font-semibold text-foreground">{pendingDelete?.name}</span>{" "}
              y todas sus conversaciones. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async (e) => {
                // Don't let the AlertDialog close before the async work
                // finishes — onDeleteConversation triggers an HTTP delete +
                // backfill chain in the parent.
                e.preventDefault();
                if (!pendingDelete) return;
                setIsDeleting(true);
                try {
                  await onDeleteConversation?.(pendingDelete.id);
                } finally {
                  setIsDeleting(false);
                  setPendingDelete(null);
                }
              }}
            >
              {isDeleting ? "Eliminando…" : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
