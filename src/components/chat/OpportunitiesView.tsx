import React, { useEffect, useMemo, useState } from "react";
import {
  Search,
  Filter,
  ArrowUpDown,
  Download,
  Plus,
  Settings,
  LayoutGrid,
  List as ListIcon,
  MoreHorizontal,
  Phone,
  Calendar as CalendarIcon,
  Globe,
  Check,
  Menu,
  CheckSquare,
  Bell,
  Clock,
  MessageSquare,
  Bot,
  UserPlus,
  X,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import type {
  AgentUser,
  Conversation,
  FilterCondition,
  Opportunity,
  Pipeline,
  SavedView,
  TagSummary,
  Task,
} from "./types";
import { FilterBuilder } from "./FilterBuilder";
import { Calendar } from "@/components/ui/calendar";

interface OpportunitiesViewProps {
  opportunities: Opportunity[];
  pipeline?: Pipeline;
  // Source for the "Crear oportunidad" contact picker. We pull contacts from
  // the conversations the SPA has already loaded — without `users.readonly`
  // (and without a separate /contacts/search endpoint exposed to the SPA),
  // this is the most pragmatic source. Not provided ⇒ picker shows "no
  // contactos disponibles".
  conversations?: Conversation[];
  // Task roster for indicator-pill counts on each card. Each opportunity
  // joins on its linked conversation; pending tasks against that
  // conversation become the small CheckSquare badge.
  tasks?: Task[];
  // Agent roster for the FilterBuilder's user pickers (Asignado /
  // Seguidor / Mención). Empty when GHL hasn't returned a roster yet —
  // FilterBuilder degrades to free-text input in that case.
  users?: AgentUser[];
  // Location tag library — drives the FilterBuilder's "Etiqueta" value
  // dropdown so the kanban (etapas) filter offers the same tag options
  // as the chat sidebar. Empty ⇒ the field degrades to free-text input.
  availableTags?: TagSummary[];
  // Saved-view roster shared with the conversation-list sidebar. The
  // kanban's FilterBuilder reuses the same view shape (filters[] +
  // logic) so a view created here is readable there and vice versa.
  savedViews?: SavedView[];
  onSaveView?: (view: SavedView) => void;
  onMoveOpportunity?: (id: string, stageId: string) => void;
  onCreateOpportunity?: (payload: {
    name: string;
    contactId: string;
    pipelineId: string;
    stageId: string;
    monetaryValue?: number;
  }) => void | Promise<void>;
  // Create a brand-new GHL contact from the "Agregar contacto" modal in
  // the simplified header. Returns the created contact's id so the
  // modal can chain follow-ups (family-member links, opportunity).
  onCreateContact?: (payload: {
    name?: string;
    phone?: string;
    email?: string;
  }) => Promise<{ id: string } | null> | { id: string } | null;
  onOpenMobileNav?: () => void;
  // Open the contact's chat in a modal without leaving the kanban. Index.tsx
  // mounts a Dialog containing ChatMessageArea + ContactSidebar when this
  // fires; a missing prop just disables the click affordance.
  onOpenChat?: (contactId: string) => void;
  // Bulk delete a set of opportunities (cards selected via the checkbox).
  // Returns a promise so the toolbar can show a loading state if needed.
  onBulkDeleteOpportunities?: (ids: string[]) => Promise<void> | void;
}

type SortKey =
  | "recientes"
  | "antiguos"
  | "nombre-asc"
  | "nombre-desc"
  | "valor-desc"
  | "valor-asc";

const SORT_LABELS: Record<SortKey, string> = {
  recientes: "Más recientes",
  antiguos: "Más antiguos",
  "nombre-asc": "Nombre A-Z",
  "nombre-desc": "Nombre Z-A",
  "valor-desc": "Valor (mayor a menor)",
  "valor-asc": "Valor (menor a mayor)",
};

const STATUS_LABELS: Record<Opportunity["status"], string> = {
  open: "Abierta",
  won: "Ganada",
  lost: "Perdida",
  abandoned: "Abandonada",
};

// Spanish status pill — colour-coded to match the prototype. Open/Won
// pop on success colours; Lost is rose; Abandoned is muted slate.
const STATUS_PILL: Record<
  Opportunity["status"],
  { label: string; cls: string }
> = {
  open: {
    label: "Abierto",
    cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  },
  won: {
    label: "Ganado",
    cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  },
  lost: {
    label: "Perdido",
    cls: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
  },
  abandoned: {
    label: "Abandonado",
    cls: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  },
};

// Date-filter preset → half-open [from, to) window. Endpoints are
// normalised to midnight in the user's local timezone so the preset
// is consistent regardless of when in the day the agent triggers it.
// Returns null when no usable range can be formed (e.g. "personalizado"
// without a `from` picked yet) — the caller treats that as a no-op.
type DatePresetKey =
  | "hoy"
  | "ayer"
  | "esta_semana"
  | "semana_pasada"
  | "este_mes"
  | "mes_pasado"
  | "personalizado";

function resolveDateRange(
  preset: "" | DatePresetKey,
  custom: { from?: Date; to?: Date }
): { from: Date; to: Date } | null {
  const now = new Date();
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d: Date, n: number) => {
    const c = new Date(d);
    c.setDate(c.getDate() + n);
    return c;
  };
  switch (preset) {
    case "hoy": {
      const from = startOfDay(now);
      return { from, to: addDays(from, 1) };
    }
    case "ayer": {
      const from = addDays(startOfDay(now), -1);
      return { from, to: startOfDay(now) };
    }
    case "esta_semana": {
      const today = startOfDay(now);
      // Spanish convention: weeks start Monday. JS getDay()=0 is Sunday.
      const dow = (today.getDay() + 6) % 7;
      const monday = addDays(today, -dow);
      return { from: monday, to: addDays(today, 1) };
    }
    case "semana_pasada": {
      const today = startOfDay(now);
      const dow = (today.getDay() + 6) % 7;
      const thisMonday = addDays(today, -dow);
      return { from: addDays(thisMonday, -7), to: thisMonday };
    }
    case "este_mes":
      return {
        from: new Date(now.getFullYear(), now.getMonth(), 1),
        to: new Date(now.getFullYear(), now.getMonth() + 1, 1),
      };
    case "mes_pasado":
      return {
        from: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        to: new Date(now.getFullYear(), now.getMonth(), 1),
      };
    case "personalizado": {
      if (!custom.from) return null;
      const from = startOfDay(custom.from);
      // When only `from` is picked, treat it as a single-day window so
      // the filter is at least useful.
      const to = custom.to ? addDays(startOfDay(custom.to), 1) : addDays(from, 1);
      return { from, to };
    }
    default:
      return null;
  }
}

// Spanish labels for the preset list inside the `...` date-filter menu.
const DATE_PRESET_LABELS: Record<Exclude<DatePresetKey, "personalizado">, string> = {
  hoy: "Hoy",
  ayer: "Ayer",
  esta_semana: "Esta Semana",
  semana_pasada: "Semana pasada",
  este_mes: "Este mes",
  mes_pasado: "Mes Pasado",
};

// Stage pill colours for the list view. The stage palette is
// user-defined per pipeline, so we map by the Tailwind color *family*
// of `stage.color` (e.g. "bg-rose-500" → rose) to a softer
// background + text pair that reads well in both light and dark mode.
// Listed as full literals so Tailwind's JIT keeps them in the bundle.
const STAGE_PILL_BY_FAMILY: Record<string, string> = {
  rose: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
  red: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  orange: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  yellow: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  lime: "bg-lime-100 text-lime-700 dark:bg-lime-900/30 dark:text-lime-300",
  green: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  teal: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
  cyan: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300",
  sky: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  indigo: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  purple: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  fuchsia:
    "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/30 dark:text-fuchsia-300",
  pink: "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300",
  slate: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  gray: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  zinc: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

// Proper display labels for the messaging channel (the conversation's
// `source`). Used on the kanban card so we show the real channel
// (WhatsApp / Instagram / …) instead of GHL's opportunity attribution
// string ("Directo", "Whatsapp_coex"), which is inconsistent and gets
// rewritten by GHL on every stage move.
const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  messenger: "Messenger",
  tiktok: "TikTok",
  sms: "SMS",
  email: "Email",
};

function stagePillClasses(color: string | undefined): string {
  if (!color) return "bg-muted text-muted-foreground";
  const m = color.match(/bg-([a-z]+)-/);
  const family = m?.[1];
  return (
    (family && STAGE_PILL_BY_FAMILY[family]) || "bg-muted text-muted-foreground"
  );
}

// "S/ 0,00" — Peruvian Sol; same convention as ContactSidebar so the
// amount on the kanban card matches the right-rail amount field.
function formatOppValue(value: number | undefined): string {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return `S/ ${n.toLocaleString("es-PE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function OpportunitiesView({
  opportunities,
  pipeline,
  conversations,
  tasks,
  users = [],
  availableTags = [],
  savedViews,
  onSaveView,
  onMoveOpportunity,
  onCreateOpportunity,
  onCreateContact,
  onOpenMobileNav,
  onOpenChat,
  onBulkDeleteOpportunities,
}: OpportunitiesViewProps) {
  const { toast } = useToast();
  const [viewMode, setViewMode] = useState<"board" | "list">("board");
  const [searchQuery, setSearchQuery] = useState("");
  const [draggedOppId, setDraggedOppId] = useState<string | null>(null);
  // Manual within-column ordering. GHL exposes no arbitrary opportunity-
  // order API, so card reordering is a local override: stageId → ordered
  // opp ids. Applied on top of the active sort (cards present here win;
  // the rest fall through in sorted order). Resets on reload.
  const [manualOrder, setManualOrder] = useState<Record<string, string[]>>({});
  // Drop-indicator state while dragging over a card: which card and which
  // edge (insert before / after) the dragged card would land at.
  const [dragOverCard, setDragOverCard] = useState<{
    id: string;
    pos: "before" | "after";
  } | null>(null);
  // Bulk-select scaffold. The toolbar at the top of the board shows when
  // any card is checked; "Eliminar seleccionadas" calls the parent.
  const [selectedOppIds, setSelectedOppIds] = useState<Set<string>>(new Set());
  const toggleOppSelected = (id: string) => {
    setSelectedOppIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearOppSelection = () => setSelectedOppIds(new Set());

  // Filtros — rule-based builder. Each condition is `{ field, operator,
  // value }` and operates against the opportunity's *linked
  // conversation* (assignee, tags, channel, etc.). Saved-view support
  // is reused from FilterBuilder but persistence is currently a stub —
  // the SPA's SavedView store is wired for the conversation list, not
  // the kanban.
  const [builderFilters, setBuilderFilters] = useState<FilterCondition[]>([]);
  const [builderLogic, setBuilderLogic] = useState<"AND" | "OR">("AND");
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const activeFilterCount = builderFilters.filter((f) => f.field && f.value).length;

  // Date filter — surfaced from the "..." button. The empty string is
  // "no date filter active"; everything else maps through resolveDateRange.
  // Custom range lives separately so switching between "hoy"/"ayer"/etc
  // and back to "personalizado" doesn't wipe the agent's calendar pick.
  const [datePreset, setDatePreset] = useState<"" | DatePresetKey>("");
  const [customDateRange, setCustomDateRange] = useState<{
    from?: Date;
    to?: Date;
  }>({});
  const dateFilterActive =
    datePreset !== "" &&
    (datePreset !== "personalizado" || Boolean(customDateRange.from));

  // Ordenar
  const [sortKey, setSortKey] = useState<SortKey>("recientes");

  // Crear oportunidad dialog
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newOppContactId, setNewOppContactId] = useState("");
  const [newOppName, setNewOppName] = useState("");
  const [newOppStageId, setNewOppStageId] = useState("");
  const [newOppValue, setNewOppValue] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // "Nueva conversación" picker — two cards (Contacto / Bot). When the
  // agent chooses Contacto we drop into a contact-picker view inside the
  // same modal; the Bot option is stubbed (the bot designer isn't built
  // yet).
  const [isNuevaConvOpen, setIsNuevaConvOpen] = useState(false);
  const [nuevaConvStep, setNuevaConvStep] = useState<"pick" | "contact">("pick");
  const [nuevaConvContactId, setNuevaConvContactId] = useState("");

  // "Agregar contacto" modal — the comprehensive form. We persist what
  // GHL accepts via createContact (name/phone/email), wire the family
  // links via api.contacts.addFamily after create, and chain an
  // opportunity create when the agent picks a stage. Address / birthdate
  // / document are collected on the form for parity with the design,
  // but they need backend custom-field plumbing before they persist —
  // captured as TODO so a future pass can light them up.
  const [isAgregarContactoOpen, setIsAgregarContactoOpen] = useState(false);
  const [newContactName, setNewContactName] = useState("");
  const [newContactPhone, setNewContactPhone] = useState("");
  const [newContactEmail, setNewContactEmail] = useState("");
  const [newContactAddress, setNewContactAddress] = useState("");
  const [newContactBirthdate, setNewContactBirthdate] = useState("");
  const [newContactDocType, setNewContactDocType] = useState<string>("CC");
  const [newContactDocNumber, setNewContactDocNumber] = useState("");
  const [newContactStageId, setNewContactStageId] = useState("");
  type DraftFamily = {
    name: string;
    phone: string;
    relationship: "hijo" | "padre" | "esposo" | "hermano" | "otro";
  };
  const [newContactFamily, setNewContactFamily] = useState<DraftFamily[]>([]);
  const [familyDraftName, setFamilyDraftName] = useState("");
  const [familyDraftPhone, setFamilyDraftPhone] = useState("");
  const [familyDraftRel, setFamilyDraftRel] = useState<DraftFamily["relationship"] | "">("");
  const [showFamilyDraft, setShowFamilyDraft] = useState(false);
  const [isSubmittingContact, setIsSubmittingContact] = useState(false);

  const resetAgregarContacto = () => {
    setNewContactName("");
    setNewContactPhone("");
    setNewContactEmail("");
    setNewContactAddress("");
    setNewContactBirthdate("");
    setNewContactDocType("CC");
    setNewContactDocNumber("");
    setNewContactStageId("");
    setNewContactFamily([]);
    setFamilyDraftName("");
    setFamilyDraftPhone("");
    setFamilyDraftRel("");
    setShowFamilyDraft(false);
    setIsSubmittingContact(false);
  };

  // Spanish labels for the family relationship Select inside the form —
  // mirror the keys used by ContactSidebar.tsx so the wire side stays
  // consistent (the same `relationship` enum the backend persists).
  const FAMILY_REL_LABELS: Record<DraftFamily["relationship"], string> = {
    hijo: "Hijo(a)",
    padre: "Padre/Madre",
    esposo: "Esposo(a)",
    hermano: "Hermano(a)",
    otro: "Otro",
  };

  const stages = pipeline?.stages ?? [];
  const stageLookup = useMemo(
    () => new Map(stages.map((s) => [s.id, s.label] as const)),
    [stages]
  );

  // Unique source values seen in current opportunities (for the filter popover).
  const availableSources = useMemo(() => {
    const set = new Set<string>();
    for (const o of opportunities) if (o.source) set.add(o.source);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [opportunities]);

  // Per-contact conversation lookup so each kanban card can pull its
  // participant's tags / avatar / phone + count active reminders &
  // scheduled messages. Keyed by every plausible id flavour (contactId
  // and participant.id) since older rows used only the participant.
  const convByContactId = useMemo(() => {
    const map = new Map<string, Conversation>();
    for (const c of conversations ?? []) {
      const cid = c.contactId ?? c.participant.id;
      if (cid && !map.has(cid)) map.set(cid, c);
      if (c.participant.id && !map.has(c.participant.id)) map.set(c.participant.id, c);
    }
    return map;
  }, [conversations]);

  // ---- "Mención" filter support ----
  // Mentions live in message bodies, not on the opportunity, so we can't
  // enrich them in bulk. Instead we use GHL's native `mentions` conversation
  // search: for each distinct mention value in the active filter set, ask the
  // backend which contacts have that user @mentioned, then match opportunities
  // by contactId. This covers every card (not just loaded conversations).
  const mentionFilterValues = useMemo(() => {
    const vals = new Set<string>();
    for (const c of builderFilters) {
      if (c.field === "mencion" && c.value) vals.add(c.value);
    }
    return Array.from(vals);
  }, [builderFilters]);

  const [mentionContactsByValue, setMentionContactsByValue] = useState<
    Map<string, Set<string>>
  >(() => new Map());

  useEffect(() => {
    if (mentionFilterValues.length === 0) {
      setMentionContactsByValue(new Map());
      return;
    }
    let cancelled = false;
    Promise.all(
      mentionFilterValues.map(async (val) => {
        try {
          const res = await api.conversations.list({ mentions: val, limit: 100 });
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
    ).then((entries) => {
      if (!cancelled) setMentionContactsByValue(new Map(entries));
    });
    return () => {
      cancelled = true;
    };
    // mentionFilterValues is a memoised array — stable while values are unchanged.
  }, [mentionFilterValues]);

  // Pending-task count per conversation. The card's CheckSquare badge
  // shows only when there's at least one outstanding task on the
  // linked conversation — completed ones don't deserve the visual
  // noise on the kanban.
  const pendingTasksByConvId = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of tasks ?? []) {
      if (t.status === "completed") continue;
      const k = t.conversationId;
      if (!k) continue;
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    return map;
  }, [tasks]);

  // Deduped contact list for the create-dialog Select. Falls back to the
  // participant id when contactId isn't on the conversation (older rows).
  const uniqueContacts = useMemo(() => {
    const seen = new Set<string>();
    const out: { contactId: string; name: string }[] = [];
    for (const c of conversations ?? []) {
      const id = c.contactId ?? c.participant.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ contactId: id, name: c.participant.name });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [conversations]);

  // Evaluate one FilterCondition against an opportunity + its linked
  // conversation. The fields the builder exposes are all conversation /
  // contact-level (assignee, tags, channel, last-message direction…) —
  // so an opportunity without a matching conversation can only ever
  // match the empty-value case, which we treat as a no-op pass.
  const evaluateCondition = (
    cond: FilterCondition,
    opp: Opportunity,
    conv: Conversation | undefined,
    usersByName: Map<string, string>
  ): boolean => {
    if (!cond.value) return true;
    const v = cond.value;
    const valLower = v.toLowerCase();
    const isNegated =
      cond.operator === "no_es" || cond.operator === "no_contiene";
    const isEquality = cond.operator === "es" || cond.operator === "no_es";

    const resolveUserIds = (raw: string): string[] => {
      const t = raw.trim();
      if (!t) return [];
      const exact = usersByName.get(t.toLowerCase());
      if (exact) return [exact];
      return [t];
    };

    let match = false;
    switch (cond.field) {
      case "asignado": {
        const candidates = resolveUserIds(v);
        // Prefer the opportunity's own assignee — it's authoritative and
        // present even when the linked conversation isn't loaded (the
        // conversation participant doesn't carry assignedTo). Fall back to
        // the conversation only if the opp has none.
        const a = opp.assignedTo ?? conv?.participant.assignedTo;
        if (!a) match = false;
        else if (isEquality) match = candidates.includes(a);
        else
          match = candidates.some((c) =>
            a.toLowerCase().includes(c.toLowerCase())
          );
        break;
      }
      case "seguidor": {
        const candidates = resolveUserIds(v);
        // Prefer the enriched opp-level followers (cover every card); fall
        // back to the linked conversation participant.
        const followers = opp.followers ?? conv?.participant.followers ?? [];
        if (followers.length === 0) match = false;
        else if (isEquality)
          match = candidates.some((c) => followers.includes(c));
        else
          match = candidates.some((c) =>
            followers.some((f) => f.toLowerCase().includes(c.toLowerCase()))
          );
        break;
      }
      case "mencion": {
        // Authoritative path: GHL's native mentions search resolved this
        // value to a contactId set (covers every card). While that lookup is
        // in flight, fall back to scanning the linked conversation's hydrated
        // messages so the filter still does something for loaded cards.
        const set = mentionContactsByValue.get(v);
        if (set) {
          match = set.has(opp.contactId);
        } else {
          const candidates = resolveUserIds(v);
          const mentioned = (conv?.messages ?? []).flatMap(
            (m) => m.mentions ?? []
          );
          if (mentioned.length === 0) match = false;
          else if (isEquality)
            match = candidates.some((c) => mentioned.includes(c));
          else
            match = candidates.some((c) =>
              mentioned.some((m) => m.toLowerCase().includes(c.toLowerCase()))
            );
        }
        break;
      }
      case "direccion_ultimo_mensaje": {
        const dir = opp.lastMessageDirection ?? conv?.lastMessageDirection;
        match = dir === valLower;
        break;
      }
      case "tipo_ultimo_mensaje_saliente": {
        const dir = opp.lastMessageDirection ?? conv?.lastMessageDirection;
        const channel = opp.channel ?? conv?.source;
        match = dir === "outbound" && channel === valLower;
        break;
      }
      case "canal_ultimo_mensaje": {
        const channel = opp.channel ?? conv?.source;
        match = channel === valLower;
        break;
      }
      case "etiqueta": {
        // Opportunity search carries the contact's tags directly — use them
        // so the filter works even when the conversation isn't loaded; fall
        // back to the conversation participant otherwise.
        const tags =
          (opp.tags && opp.tags.length ? opp.tags : conv?.participant.tags) ?? [];
        if (isEquality)
          match = tags.some((t) => t.toLowerCase() === valLower);
        else match = tags.some((t) => t.toLowerCase().includes(valLower));
        break;
      }
      case "embudo_actual": {
        // For an opportunity, "embudo actual" reads the kanban stage
        // directly off the opportunity rather than off the conversation's
        // synthetic `stage` field — opp.stageId is authoritative here.
        const stageId = (opp.stageId ?? "").toLowerCase();
        if (isEquality) match = stageId === valLower;
        else match = stageId.includes(valLower);
        break;
      }
      case "ans": {
        const hours = Number(v);
        const lastAt = opp.lastMessageAt ?? conv?.lastMessageAt;
        if (!Number.isFinite(hours) || !lastAt) {
          match = true;
          break;
        }
        const ageMs = Date.now() - Date.parse(lastAt);
        match = ageMs >= hours * 60 * 60 * 1000;
        break;
      }
      default:
        match = true;
    }
    return isNegated ? !match : match;
  };

  // Filter + sort chain. Search + advanced filters narrow first; sort runs on
  // the result. `Opportunity.date` is a localized display string (e.g.
  // "28 abr 2026") — lexical compare is good-enough for v1 ordering; if it
  // becomes an issue, plumb `createdAtIso` through `toFrontendOpportunity`.
  const filteredOpps = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = opportunities.filter((o) => o.name.toLowerCase().includes(q));

    const activeConds = builderFilters.filter(
      (c) => c.field && c.value !== undefined && c.value !== ""
    );
    if (activeConds.length > 0) {
      const usersByName = new Map(
        users.map((u) => [u.name.toLowerCase(), u.id])
      );
      list = list.filter((opp) => {
        const conv = convByContactId.get(opp.contactId);
        const passes = activeConds.map((c) =>
          evaluateCondition(c, opp, conv, usersByName)
        );
        return builderLogic === "AND"
          ? passes.every(Boolean)
          : passes.some(Boolean);
      });
    }

    // Date-preset narrowing. Compares against the linked conversation's
    // `lastMessageAt` ISO — the closest recency signal on the wire
    // today. Opportunities without a linked conversation (or without
    // a parseable lastMessageAt) get excluded when a date filter is
    // active.
    if (dateFilterActive) {
      const range = resolveDateRange(datePreset, customDateRange);
      if (range) {
        const fromTs = range.from.getTime();
        const toTs = range.to.getTime();
        list = list.filter((opp) => {
          const conv = convByContactId.get(opp.contactId);
          const lastAt = opp.lastMessageAt ?? conv?.lastMessageAt;
          if (!lastAt) return false;
          const t = Date.parse(lastAt);
          if (!Number.isFinite(t)) return false;
          return t >= fromTs && t < toTs;
        });
      }
    }

    const sorted = [...list];
    switch (sortKey) {
      case "nombre-asc":
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "nombre-desc":
        sorted.sort((a, b) => b.name.localeCompare(a.name));
        break;
      case "valor-desc":
        sorted.sort((a, b) => (b.monetaryValue ?? 0) - (a.monetaryValue ?? 0));
        break;
      case "valor-asc":
        sorted.sort((a, b) => (a.monetaryValue ?? 0) - (b.monetaryValue ?? 0));
        break;
      case "antiguos":
        sorted.sort((a, b) => a.date.localeCompare(b.date));
        break;
      case "recientes":
      default:
        sorted.sort((a, b) => b.date.localeCompare(a.date));
        break;
    }
    return sorted;
    // `convByContactId` is excluded from deps because it's a useMemo
    // derived from `conversations` already in deps — Adding it would
    // re-trigger on every conversations identity flip even when the
    // join keys haven't changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    opportunities,
    searchQuery,
    builderFilters,
    builderLogic,
    datePreset,
    customDateRange,
    dateFilterActive,
    sortKey,
    users,
    conversations,
    mentionContactsByValue,
  ]);

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedOppId(id);
    e.dataTransfer.effectAllowed = "move";
  };
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };
  const handleDrop = (e: React.DragEvent, targetStageId: string) => {
    e.preventDefault();
    if (draggedOppId) {
      onMoveOpportunity?.(draggedOppId, targetStageId);
      setDraggedOppId(null);
    }
    setDragOverCard(null);
  };

  // Reorder a column's cards by the local manual-order override. Cards
  // listed in `manualOrder[stageId]` sort to the front in that order;
  // anything not listed (e.g. just-arrived cards) keeps its incoming
  // sorted position after them. Sort is stable in modern JS engines.
  const orderStageOpps = (opps: Opportunity[], stageId: string) => {
    const order = manualOrder[stageId];
    if (!order || order.length === 0) return opps;
    const rank = new Map(order.map((id, i) => [id, i]));
    return [...opps].sort((a, b) => {
      const ra = rank.has(a.id) ? (rank.get(a.id) as number) : Infinity;
      const rb = rank.has(b.id) ? (rank.get(b.id) as number) : Infinity;
      return ra - rb;
    });
  };

  // While dragging over a card, mark which edge (above/below the card's
  // vertical midpoint) the dragged card would drop at — drives the
  // insertion indicator line.
  const handleCardDragOver = (e: React.DragEvent, targetId: string) => {
    if (!draggedOppId || draggedOppId === targetId) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
    setDragOverCard((prev) =>
      prev && prev.id === targetId && prev.pos === pos
        ? prev
        : { id: targetId, pos }
    );
  };

  // Drop directly onto a card: insert the dragged card just before/after
  // the target within that card's column. `displayedIds` is the column's
  // current on-screen order, so the new order is computed from exactly
  // what the operator sees. Cross-column drops also move the stage.
  const handleCardDrop = (
    e: React.DragEvent,
    targetOpp: Opportunity,
    displayedIds: string[]
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const draggedId = draggedOppId;
    const drop = dragOverCard;
    setDragOverCard(null);
    setDraggedOppId(null);
    if (!draggedId || draggedId === targetOpp.id) return;

    const targetStageId = targetOpp.stageId;
    const dragged = opportunities.find((o) => o.id === draggedId);
    // Moving in from another column — persist the stage change too.
    if (dragged && dragged.stageId !== targetStageId) {
      onMoveOpportunity?.(draggedId, targetStageId);
    }

    const pos = drop && drop.id === targetOpp.id ? drop.pos : "before";
    const base = displayedIds.filter((id) => id !== draggedId);
    const targetIdx = base.indexOf(targetOpp.id);
    if (targetIdx === -1) return;
    const insertIdx = pos === "before" ? targetIdx : targetIdx + 1;
    base.splice(insertIdx, 0, draggedId);
    setManualOrder((prev) => ({ ...prev, [targetStageId]: base }));
  };

  const clearFilters = () => {
    setBuilderFilters([]);
    setBuilderLogic("AND");
  };

  const handleComingSoon = () => {
    toast({
      title: "Próximamente",
      description: "Esta función estará disponible más adelante.",
    });
  };

  const canSubmit =
    !isSubmitting &&
    Boolean(newOppContactId) &&
    Boolean(newOppName.trim()) &&
    Boolean(newOppStageId) &&
    Boolean(pipeline);

  const handleSubmitCreate = async () => {
    if (!pipeline || !canSubmit) return;
    setIsSubmitting(true);
    try {
      await onCreateOpportunity?.({
        name: newOppName.trim(),
        contactId: newOppContactId,
        pipelineId: pipeline.id,
        stageId: newOppStageId,
        monetaryValue: newOppValue ? Number(newOppValue) : undefined,
      });
      // Reset and close.
      setNewOppContactId("");
      setNewOppName("");
      setNewOppStageId("");
      setNewOppValue("");
      setIsCreateOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* Header */}
      <div className="flex h-[68px] items-center justify-between px-4 border-b shrink-0 gap-4 overflow-x-auto bg-card">
        <div className="flex items-center gap-2 min-w-0 shrink-0">
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
          <h1 className="text-xl font-semibold truncate">Oportunidades</h1>
        </div>
        <div className="flex flex-1 items-center gap-2 flex-wrap justify-end lg:flex-nowrap">
          <div className="relative flex-1 min-w-[160px] sm:flex-initial sm:w-56 xl:w-64 shrink-0">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar oportunidad..."
              className="pl-8 bg-muted/50"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* "+" trigger — splits into two flows per the spec:
              • Nueva conversación → contact/bot picker, then opens an
                existing chat or stubs the bot designer.
              • Agregar contacto → comprehensive contact-create form
                with optional opportunity stage and family links. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="shrink-0"
                title="Nuevo"
                aria-label="Nuevo"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem
                onClick={() => {
                  setNuevaConvStep("pick");
                  setNuevaConvContactId("");
                  setIsNuevaConvOpen(true);
                }}
              >
                <MessageSquare className="h-4 w-4 mr-2" />
                Nueva conversación
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  resetAgregarContacto();
                  setIsAgregarContactoOpen(true);
                }}
              >
                <UserPlus className="h-4 w-4 mr-2" />
                Agregar contacto
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Filtros — rule-based builder. Icon-only with a small badge
              showing the count of conditions that have both a field and
              a value (an "empty" condition row doesn't count toward the
              total because it has no effect on the filtered list). */}
          <Popover open={isFilterOpen} onOpenChange={setIsFilterOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="icon" className="shrink-0 relative" title="Filtros" aria-label="Filtros">
                <Filter className="h-4 w-4" />
                {activeFilterCount > 0 && (
                  <span className="absolute -top-1 -right-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                    {activeFilterCount}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="p-0 w-auto border-0 bg-transparent shadow-none">
              <FilterBuilder
                filters={builderFilters}
                logic={builderLogic}
                onFiltersChange={setBuilderFilters}
                onLogicChange={setBuilderLogic}
                onClose={() => setIsFilterOpen(false)}
                onClear={clearFilters}
                // Save-as-view persists the current condition set + AND/OR
                // logic via the parent's existing SavedView store (same
                // one ChatSidebar uses). Re-runs apply the view by setting
                // builderFilters back to its filters[] array.
                onSaveView={(name, viewId) => {
                  if (!onSaveView) {
                    toast({
                      title: "No disponible",
                      description: "El backend no expone guardar vistas.",
                      variant: "destructive",
                    });
                    return;
                  }
                  const view: SavedView = {
                    id: viewId || `view-${Date.now()}`,
                    name,
                    filters: builderFilters,
                    logic: builderLogic,
                  };
                  onSaveView(view);
                  toast({
                    title: viewId ? "Vista actualizada" : "Vista guardada",
                    description: `«${name}» ${viewId ? "se actualizó" : "se guardó"} y está disponible en la barra lateral.`,
                  });
                }}
                stages={stages}
                users={users}
                availableTags={availableTags}
              />
            </PopoverContent>
          </Popover>

          {/* The "..." button is now dedicated to the date filter.
              Flat menu: a header ("Filtrar por fecha"), the six quick
              presets as a radio group, then "Fecha personalizada" as
              a sub-menu trigger whose sub-content embeds the shadcn
              Calendar in range mode. A small dot on the trigger
              signals when a date filter is currently active. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="shrink-0 relative"
                title="Filtrar por fecha"
                aria-label="Filtrar por fecha"
              >
                <MoreHorizontal className="h-4 w-4" />
                {dateFilterActive && (
                  <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-primary" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="flex items-center gap-2 font-semibold text-foreground">
                <Filter className="h-4 w-4" />
                Filtrar por fecha
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup
                value={datePreset}
                onValueChange={(v) => {
                  const next = v as "" | DatePresetKey;
                  setDatePreset(next);
                  // Switching away from "personalizado" clears the
                  // calendar pick so it doesn't linger as stale state.
                  if (next !== "personalizado") setCustomDateRange({});
                }}
              >
                {(
                  Object.keys(DATE_PRESET_LABELS) as (keyof typeof DATE_PRESET_LABELS)[]
                ).map((key) => (
                  <DropdownMenuRadioItem key={key} value={key}>
                    {DATE_PRESET_LABELS[key]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger
                  onClick={() => setDatePreset("personalizado")}
                  className={cn(
                    datePreset === "personalizado" && "bg-accent"
                  )}
                >
                  <CalendarIcon className="h-4 w-4 mr-2" />
                  Fecha personalizada
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="p-0">
                  <Calendar
                    mode="range"
                    selected={
                      customDateRange.from
                        ? {
                            from: customDateRange.from,
                            to: customDateRange.to,
                          }
                        : undefined
                    }
                    onSelect={(r) => {
                      setCustomDateRange({ from: r?.from, to: r?.to });
                      // Picking any date should activate the custom
                      // preset (even if the trigger row wasn't clicked).
                      setDatePreset("personalizado");
                    }}
                    numberOfMonths={1}
                  />
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              {dateFilterActive && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => {
                      setDatePreset("");
                      setCustomDateRange({});
                    }}
                    className="text-muted-foreground"
                  >
                    <X className="h-4 w-4 mr-2" />
                    Quitar filtro
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="flex items-center bg-muted/50 rounded-md p-1 shrink-0">
            <Button
              variant={viewMode === "board" ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8"
              onClick={() => setViewMode("board")}
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8"
              onClick={() => setViewMode("list")}
            >
              <ListIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {stages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No se encontró un pipeline en GoHighLevel.
          </div>
        ) : viewMode === "board" ? (
          <>
            <div className="flex gap-4 h-full pb-4 w-max">
              {stages.map((stage) => {
                const stageOpps = orderStageOpps(
                  filteredOpps.filter((o) => o.stageId === stage.id),
                  stage.id
                );
                // The column's current on-screen order — passed to each
                // card's drop handler so reordering is computed from what
                // the operator actually sees.
                const stageOppIds = stageOpps.map((o) => o.id);
                const stageTotal = stageOpps.reduce(
                  (sum, opp) => sum + (opp.monetaryValue ?? 0),
                  0
                );
                // Stage-level select-all state. `indeterminate` when only
                // some cards in the column are picked, so the operator
                // can see partial selection without inspecting each card.
                const selectedInStage = stageOpps.filter((o) =>
                  selectedOppIds.has(o.id)
                ).length;
                const stageAllSelected =
                  stageOpps.length > 0 && selectedInStage === stageOpps.length;
                const stageSomeSelected =
                  selectedInStage > 0 && !stageAllSelected;
                return (
                  <div
                    key={stage.id}
                    className="flex flex-col w-72 bg-muted/30 dark:bg-black/20 rounded-lg border shrink-0"
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, stage.id)}
                  >
                    <div className="group p-3 border-b bg-muted/50 rounded-t-lg shrink-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {/* Per-stage color dot — the same swatch the
                              chat sidebar uses for the stage badge, so a
                              quick visual scan correlates kanban column
                              with the lead row. */}
                          {stage.color && (
                            <div
                              className={cn(
                                "h-2 w-2 shrink-0 rounded-full",
                                stage.color
                              )}
                            />
                          )}
                          <h3 className="font-medium text-sm truncate">
                            {stage.label}
                          </h3>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {/* Always render — empty columns still show
                              "S/ 0,00" so the header structure stays
                              consistent across the board and an empty
                              column doesn't feel visually incomplete. */}
                          <span className="text-xs font-medium text-muted-foreground">
                            {formatOppValue(stageTotal)}
                          </span>
                          <span className="text-xs text-muted-foreground bg-background px-2 py-0.5 rounded-full border">
                            {stageOpps.length}
                          </span>
                          {/* Select-all for this stage. Hidden when the
                              column is empty (nothing to select); only
                              revealed on hover so it doesn't compete
                              with the count pill at rest. Stays visible
                              once any card in the stage is picked so the
                              operator can see / clear the selection
                              without re-hovering. Indeterminate when
                              partially selected; clicking adds or removes
                              every card in this stage from the selection
                              set. */}
                          {stageOpps.length > 0 && (
                            <Checkbox
                              checked={
                                stageAllSelected
                                  ? true
                                  : stageSomeSelected
                                    ? "indeterminate"
                                    : false
                              }
                              onCheckedChange={(checked) => {
                                setSelectedOppIds((prev) => {
                                  const next = new Set(prev);
                                  if (checked === true) {
                                    for (const o of stageOpps) next.add(o.id);
                                  } else {
                                    for (const o of stageOpps)
                                      next.delete(o.id);
                                  }
                                  return next;
                                });
                              }}
                              onClick={(e) => e.stopPropagation()}
                              aria-label={`Seleccionar todos en ${stage.label}`}
                              className={cn(
                                "transition-opacity",
                                stageAllSelected || stageSomeSelected
                                  ? "opacity-100"
                                  : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                              )}
                            />
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex-1 p-2 space-y-2 overflow-y-auto">
                      {stageOpps.map((opp) => {
                        const isSelected = selectedOppIds.has(opp.id);
                        const canOpenChat = Boolean(onOpenChat && opp.contactId);
                        // Join the linked conversation so the card can show
                        // the contact's tags, avatar and phone. Counters
                        // (reminder / scheduled / tasks) come off the same
                        // conversation + the tasks roster the parent
                        // already maintains.
                        const conv = convByContactId.get(opp.contactId);
                        const participant = conv?.participant;
                        // Fall back to the opportunity's own contact data so
                        // phone/tags show even when the conversation isn't in
                        // the loaded window.
                        const tags = participant?.tags ?? opp.tags ?? [];
                        const phone = participant?.phone ?? opp.phone;
                        const avatar = participant?.avatar;
                        const reminderCount = conv?.activeReminder ? 1 : 0;
                        const scheduledCount = conv?.scheduledMessages?.length ?? 0;
                        const taskCount = conv?.id
                          ? pendingTasksByConvId.get(conv.id) ?? 0
                          : 0;
                        // "Notas internas" — messages on the internal
                        // channel. Counted off whatever's already in the
                        // conversation's messages array; for conversations
                        // the user hasn't opened yet this defaults to 0
                        // because the SPA hydrates the message list
                        // lazily. Reading after first chat open reflects
                        // the real count.
                        const notesCount =
                          conv?.messages?.filter((m) => m.channel === "internal")
                            .length ?? 0;
                        const statusPill = STATUS_PILL[opp.status];
                        return (
                          <div
                            key={opp.id}
                            draggable
                            onDragStart={(e) => handleDragStart(e, opp.id)}
                            onDragEnd={() => {
                              setDraggedOppId(null);
                              setDragOverCard(null);
                            }}
                            onDragOver={(e) => handleCardDragOver(e, opp.id)}
                            onDragLeave={() =>
                              setDragOverCard((prev) =>
                                prev?.id === opp.id ? null : prev
                              )
                            }
                            onDrop={(e) => handleCardDrop(e, opp, stageOppIds)}
                            onClick={() => {
                              if (canOpenChat) onOpenChat?.(opp.contactId);
                            }}
                            className={cn(
                              "group bg-card border rounded-md p-3 shadow-sm hover:shadow-md transition-all active:cursor-grabbing relative",
                              canOpenChat ? "cursor-pointer" : "cursor-grab",
                              isSelected && "ring-2 ring-primary ring-offset-1",
                              // Insertion indicator: a primary line on the
                              // edge the dragged card would drop at.
                              dragOverCard?.id === opp.id &&
                                draggedOppId !== opp.id &&
                                (dragOverCard.pos === "before"
                                  ? "before:absolute before:-top-1 before:left-0 before:right-0 before:h-0.5 before:rounded-full before:bg-primary"
                                  : "after:absolute after:-bottom-1 after:left-0 after:right-0 after:h-0.5 after:rounded-full after:bg-primary"),
                              draggedOppId === opp.id && "opacity-50"
                            )}
                          >
                            <div className="flex items-start justify-between mb-1.5">
                              <div className="min-w-0 flex-1 pr-2">
                                <h4 className="font-medium text-sm truncate">{opp.name}</h4>
                                {tags.length > 0 && (
                                  <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                                    {tags.slice(0, 4).map((tag, i) => (
                                      <span
                                        key={`${tag}-${i}`}
                                        className="text-[10px] px-2 py-0.5 rounded-md bg-secondary text-secondary-foreground font-medium truncate max-w-[100px]"
                                      >
                                        {tag}
                                      </span>
                                    ))}
                                    {tags.length > 4 && (
                                      <span className="text-[10px] text-muted-foreground">
                                        +{tags.length - 4}
                                      </span>
                                    )}
                                  </div>
                                )}
                                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                  <span
                                    className={cn(
                                      "text-[10px] px-2 py-0.5 rounded-md font-medium",
                                      statusPill.cls
                                    )}
                                  >
                                    {statusPill.label}
                                  </span>
                                  {/* Always render — `formatOppValue`
                                      handles undefined / 0 and emits
                                      "S/ 0,00" so the row width stays
                                      stable regardless of value. */}
                                  <span className="text-xs font-medium text-foreground">
                                    {formatOppValue(opp.monetaryValue)}
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0 ml-1">
                                {/* Selection checkbox — appears on hover or
                                    while selected. stopPropagation so the
                                    card's onClick doesn't also fire. */}
                                <div
                                  className={cn(
                                    "transition-opacity",
                                    isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                                  )}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <Checkbox
                                    checked={isSelected}
                                    onCheckedChange={() => toggleOppSelected(opp.id)}
                                  />
                                </div>
                                <Avatar className="h-6 w-6">
                                  {avatar && <AvatarImage src={avatar} alt={opp.name} />}
                                  <AvatarFallback>{opp.name.charAt(0)}</AvatarFallback>
                                </Avatar>
                              </div>
                            </div>
                            <div className="space-y-1.5 mt-3">
                              {phone && (
                                <div className="flex items-center text-xs text-muted-foreground">
                                  <Phone className="h-3.5 w-3.5 mr-2 shrink-0" />
                                  <span className="truncate">{phone}</span>
                                </div>
                              )}
                              {(() => {
                                // Prefer the linked conversation's channel —
                                // it's the real messaging source and stays
                                // stable across stage moves. Fall back to the
                                // opportunity's attribution source otherwise.
                                const channelLabel = conv?.source
                                  ? CHANNEL_LABELS[conv.source] ?? conv.source
                                  : opp.source;
                                if (!channelLabel) return null;
                                return (
                                  <div className="flex items-center text-xs text-muted-foreground">
                                    <Globe className="h-3.5 w-3.5 mr-2 shrink-0" />
                                    <span className="truncate">{channelLabel}</span>
                                  </div>
                                );
                              })()}
                              <div className="flex items-center justify-between mt-3 pt-3 border-t">
                                <div className="flex items-center text-xs text-muted-foreground">
                                  <CalendarIcon className="h-3.5 w-3.5 mr-1.5 shrink-0" />
                                  <span>{opp.date}</span>
                                </div>
                                <div className="flex items-center gap-2.5 text-muted-foreground">
                                  {taskCount > 0 && (
                                    <div
                                      className="flex items-center gap-1 text-[10px]"
                                      title={`${taskCount} tarea${taskCount === 1 ? "" : "s"} pendiente${taskCount === 1 ? "" : "s"}`}
                                    >
                                      <CheckSquare className="h-3 w-3" />
                                      <span>{taskCount}</span>
                                    </div>
                                  )}
                                  {reminderCount > 0 && (
                                    <div
                                      className="flex items-center gap-1 text-[10px]"
                                      title="Recordatorio activo"
                                    >
                                      <Bell className="h-3 w-3" />
                                      <span>{reminderCount}</span>
                                    </div>
                                  )}
                                  {scheduledCount > 0 && (
                                    <div
                                      className="flex items-center gap-1 text-[10px]"
                                      title={`${scheduledCount} mensaje${scheduledCount === 1 ? "" : "s"} programado${scheduledCount === 1 ? "" : "s"}`}
                                    >
                                      <Clock className="h-3 w-3" />
                                      <span>{scheduledCount}</span>
                                    </div>
                                  )}
                                  {notesCount > 0 && (
                                    <div
                                      className="flex items-center gap-1 text-[10px]"
                                      title={`${notesCount} nota${notesCount === 1 ? "" : "s"} interna${notesCount === 1 ? "" : "s"}`}
                                    >
                                      <MessageSquare className="h-3 w-3" />
                                      <span>{notesCount}</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          // List view — full-width and horizontally scrollable on
          // narrow viewports so the table doesn't get visually
          // squished. Columns: checkbox / lead (with tags) / stage
          // (colored pill from stage.color) / phone / source / date /
          // owner avatar. Tags + phone are joined from the linked
          // conversation, same join the kanban card uses.
          <div className="w-full overflow-x-auto rounded-lg border bg-card">
            <Table className="min-w-[900px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={
                        filteredOpps.length > 0 &&
                        filteredOpps.every((o) => selectedOppIds.has(o.id))
                      }
                      onCheckedChange={(c) => {
                        if (c === true) {
                          setSelectedOppIds(
                            new Set(filteredOpps.map((o) => o.id))
                          );
                        } else {
                          clearOppSelection();
                        }
                      }}
                      aria-label="Seleccionar todos"
                    />
                  </TableHead>
                  <TableHead>Nombre del lead</TableHead>
                  <TableHead>Etapa</TableHead>
                  <TableHead>Teléfono</TableHead>
                  <TableHead>Medio de captación</TableHead>
                  <TableHead>Fecha de creación</TableHead>
                  <TableHead className="text-right">Propietario</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOpps.map((opp) => {
                  const isSelected = selectedOppIds.has(opp.id);
                  const conv = convByContactId.get(opp.contactId);
                  const participant = conv?.participant;
                  const tags = participant?.tags ?? opp.tags ?? [];
                  const phone = participant?.phone ?? opp.phone;
                  const avatar = participant?.avatar;
                  const stage = stages.find((s) => s.id === opp.stageId);
                  const stageLabel = stage?.label ?? opp.stageId;
                  return (
                    <TableRow
                      key={opp.id}
                      data-state={isSelected ? "selected" : undefined}
                      className="group"
                    >
                      <TableCell>
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleOppSelected(opp.id)}
                          aria-label={`Seleccionar ${opp.name}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col min-w-0">
                          <span className="font-medium truncate">
                            {opp.name}
                          </span>
                          {tags.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1 mt-1">
                              {tags.slice(0, 4).map((tag, i) => (
                                <span
                                  key={`${tag}-${i}`}
                                  className="text-[10px] px-2 py-0.5 rounded-md bg-secondary text-secondary-foreground font-medium truncate max-w-[100px]"
                                >
                                  {tag}
                                </span>
                              ))}
                              {tags.length > 4 && (
                                <span className="text-[10px] text-muted-foreground">
                                  +{tags.length - 4}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-wide",
                            stagePillClasses(stage?.color)
                          )}
                        >
                          {stageLabel}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {phone || (
                          <span className="text-muted-foreground italic">
                            Sin teléfono
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{opp.source}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {opp.date}
                      </TableCell>
                      <TableCell className="text-right">
                        <Avatar className="h-6 w-6 ml-auto">
                          {avatar && <AvatarImage src={avatar} alt={opp.name} />}
                          <AvatarFallback>{opp.name.charAt(0)}</AvatarFallback>
                        </Avatar>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filteredOpps.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="text-center h-24 text-muted-foreground"
                    >
                      No se encontraron oportunidades.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Floating bulk-action toolbar — fixed position so it floats
          above whichever view is active (kanban OR list). Mirrors the
          prototype: count badge, "Mover a:" stage Select, optional
          bulk Delete, and Cancelar that clears the selection. */}
      {selectedOppIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 rounded-full border bg-card px-5 py-3 shadow-2xl ring-1 ring-primary/20 animate-in fade-in slide-in-from-bottom-4">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground">
              {selectedOppIds.size}
            </span>
            <span className="text-sm">
              seleccionado{selectedOppIds.size === 1 ? "" : "s"}
            </span>
          </div>
          <div className="h-5 w-px bg-border" />
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Mover a:</span>
            <Select
              // `value=""` is the placeholder state — set to a real
              // stage id only momentarily inside `onValueChange`.
              // Reset back to "" after the bulk move so picking the
              // same stage twice in a row still fires the handler.
              value=""
              onValueChange={(stageId) => {
                if (!stageId || !onMoveOpportunity) return;
                const ids = Array.from(selectedOppIds);
                for (const id of ids) onMoveOpportunity(id, stageId);
                clearOppSelection();
              }}
            >
              <SelectTrigger className="h-8 w-[180px] text-sm">
                <SelectValue placeholder="Seleccionar etapa" />
              </SelectTrigger>
              <SelectContent>
                {stages.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {onBulkDeleteOpportunities && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={async () => {
                const ids = Array.from(selectedOppIds);
                await onBulkDeleteOpportunities(ids);
                clearOppSelection();
              }}
            >
              Eliminar
            </Button>
          )}
          <button
            type="button"
            onClick={clearOppSelection}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancelar
          </button>
        </div>
      )}

      {/* Crear oportunidad dialog */}
      <Dialog
        open={isCreateOpen}
        onOpenChange={(open) => {
          // Don't let the user close mid-submit; otherwise the toast/state can
          // race with the dialog teardown.
          if (!isSubmitting) setIsCreateOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Crear oportunidad</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Contacto</Label>
              {uniqueContacts.length === 0 ? (
                <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground text-center">
                  No hay contactos cargados todavía. Abre la bandeja de
                  conversaciones primero para que aparezcan aquí.
                </div>
              ) : (
                <Select
                  value={newOppContactId}
                  onValueChange={(v) => {
                    setNewOppContactId(v);
                    // Auto-fill the opportunity name with the contact's
                    // display name on first selection so the agent doesn't
                    // have to retype it.
                    const c = uniqueContacts.find((x) => x.contactId === v);
                    if (c && !newOppName.trim()) setNewOppName(c.name);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona un contacto" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {uniqueContacts.map((c) => (
                      <SelectItem key={c.contactId} value={c.contactId}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="new-opp-name">Nombre de la oportunidad</Label>
              <Input
                id="new-opp-name"
                value={newOppName}
                onChange={(e) => setNewOppName(e.target.value)}
                placeholder="Ej. Cotización - Sept 2026"
              />
            </div>

            <div className="grid gap-2">
              <Label>Etapa</Label>
              <Select value={newOppStageId} onValueChange={setNewOppStageId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona una etapa" />
                </SelectTrigger>
                <SelectContent>
                  {stages.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      <div className="flex items-center gap-2">
                        <div className={cn("h-2 w-2 rounded-full", s.color)} />
                        <span>{s.label}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="new-opp-value">Valor monetario (opcional)</Label>
              <Input
                id="new-opp-value"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={newOppValue}
                onChange={(e) => setNewOppValue(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={isSubmitting}
              onClick={() => setIsCreateOpen(false)}
            >
              Cancelar
            </Button>
            <Button disabled={!canSubmit} onClick={handleSubmitCreate}>
              {isSubmitting ? (
                "Creando…"
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <Check className="h-4 w-4" />
                  Crear
                </span>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Nueva conversación — picker between Contacto and Bot. The
          Bot variant is a stub (the bot designer isn't wired yet); the
          Contacto variant drops into a small contact-picker inside the
          same modal and then calls onOpenChat to surface the chat
          modal Index.tsx already mounts for the kanban. */}
      <Dialog
        open={isNuevaConvOpen}
        onOpenChange={(open) => {
          setIsNuevaConvOpen(open);
          if (!open) {
            setNuevaConvStep("pick");
            setNuevaConvContactId("");
          }
        }}
      >
        <DialogContent className="sm:max-w-[640px] rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-center text-xl font-semibold">
              Nueva conversación
            </DialogTitle>
          </DialogHeader>
          {nuevaConvStep === "pick" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              <div className="flex flex-col items-center text-center rounded-2xl border bg-card p-6">
                <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                  <UserPlus className="h-10 w-10 text-primary" />
                </div>
                <h3 className="text-lg font-semibold">Contacto</h3>
                <p className="text-sm text-muted-foreground mt-1 mb-5">
                  Iniciar chat con un cliente o lead actual
                </p>
                <Button
                  variant="outline"
                  className="rounded-full px-6 border-primary text-primary hover:bg-primary hover:text-primary-foreground"
                  onClick={() => setNuevaConvStep("contact")}
                >
                  Seleccionar
                </Button>
              </div>
              <div className="flex flex-col items-center text-center rounded-2xl border bg-card p-6">
                <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                  <Bot className="h-10 w-10 text-primary" />
                </div>
                <h3 className="text-lg font-semibold">Bot</h3>
                <p className="text-sm text-muted-foreground mt-1 mb-5">
                  Configurar y probar un nuevo bot conversacional
                </p>
                <Button
                  variant="outline"
                  className="rounded-full px-6 border-primary text-primary hover:bg-primary hover:text-primary-foreground"
                  onClick={() => {
                    toast({
                      title: "Próximamente",
                      description:
                        "El diseñador de bots aún no está disponible.",
                    });
                  }}
                >
                  Seleccionar
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4 mt-4">
              <p className="text-sm text-muted-foreground">
                Elige un contacto de la lista para abrir su chat.
              </p>
              <Select
                value={nuevaConvContactId}
                onValueChange={(v) => setNuevaConvContactId(v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar contacto" />
                </SelectTrigger>
                <SelectContent>
                  {uniqueContacts.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      No hay contactos disponibles.
                    </div>
                  ) : (
                    uniqueContacts.map((c) => (
                      <SelectItem key={c.contactId} value={c.contactId}>
                        {c.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setNuevaConvStep("pick")}
                >
                  Volver
                </Button>
                <Button
                  disabled={!nuevaConvContactId || !onOpenChat}
                  onClick={() => {
                    if (!nuevaConvContactId || !onOpenChat) return;
                    onOpenChat(nuevaConvContactId);
                    setIsNuevaConvOpen(false);
                    setNuevaConvStep("pick");
                    setNuevaConvContactId("");
                  }}
                >
                  Abrir chat
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Agregar contacto — comprehensive form. Persists what the
          backend currently supports (name / phone / email via
          api.contacts.create), then chains the family relationships
          and an optional opportunity create when a stage is picked.
          Address / birthdate / document_number are captured on the
          form so the UI matches the design, but they need GHL custom-
          field plumbing on the backend before they round-trip; until
          then the values are silently dropped on submit. */}
      <Dialog
        open={isAgregarContactoOpen}
        onOpenChange={(open) => {
          if (isSubmittingContact) return;
          setIsAgregarContactoOpen(open);
          if (!open) resetAgregarContacto();
        }}
      >
        <DialogContent className="sm:max-w-[480px] rounded-2xl p-6 max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold">
              Agregar contacto
            </DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4 mt-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const name = newContactName.trim();
              const phone = newContactPhone.trim();
              if (!name || !phone) {
                toast({
                  title: "Información incompleta",
                  description: "Nombre y teléfono son obligatorios.",
                  variant: "destructive",
                });
                return;
              }
              if (!onCreateContact) {
                toast({
                  title: "No disponible",
                  description: "El backend no expone la creación de contactos.",
                  variant: "destructive",
                });
                return;
              }
              setIsSubmittingContact(true);
              try {
                const created = await onCreateContact({
                  name,
                  phone,
                  email: newContactEmail.trim() || undefined,
                });
                if (!created?.id) {
                  setIsSubmittingContact(false);
                  return; // parent handler already toasted on failure
                }
                // Link family members. Failures here log but don't
                // abort — the contact itself is already created.
                for (const member of newContactFamily) {
                  try {
                    await api.contacts.addFamily(created.id, member);
                  } catch (err) {
                    console.warn("family add failed", err);
                  }
                }
                // Optional opportunity when a stage was picked.
                if (newContactStageId && pipeline && onCreateOpportunity) {
                  try {
                    await onCreateOpportunity({
                      name,
                      contactId: created.id,
                      pipelineId: pipeline.id,
                      stageId: newContactStageId,
                    });
                  } catch (err) {
                    console.warn("opportunity create failed", err);
                  }
                }
                toast({
                  title: "Contacto agregado",
                  description:
                    "Aparecerá en la lista cuando GoHighLevel confirme el registro.",
                });
                setIsAgregarContactoOpen(false);
                resetAgregarContacto();
              } catch (err) {
                toast({
                  title: "No se pudo agregar el contacto",
                  description: String((err as Error)?.message ?? err),
                  variant: "destructive",
                });
                setIsSubmittingContact(false);
              }
            }}
          >
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">
                Nombre y apellido <span className="text-destructive">*</span>
              </Label>
              <Input
                value={newContactName}
                onChange={(e) => setNewContactName(e.target.value)}
                placeholder="Ej. Juan Pérez"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">
                Teléfono <span className="text-destructive">*</span>
              </Label>
              <Input
                value={newContactPhone}
                onChange={(e) => setNewContactPhone(e.target.value)}
                placeholder="Ej. +1 234 567 8900"
                inputMode="tel"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Email</Label>
              <Input
                value={newContactEmail}
                onChange={(e) => setNewContactEmail(e.target.value)}
                placeholder="Ej. juan@correo.com"
                inputMode="email"
                type="email"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Dirección</Label>
              <Input
                value={newContactAddress}
                onChange={(e) => setNewContactAddress(e.target.value)}
                placeholder="Ej. Calle 123, Ciudad"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Fecha de nacimiento</Label>
              <Input
                value={newContactBirthdate}
                onChange={(e) => setNewContactBirthdate(e.target.value)}
                type="date"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Número de documento</Label>
              <div className="flex gap-2">
                <Select
                  value={newContactDocType}
                  onValueChange={setNewContactDocType}
                >
                  <SelectTrigger className="w-[110px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CC">CC</SelectItem>
                    <SelectItem value="CE">CE</SelectItem>
                    <SelectItem value="NIT">NIT</SelectItem>
                    <SelectItem value="Pasaporte">Pasaporte</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={newContactDocNumber}
                  onChange={(e) => setNewContactDocNumber(e.target.value)}
                  placeholder="Número"
                  className="flex-1"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">
                  Familiares vinculados
                </Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-full h-8 px-3 text-xs"
                  onClick={() => {
                    setShowFamilyDraft(true);
                    setFamilyDraftName("");
                    setFamilyDraftPhone("");
                    setFamilyDraftRel("");
                  }}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Agregar familiar
                </Button>
              </div>
              {newContactFamily.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {newContactFamily.map((m, idx) => (
                    <li
                      key={idx}
                      className="flex items-center justify-between rounded-md border bg-muted/30 px-2 py-1.5"
                    >
                      <div className="flex flex-col min-w-0">
                        <span className="truncate text-foreground">{m.name}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {FAMILY_REL_LABELS[m.relationship]} · {m.phone}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setNewContactFamily((prev) =>
                            prev.filter((_, i) => i !== idx)
                          )
                        }
                        className="h-5 w-5 shrink-0 rounded-full hover:bg-muted-foreground/15 flex items-center justify-center text-muted-foreground"
                        aria-label="Eliminar"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {showFamilyDraft && (
                <div className="rounded-md border bg-muted/20 p-3 space-y-2">
                  <Input
                    value={familyDraftName}
                    onChange={(e) => setFamilyDraftName(e.target.value)}
                    placeholder="Nombre del familiar"
                    className="h-8 text-sm"
                  />
                  <Input
                    value={familyDraftPhone}
                    onChange={(e) => setFamilyDraftPhone(e.target.value)}
                    placeholder="Teléfono"
                    className="h-8 text-sm"
                    inputMode="tel"
                  />
                  <Select
                    value={familyDraftRel || undefined}
                    onValueChange={(v) =>
                      setFamilyDraftRel(v as DraftFamily["relationship"])
                    }
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="Parentesco" />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(FAMILY_REL_LABELS) as DraftFamily["relationship"][]).map(
                        (r) => (
                          <SelectItem key={r} value={r}>
                            {FAMILY_REL_LABELS[r]}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setShowFamilyDraft(false)}
                    >
                      Cancelar
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={
                        !familyDraftName.trim() ||
                        !familyDraftPhone.trim() ||
                        !familyDraftRel
                      }
                      onClick={() => {
                        setNewContactFamily((prev) => [
                          ...prev,
                          {
                            name: familyDraftName.trim(),
                            phone: familyDraftPhone.trim(),
                            relationship: familyDraftRel as DraftFamily["relationship"],
                          },
                        ]);
                        setShowFamilyDraft(false);
                      }}
                    >
                      Añadir
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Etapa de oportunidad</Label>
              <Select
                value={newContactStageId || undefined}
                onValueChange={(v) => setNewContactStageId(v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar etapa" />
                </SelectTrigger>
                <SelectContent>
                  {stages.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      No hay etapas disponibles.
                    </div>
                  ) : (
                    stages.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.label}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-full px-6"
                disabled={isSubmittingContact}
                onClick={() => {
                  setIsAgregarContactoOpen(false);
                  resetAgregarContacto();
                }}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                className="rounded-full px-6"
                disabled={
                  isSubmittingContact ||
                  !newContactName.trim() ||
                  !newContactPhone.trim()
                }
              >
                {isSubmittingContact ? "Guardando…" : "Guardar contacto"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
