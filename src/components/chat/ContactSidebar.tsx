import React, { useState, useRef, useEffect, KeyboardEvent } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChannelAvatar } from "./ChannelAvatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AgentUser, User, Conversation, FamilyMember, Message, Opportunity, TagSummary } from "./types";
import { cn } from "@/lib/utils";
import { TAB_LIST_CLASS, TAB_TRIGGER_CLASS } from "@/lib/tabStyles";
import { api, downloadAttachment } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ImageLightbox } from "./ImageLightbox";
import { VideoLightbox } from "./VideoLightbox";
import { ContactNote } from "./ContactNote";
import { Phone, Mail, Tag, Calendar, CheckSquare, Plus, BellOff, X, ChevronDown, Edit2, Trash2, FileIcon, ImageIcon, Download, MapPin, FileText, Users, Headphones, Link as LinkIcon, Play, Megaphone } from "lucide-react";

interface ContactSidebarProps {
  contact: User;
  conversation?: Conversation;
  onUpdateContactName?: (name: string) => void;
  // Agent roster from the bootstrap payload — populates the Propietario and
  // Seguidores dropdowns. Empty when GHL token lacks `users.readonly`.
  users?: AgentUser[];
  // Persist a change to the contact's owner. `userId` is null when clearing
  // the assignment (GHL accepts an empty string).
  onUpdateAssignedTo?: (userId: string | null) => void;
  // Persist the full new follower set. Always called with the complete list,
  // not a delta — keeps the backend store cleanly idempotent.
  onUpdateFollowers?: (userIds: string[]) => void;
  // The opportunity tied to this contact, when one exists. Drives the
  // business-status badge (Abierto / Perdido / Ganado / Abandonado) and the
  // adjacent monetary-value field. Undefined when the lead has no opportunity
  // yet — in that case the row is hidden rather than rendered as a no-op.
  opportunity?: Opportunity;
  // Patch one or more fields on an opportunity. The parent owns the optimistic
  // cache update + the GHL round-trip + the toast on failure.
  onUpdateOpportunity?: (
    id: string,
    patch: { status?: Opportunity["status"]; monetaryValue?: number }
  ) => void;
  // Spin up a brand-new GHL opportunity for the active contact when the
  // agent edits the empty-state status / monetary fields below. Parent
  // resolves the pipeline + stage defaults (we don't surface a picker
  // here — the sidebar just captures the user's intent and the parent
  // handles the create + later PATCH for non-`open` status).
  onCreateOpportunity?: (
    patch: { status?: Opportunity["status"]; monetaryValue?: number }
  ) => void;
  // Location-level tag library — fills the "Etiquetas" autocomplete with
  // existing GHL tag names so agents don't accidentally create casing
  // variants. Empty when the GHL token lacks `locations.readonly`; the
  // picker still works (typing a new name creates it on save).
  availableTags?: TagSummary[];
  // Persist the new full tag list for the contact. Parent owns the
  // optimistic update + the `PATCH /contacts/:id { tags }` round-trip;
  // GHL auto-creates any tag names it hasn't seen before.
  onUpdateTags?: (tags: string[]) => void;
  // Persist the "Información de Contacto" fields (Teléfono / Email /
  // Dirección / Num de documento). Parent owns the optimistic cache
  // update + the `PATCH /contacts/:id` round-trip. Only the touched
  // fields are sent; documentNumber carries the composed "CC 12345678"
  // string (doc-type prefix + number).
  onUpdateContactFields?: (patch: {
    phone?: string;
    email?: string;
    address?: string;
    documentNumber?: string;
  }) => void;
}

// Spanish labels for GHL's four opportunity statuses. "Abandonar" matches the
// design copy used elsewhere in the SPA (it's the verb infinitive, not the
// strict participle "Abandonado") so the UI stays consistent.
const STATUS_LABELS: Record<Opportunity["status"], string> = {
  open: "Abierto",
  won: "Ganado",
  lost: "Perdido",
  abandoned: "Abandonar",
};

// Visual treatment per status — kept compact so the badge fits inline next to
// the contact name. Open is the neutral default; the closed states pick up
// semantic colors that match the Kanban board elsewhere.
const STATUS_TRIGGER_CLASS: Record<Opportunity["status"], string> = {
  open: "border-slate-200 bg-slate-50 text-slate-700 dark:border-border dark:bg-muted/50 dark:text-foreground",
  won: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300",
  lost: "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300",
  abandoned: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300",
};

// Spanish labels for the four canonical family relationships plus the
// fallback "Otro" bucket. Matches the "Agregar familiar" mockup. Keep
// the keys aligned with FamilyMember["relationship"] on the wire side.
const FAMILY_RELATIONSHIP_LABELS: Record<
  FamilyMember["relationship"],
  string
> = {
  hijo: "Hijo(a)",
  padre: "Padre/Madre",
  esposo: "Esposo(a)",
  hermano: "Hermano(a)",
  otro: "Otro",
};

const FAMILY_RELATIONSHIP_ORDER: FamilyMember["relationship"][] = [
  "hijo",
  "padre",
  "esposo",
  "hermano",
  "otro",
];

// "S/ 0.00" — Peruvian Sol formatting. The locale gets thousand separators
// right; we keep two decimals always so the field doesn't shrink/grow as the
// user edits adjacent fields.
function formatMonetary(value: number | undefined): string {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return `S/ ${n.toLocaleString("es-PE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// Contact creation date for the subtitle under the name. Returns the Peru-time
// date ("Creado el 5 jun. 2026") or null when there's no valid timestamp.
function formatCreatedDate(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return `Creado el ${d.toLocaleDateString("es-PE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "America/Lima",
  })}`;
}

// One editable row in the "Información de Contacto" section.
type ContactField = {
  id: string;
  label: string;
  value: string;
  type: string;
  docType?: string;
};

// Split a stored documentNumber ("CC 12345678") back into its type + value
// parts for the editor. Falls back to type "CC" when no known prefix is
// present (e.g. a value typed straight into GHL).
function parseDocument(raw?: string): { docType: string; value: string } {
  const s = (raw ?? "").trim();
  const m = s.match(/^(CC|CE|NIT|Pasaporte)\s+([\s\S]+)$/);
  return m ? { docType: m[1], value: m[2].trim() } : { docType: "CC", value: s };
}

// Recompose the editor's type + number into the stored string. Empty number
// → empty string (clears the field on GHL).
function composeDocument(docType: string, value: string): string {
  const v = (value ?? "").trim();
  return v ? `${docType || "CC"} ${v}` : "";
}

// Build the editable field rows from the contact. Address comes from the
// GHL-native address1; the document number is parsed out of the custom-
// field string.
function buildContactFields(contact: User): ContactField[] {
  // "Dirección" and "Num de documento" removed from the panel by request —
  // form/campaign fields now surface under "Datos del formulario" instead.
  return [
    { id: "phone", label: "Teléfono", value: contact.phone || "", type: "phone" },
    { id: "email", label: "Email", value: contact.email || "", type: "email" },
  ];
}

// Map the field rows to the PATCH payload the parent persists.
function fieldsToContactPatch(list: ContactField[]): {
  phone?: string;
  email?: string;
  address?: string;
  documentNumber?: string;
} {
  const byId: Record<string, ContactField> = {};
  for (const f of list) byId[f.id] = f;
  const docField = byId.document;
  return {
    phone: (byId.phone?.value ?? "").trim(),
    email: (byId.email?.value ?? "").trim(),
    address: (byId.address?.value ?? "").trim(),
    documentNumber: composeDocument(docField?.docType, docField?.value ?? ""),
  };
}

export function ContactSidebar({
  contact,
  conversation,
  onUpdateContactName,
  users = [],
  onUpdateAssignedTo,
  onUpdateFollowers,
  opportunity,
  onUpdateOpportunity,
  onCreateOpportunity,
  availableTags = [],
  onUpdateTags,
  onUpdateContactFields,
}: ContactSidebarProps) {
  // Local draft of the monetary value while the input is focused. We commit
  // (and round-trip to GHL) on blur or Enter — keystroke-level PATCHes would
  // flood the API. Null = "not editing, display the prop value".
  const [monetaryDraft, setMonetaryDraft] = useState<string | null>(null);
  // When the parent prop changes (WS echo, optimistic update settles), drop
  // the draft so the display falls back to the canonical value.
  useEffect(() => {
    setMonetaryDraft(null);
  }, [opportunity?.id, opportunity?.monetaryValue]);

  const commitMonetary = () => {
    if (monetaryDraft === null || !opportunity || !onUpdateOpportunity) {
      setMonetaryDraft(null);
      return;
    }
    // Accept "1,234.56" / "1234.56" / "1234,56"; strip the currency prefix
    // if the user retyped it.
    const cleaned = monetaryDraft.replace(/[^\d.,-]/g, "").replace(/,/g, "");
    const parsed = Number.parseFloat(cleaned);
    const next = Number.isFinite(parsed) ? parsed : 0;
    setMonetaryDraft(null);
    if (next === (opportunity.monetaryValue ?? 0)) return;
    onUpdateOpportunity(opportunity.id, { monetaryValue: next });
  };
  const [tags, setTags] = useState<string[]>(contact.tags || []);
  const [newTag, setNewTag] = useState("");
  const [isAddingTag, setIsAddingTag] = useState(false);

  // "Agregar familiar" modal — name + phone create a brand-new GHL
  // contact and the link is stored locally (see backend FamilyRelation
  // model). The list is sourced from `contact.familyMembers` so a
  // server-side refresh (lead.updated webhook, switching contacts)
  // always reconciles; the local state below just smooths the
  // optimistic insert before the response lands.
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>(
    contact.familyMembers ?? []
  );
  const [isFamilyDialogOpen, setIsFamilyDialogOpen] = useState(false);
  // null = the dialog is in "add" mode; a relation id = editing that member.
  const [editingFamilyId, setEditingFamilyId] = useState<string | null>(null);
  const [familyName, setFamilyName] = useState("");
  const [familyPhone, setFamilyPhone] = useState("");
  const [familyRelationship, setFamilyRelationship] =
    useState<FamilyMember["relationship"] | "">("");
  const [familySaving, setFamilySaving] = useState(false);
  const { toast } = useToast();

  // Re-sync from the prop whenever we switch contacts or the bundle is
  // refetched (webhook, manual refresh). Without this the list would
  // ghost the previous lead's family after the active id flips.
  //
  // The bootstrap payload does NOT include `familyMembers` on its
  // conversations (avoids fanning out a Prisma + GHL denormalise per
  // contact on every page load), so on a cold reload `contact.familyMembers`
  // is undefined even when rows exist on disk. We backfill with a single
  // GET /contacts/:id/family on contact change so the list always shows
  // the persisted state. Subsequent webhooks / lead.updated events that
  // do carry familyMembers will still take precedence.
  useEffect(() => {
    setFamilyMembers(contact.familyMembers ?? []);
    let cancelled = false;
    api.contacts
      .listFamily(contact.id)
      .then((members) => {
        if (cancelled) return;
        setFamilyMembers(members);
      })
      .catch((err) => {
        // Best-effort — stay with whatever the prop gave us. A toast
        // here would be noisy because this fires on every contact change.
        console.warn("[family] listFamily failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, [contact.id, contact.familyMembers]);

  // "Documentos" right-rail tabs (Imagen / Doc / Enlaces / Multimedia).
  // The conversation cache only holds the lazily-loaded message window, so
  // older uploads would otherwise be invisible. Fetch the full attachment
  // history for the contact whenever it changes, and seed it with whatever
  // the conversation cache happens to already know so the tabs aren't
  // empty during the fetch.
  const seededAttachments: Message[] = (conversation?.messages ?? []).filter(
    (m) => Boolean(m.attachment)
  );
  const [allAttachments, setAllAttachments] = useState<Message[]>(seededAttachments);
  useEffect(() => {
    setAllAttachments(
      (conversation?.messages ?? []).filter((m) => Boolean(m.attachment))
    );
    let cancelled = false;
    api.contacts
      .attachments(contact.id)
      .then((messages) => {
        if (cancelled) return;
        setAllAttachments(messages);
      })
      .catch((err) => {
        console.warn("[attachments] fetch failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, [contact.id]);

  // Keep the Documentos tabs live: when a new attachment-bearing message
  // arrives in the open conversation (e.g. the agent just sent a voice
  // note or image), merge it into `allAttachments` immediately instead of
  // waiting for the next contact switch to re-fetch. Deduped by message
  // id and kept newest-first to match the backend ordering.
  useEffect(() => {
    const convAttachments = (conversation?.messages ?? []).filter((m) =>
      Boolean(m.attachment)
    );
    if (convAttachments.length === 0) return;
    setAllAttachments((prev) => {
      const ids = new Set(prev.map((m) => m.id));
      const fresh = convAttachments.filter((m) => !ids.has(m.id));
      if (fresh.length === 0) return prev;
      const merged = [...fresh, ...prev];
      merged.sort((a, b) => {
        const ta = a.date ? new Date(a.date).getTime() : 0;
        const tb = b.date ? new Date(b.date).getTime() : 0;
        return tb - ta;
      });
      return merged;
    });
  }, [conversation?.messages]);

  const resetFamilyDialog = () => {
    setEditingFamilyId(null);
    setFamilyName("");
    setFamilyPhone("");
    setFamilyRelationship("");
    setFamilySaving(false);
  };

  // Open the dialog pre-filled to edit an existing family member.
  const openEditFamilyDialog = (m: FamilyMember) => {
    setEditingFamilyId(m.id);
    setFamilyName(m.name);
    setFamilyPhone(m.phone ?? "");
    setFamilyRelationship(m.relationship);
    setFamilySaving(false);
    setIsFamilyDialogOpen(true);
  };

  const handleSaveFamilyMember = async () => {
    if (editingFamilyId) {
      await handleEditFamilyMember();
    } else {
      await handleAddFamilyMember();
    }
  };

  const handleEditFamilyMember = async () => {
    const name = familyName.trim();
    const phone = familyPhone.trim();
    if (!name || !familyRelationship || !editingFamilyId) return;
    setFamilySaving(true);
    try {
      const updated = await api.contacts.updateFamily(
        contact.id,
        editingFamilyId,
        { name, phone: phone || undefined, relationship: familyRelationship }
      );
      setFamilyMembers((prev) =>
        prev.map((m) => (m.id === updated.id ? updated : m))
      );
      setIsFamilyDialogOpen(false);
      resetFamilyDialog();
      toast({
        title: "Familiar actualizado",
        description: `${updated.name} ahora aparece como ${
          FAMILY_RELATIONSHIP_LABELS[updated.relationship]
        }.`,
      });
    } catch (err) {
      toast({
        title: "No se pudo actualizar el familiar",
        description:
          (err as Error)?.message || "Verifica los datos e inténtalo de nuevo.",
        variant: "destructive",
      });
      setFamilySaving(false);
    }
  };

  const handleAddFamilyMember = async () => {
    const name = familyName.trim();
    const phone = familyPhone.trim();
    // Phone is optional; only name and relationship are required.
    if (!name || !familyRelationship) return;
    setFamilySaving(true);
    try {
      const created = await api.contacts.addFamily(contact.id, {
        name,
        phone: phone || undefined,
        relationship: familyRelationship,
      });
      setFamilyMembers((prev) => [...prev, created]);
      setIsFamilyDialogOpen(false);
      resetFamilyDialog();
      toast({
        title: "Familiar agregado",
        description: `${created.name} ahora aparece como ${
          FAMILY_RELATIONSHIP_LABELS[created.relationship]
        }.`,
      });
    } catch (err) {
      toast({
        title: "No se pudo agregar el familiar",
        description:
          (err as Error)?.message || "Verifica los datos e inténtalo de nuevo.",
        variant: "destructive",
      });
      setFamilySaving(false);
    }
  };

  const handleRemoveFamilyMember = async (relationId: string) => {
    const before = familyMembers;
    setFamilyMembers((prev) => prev.filter((m) => m.id !== relationId));
    try {
      await api.contacts.removeFamily(contact.id, relationId);
    } catch (err) {
      // Rollback the optimistic remove on failure.
      setFamilyMembers(before);
      toast({
        title: "No se pudo eliminar el familiar",
        description: (err as Error)?.message || "Inténtalo de nuevo.",
        variant: "destructive",
      });
    }
  };
  // Owner / followers are driven by the live contact prop. We mirror them
  // into local state for optimistic updates so the dropdowns feel responsive
  // even before the PATCH round-trips.
  const [selectedOwner, setSelectedOwner] = useState<string>(contact.assignedTo ?? "");
  const [selectedFollowers, setSelectedFollowers] = useState<string[]>(contact.followers ?? []);
  // Convenience map for avatar/name lookups in the trigger renderers.
  const usersById = React.useMemo(
    () => new Map(users.map((u) => [u.id, u])),
    [users]
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const [isEditingFields, setIsEditingFields] = useState(false);
  // Note: the legacy inline "Parentesco" field has been removed from this
  // list — it's now a dedicated section below "Información de Contacto"
  // backed by the FamilyRelation Prisma table (see "Agregar familiar"
  // modal). Keeping the field here would render two parallel UIs for
  // the same concept and confuse the agent.
  const [fields, setFields] = useState<ContactField[]>(() => buildContactFields(contact));

  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(contact.name);

  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [editedFieldValue, setEditedFieldValue] = useState("");
  const [editedDocType, setEditedDocType] = useState("CC");

  const handleEditFieldStart = (field: ContactField) => {
    setEditingFieldId(field.id);
    setEditedFieldValue(field.value);
    if (field.type === 'document') {
      setEditedDocType(field.docType || 'CC');
    }
  };

  const handleEditFieldSave = () => {
    if (editingFieldId) {
      const next = fields.map(f => {
        if (f.id === editingFieldId) {
          return { ...f, value: editedFieldValue, ...(f.type === 'document' ? { docType: editedDocType } : {}) };
        }
        return f;
      });
      setFields(next);
      // Persist to GHL via the parent (optimistic cache update + PATCH).
      onUpdateContactFields?.(fieldsToContactPatch(next));
    }
    setEditingFieldId(null);
  };

  const handleEditFieldKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleEditFieldSave();
    } else if (e.key === "Escape") {
      setEditingFieldId(null);
    }
  };

  useEffect(() => {
    setTags(contact.tags || []);
    setFields(buildContactFields(contact));
    // Re-sync when any displayed contact field changes — including the
    // address / documentNumber that the parent lazily enriches via
    // api.contacts.get after a conversation is opened or refreshed.
  }, [contact.tags, contact.phone, contact.email, contact.address, contact.documentNumber]);

  useEffect(() => {
    setEditedName(contact.name);
  }, [contact.name]);

  // Re-sync owner/followers whenever we switch contacts or a WS event
  // patches the active one. We do this in a dedicated effect (rather than
  // initial useState only) so the UI never lags the cache after a webhook
  // refresh or after the user picks a different lead.
  useEffect(() => {
    setSelectedOwner(contact.assignedTo ?? "");
  }, [contact.id, contact.assignedTo]);
  useEffect(() => {
    setSelectedFollowers(contact.followers ?? []);
  }, [contact.id, contact.followers]);

  const handleOwnerChange = (value: string) => {
    // The Select fires onValueChange even when the user re-picks the same
    // entry — guard so we don't spam the backend with no-ops.
    if (value === selectedOwner) return;
    setSelectedOwner(value);
    // Empty string is the "clear owner" sentinel: the backend forwards it as
    // an empty assignedTo to GHL, which removes the assignment.
    onUpdateAssignedTo?.(value || null);
  };

  const handleToggleFollower = (userId: string, checked: boolean) => {
    const next = checked
      ? Array.from(new Set([...selectedFollowers, userId]))
      : selectedFollowers.filter((id) => id !== userId);
    setSelectedFollowers(next);
    onUpdateFollowers?.(next);
  };

  const handleNameSave = () => {
    if (editedName.trim() && editedName !== contact.name) {
      onUpdateContactName?.(editedName.trim());
    } else {
      setEditedName(contact.name);
    }
    setIsEditingName(false);
  };
  
  const handleNameKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleNameSave();
    } else if (e.key === "Escape") {
      setEditedName(contact.name);
      setIsEditingName(false);
    }
  };

  // Highlighted item in the autocomplete dropdown. Reset whenever the
  // query changes so the first match is always preselected after typing.
  const [tagSuggestionIdx, setTagSuggestionIdx] = useState(0);

  // Full list of matching GHL location tags (unbounded). The dropdown
  // pages through this with infinite scroll — the rendered slice grows
  // as the user nears the bottom of the popup. Sorted alphabetically so
  // the order is stable as new chunks come into view.
  const tagSuggestionsAll = React.useMemo<TagSummary[]>(() => {
    const norm = (s: string) =>
      s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const onContact = new Set(tags.map((t) => norm(t)));
    const q = norm(newTag.trim());
    const filtered = availableTags.filter((t) => {
      if (onContact.has(norm(t.name))) return false;
      if (!q) return true;
      return norm(t.name).includes(q);
    });
    return [...filtered].sort((a, b) =>
      norm(a.name).localeCompare(norm(b.name))
    );
  }, [availableTags, tags, newTag]);

  // Infinite-scroll window. Grows by TAG_PAGE_SIZE each time the user
  // scrolls within ~24px of the bottom of the suggestions container.
  const TAG_PAGE_SIZE = 30;
  const [tagPageLimit, setTagPageLimit] = useState(TAG_PAGE_SIZE);
  // Reset the visible window whenever the underlying list changes
  // (filter typed, tag added/removed) so we always start at the top.
  useEffect(() => {
    setTagPageLimit(TAG_PAGE_SIZE);
  }, [newTag, tagSuggestionsAll.length]);
  const tagSuggestions = React.useMemo<TagSummary[]>(
    () => tagSuggestionsAll.slice(0, tagPageLimit),
    [tagSuggestionsAll, tagPageLimit]
  );
  const handleTagListScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 24) {
      setTagPageLimit((prev) =>
        prev < tagSuggestionsAll.length
          ? Math.min(prev + TAG_PAGE_SIZE, tagSuggestionsAll.length)
          : prev
      );
    }
  };

  // Whether the typed text would create a brand-new tag (no exact case-
  // insensitive match in either the contact's tags or the location
  // library). Drives the "Crear «<query>»" row at the bottom of the
  // dropdown.
  const canCreateNewTag = React.useMemo(() => {
    const trimmed = newTag.trim();
    if (!trimmed) return false;
    const q = trimmed.toLowerCase();
    if (tags.some((t) => t.toLowerCase() === q)) return false;
    if (availableTags.some((t) => t.name.toLowerCase() === q)) return false;
    return true;
  }, [newTag, tags, availableTags]);

  // Commit a single tag — either an existing one picked from the dropdown
  // or a brand-new name typed by the user. Optimistically updates local
  // state so the pill appears instantly; the parent fires the PATCH and
  // reconciles from the server response.
  const commitTag = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNewTag("");
      return;
    }
    // Case-insensitive dedup against the existing set.
    if (tags.some((t) => t.toLowerCase() === trimmed.toLowerCase())) {
      setNewTag("");
      setTagSuggestionIdx(0);
      return;
    }
    const next = [...tags, trimmed];
    setTags(next);
    onUpdateTags?.(next);
    setNewTag("");
    setTagSuggestionIdx(0);
    // Keep the input open so the agent can add a second tag without
    // re-clicking the + button — matches the GHL UX in the screenshot.
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleAddTag = () => {
    // Called from the input's onBlur — only commit if the user actually
    // typed something. Clicking a dropdown row commits via `commitTag`
    // before blur fires (mousedown handler).
    if (newTag.trim()) {
      commitTag(newTag);
    } else {
      setIsAddingTag(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Dropdown navigation when there are visible rows.
    const total = tagSuggestions.length + (canCreateNewTag ? 1 : 0);
    if (total > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setTagSuggestionIdx((i) => (i + 1) % total);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setTagSuggestionIdx((i) => (i <= 0 ? total - 1 : i - 1));
        return;
      }
    }
    if (e.key === "Enter") {
      e.preventDefault();
      // Prefer the highlighted suggestion when available; fall back to
      // creating a tag from the raw typed text.
      if (tagSuggestionIdx < tagSuggestions.length) {
        commitTag(tagSuggestions[tagSuggestionIdx].name);
      } else if (canCreateNewTag) {
        commitTag(newTag);
      }
    } else if (e.key === "Escape") {
      setNewTag("");
      setIsAddingTag(false);
    }
  };

  const removeTag = (tagToRemove: string) => {
    const next = tags.filter((tag) => tag !== tagToRemove);
    setTags(next);
    onUpdateTags?.(next);
  };
  return (
    <div className="flex h-full w-full flex-col border-l bg-card text-card-foreground overflow-hidden">
      <ScrollArea className="flex-1">
        <div className="flex flex-col items-center p-6 text-center">
          <ChannelAvatar 
            name={contact.name} 
            src={contact.avatar} 
            status={contact.status}
            className="h-24 w-24 mb-4"
          />
          {isEditingName ? (
            <input
              autoFocus
              className="text-xl font-bold text-center bg-transparent border-b border-primary focus:outline-none mb-1 w-full max-w-[200px] px-2"
              value={editedName}
              onChange={(e) => setEditedName(e.target.value)}
              onBlur={handleNameSave}
              onKeyDown={handleNameKeyDown}
            />
          ) : (
            <div 
              className="group relative flex items-center justify-center gap-2 cursor-pointer w-full mb-1 rounded-md hover:bg-muted/50 p-1 -mx-1"
              onClick={() => setIsEditingName(true)}
            >
              <h2 className="text-xl font-bold">{contact.name}</h2>
              <Edit2 className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity absolute right-4 sm:right-8" />
            </div>
          )}
          <p className="text-sm text-muted-foreground mb-4">
            {formatCreatedDate(contact.createdAt) ?? "Lead"}
          </p>

          {/* Opportunity status + monetary chip. Rendered for every lead so
              the sidebar layout doesn't jump when toggling between a lead
              that has an opportunity and one that doesn't. When the contact
              has no GHL opportunity yet, both fields are EDITABLE empty-
              state stubs: picking a status or committing a monetary value
              spins up a brand-new opportunity (via onCreateOpportunity) on
              the parent's default pipeline + stage. Once the create-then-
              hydrate round-trip lands the opportunity in state, the next
              render switches to the regular update path. */}
          <div className="flex items-center justify-center gap-2 w-full mb-4">
            <Select
              value={opportunity ? opportunity.status : ""}
              onValueChange={(v) => {
                const next = v as Opportunity["status"];
                if (opportunity) {
                  if (next === opportunity.status || !onUpdateOpportunity) return;
                  onUpdateOpportunity(opportunity.id, { status: next });
                } else if (onCreateOpportunity) {
                  onCreateOpportunity({ status: next });
                }
              }}
            >
              <SelectTrigger
                className={
                  opportunity
                    ? `h-9 w-auto min-w-[120px] flex-shrink-0 rounded-md border px-3 text-sm font-medium ${STATUS_TRIGGER_CLASS[opportunity.status]}`
                    : "h-9 w-auto min-w-[120px] flex-shrink-0 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-400 dark:border-border dark:bg-muted/50 dark:text-muted-foreground"
                }
                aria-label="Estado de la oportunidad"
              >
                <SelectValue placeholder="—">
                  {opportunity ? STATUS_LABELS[opportunity.status] : "—"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(STATUS_LABELS) as Opportunity["status"][]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative">
              <input
                type="text"
                inputMode="decimal"
                value={
                  opportunity
                    ? monetaryDraft !== null
                      ? monetaryDraft
                      : formatMonetary(opportunity.monetaryValue)
                    : monetaryDraft !== null
                      ? monetaryDraft
                      : ""
                }
                placeholder={opportunity ? undefined : "—"}
                onFocus={(e) => {
                  if (opportunity) {
                    setMonetaryDraft(String(opportunity.monetaryValue ?? 0));
                  } else {
                    // No opportunity yet — start the draft blank so the
                    // agent can just type the amount they want.
                    setMonetaryDraft("");
                  }
                  // Pre-select so the user can just type to overwrite.
                  requestAnimationFrame(() => e.target.select());
                }}
                onChange={(e) => setMonetaryDraft(e.target.value)}
                onBlur={() => {
                  if (opportunity) {
                    commitMonetary();
                    return;
                  }
                  // Empty-state commit: only spin up an opportunity when
                  // the agent actually typed a positive number. A blank
                  // blur or "0" keeps the placeholder behaviour from
                  // creating spurious GHL rows.
                  if (monetaryDraft === null || !onCreateOpportunity) {
                    setMonetaryDraft(null);
                    return;
                  }
                  const next = Number(monetaryDraft.replace(/[^\d.-]/g, ""));
                  setMonetaryDraft(null);
                  if (!Number.isFinite(next) || next <= 0) return;
                  onCreateOpportunity({ monetaryValue: next });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.currentTarget.blur();
                  } else if (e.key === "Escape") {
                    setMonetaryDraft(null);
                    e.currentTarget.blur();
                  }
                }}
                className="h-9 w-[110px] rounded-md border border-slate-200 bg-slate-50 px-3 text-center text-sm font-medium text-slate-700 outline-none focus:border-primary focus:ring-1 focus:ring-primary dark:border-border dark:bg-muted/50 dark:text-foreground"
                aria-label="Valor monetario"
              />
            </div>
          </div>

        </div>

        <Separator />

        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Etiquetas</h3>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setIsAddingTag(true); setTimeout(() => inputRef.current?.focus(), 0); }}><Plus className="h-4 w-4" /></Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="font-normal group pr-1.5 flex items-center gap-1">
                {tag}
                <button 
                  onClick={() => removeTag(tag)}
                  className="h-3.5 w-3.5 rounded-full hover:bg-muted-foreground/20 flex items-center justify-center text-muted-foreground opacity-50 group-hover:opacity-100 transition-opacity"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </Badge>
            ))}
            {isAddingTag ? (
              <div className="relative inline-block">
                <input
                  ref={inputRef}
                  type="text"
                  value={newTag}
                  onChange={(e) => {
                    setNewTag(e.target.value);
                    setTagSuggestionIdx(0);
                  }}
                  onKeyDown={handleKeyDown}
                  onBlur={handleAddTag}
                  className="inline-flex h-[22px] w-[120px] items-center rounded-md border border-input bg-transparent px-2 text-xs font-normal focus:outline-none focus:ring-1 focus:ring-ring"
                  placeholder="Escribir..."
                />
                {(tagSuggestions.length > 0 || canCreateNewTag) && (
                  <div
                    // Mouse-down inside the dropdown shouldn't blur the
                    // input — without this preventDefault the suggestion
                    // click would race the onBlur commit and lose.
                    onMouseDown={(e) => e.preventDefault()}
                    className="absolute left-0 top-full z-50 mt-1 w-[220px] max-w-[calc(100vw-2rem)] rounded-md border bg-popover shadow-lg animate-in fade-in slide-in-from-top-1 overflow-hidden"
                  >
                    {tagSuggestions.length > 0 && (
                      <>
                        <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Sugerencias
                        </div>
                        <div
                          className="max-h-[220px] overflow-y-auto pb-1"
                          onScroll={handleTagListScroll}
                        >
                          {tagSuggestions.map((s, idx) => {
                            const isActive = idx === tagSuggestionIdx;
                            return (
                              <button
                                key={s.id}
                                type="button"
                                onClick={() => commitTag(s.name)}
                                onMouseEnter={() => setTagSuggestionIdx(idx)}
                                className={cn(
                                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors",
                                  isActive ? "bg-accent" : "hover:bg-accent/60"
                                )}
                              >
                                <Tag className="h-3 w-3 shrink-0 text-muted-foreground" />
                                <span className="truncate text-foreground">
                                  {s.name}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}
                    {canCreateNewTag && (
                      <button
                        type="button"
                        onClick={() => commitTag(newTag)}
                        onMouseEnter={() =>
                          setTagSuggestionIdx(tagSuggestions.length)
                        }
                        className={cn(
                          "flex w-full items-center gap-2 border-t px-3 py-2 text-left text-xs transition-colors",
                          tagSuggestionIdx === tagSuggestions.length
                            ? "bg-accent"
                            : "hover:bg-accent/60"
                        )}
                      >
                        <Plus className="h-3 w-3 shrink-0 text-primary" />
                        <span className="text-foreground">
                          Crear{" "}
                          <span className="font-semibold">
                            «{newTag.trim()}»
                          </span>
                        </span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={() => { setIsAddingTag(true); setTimeout(() => inputRef.current?.focus(), 0); }}
                className="inline-flex h-[22px] items-center rounded-md border border-dashed border-input bg-transparent px-2 text-xs font-normal text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
              >
                <Plus className="mr-1 h-3 w-3" /> Añadir
              </button>
            )}
          </div>
        </div>

        <Separator />

        <div className="p-4 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Información de Contacto</h3>
            </div>
            
            {isEditingFields ? (
              <div className="space-y-3">
                {fields.map((field, index) => (
                  <div key={field.id} className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <input 
                        value={field.label} 
                        onChange={(e) => {
                          const newFields = [...fields];
                          newFields[index].label = e.target.value;
                          setFields(newFields);
                        }} 
                        className="h-8 w-1/3 rounded-md border border-input bg-transparent px-2 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                        placeholder="Etiqueta"
                        disabled={['phone', 'email', 'address', 'document', 'relationship'].includes(field.id)}
                      />
                      
                      {field.type === 'document' ? (
                        <div className="flex flex-1 gap-1">
                          <Select 
                            value={field.docType || 'CC'} 
                            onValueChange={(val) => {
                              const newFields = [...fields];
                              newFields[index].docType = val;
                              setFields(newFields);
                            }}
                          >
                            <SelectTrigger className="h-8 w-[70px] text-xs px-2 border-input bg-transparent">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="CC">CC</SelectItem>
                              <SelectItem value="CE">CE</SelectItem>
                              <SelectItem value="NIT">NIT</SelectItem>
                              <SelectItem value="Pasaporte">Pasaporte</SelectItem>
                            </SelectContent>
                          </Select>
                          <input 
                            value={field.value} 
                            onChange={(e) => {
                              const newFields = [...fields];
                              newFields[index].value = e.target.value;
                              setFields(newFields);
                            }} 
                            className="h-8 flex-1 rounded-md border border-input bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                            placeholder="Número"
                          />
                        </div>
                      ) : field.type === 'relationship' ? (
                        <Select 
                          value={field.value} 
                          onValueChange={(val) => {
                            const newFields = [...fields];
                            newFields[index].value = val;
                            setFields(newFields);
                          }}
                        >
                          <SelectTrigger className="h-8 flex-1 text-xs px-2 border-input bg-transparent">
                            <SelectValue placeholder="Seleccionar" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Hijo(a)">Hijo(a)</SelectItem>
                            <SelectItem value="Padre/Madre">Padre/Madre</SelectItem>
                            <SelectItem value="Esposo(a)">Esposo(a)</SelectItem>
                            <SelectItem value="Hermano(a)">Hermano(a)</SelectItem>
                            <SelectItem value="Otro">Otro</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <input 
                          value={field.value} 
                          onChange={(e) => {
                            const newFields = [...fields];
                            newFields[index].value = e.target.value;
                            setFields(newFields);
                          }} 
                          className="h-8 flex-1 rounded-md border border-input bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                          placeholder="Valor"
                        />
                      )}

                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0" onClick={() => {
                        setFields(fields.filter(f => f.id !== field.id));
                      }}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
                {/* "Agregar campo" intentionally removed — per product
                    spec 4.4, agents tended to create one-off custom
                    fields that turned the contact panel into a mess of
                    inconsistent information across leads. The predefined
                    set (Teléfono / Email / Dirección / Num de documento)
                    is now closed; new structured data should be modelled
                    as GHL custom fields by an admin, not added ad-hoc
                    per-contact in the SPA. */}
                <div className="pt-2">
                  <Button
                    size="sm"
                    className="w-full h-8 text-xs"
                    onClick={() => {
                      // Persist every field to GHL, then close the editor.
                      onUpdateContactFields?.(fieldsToContactPatch(fields));
                      setIsEditingFields(false);
                    }}
                  >
                    Guardar cambios
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-1 text-sm">
                {fields.map(field => (
                  <div 
                    key={field.id} 
                    className="flex items-center justify-between gap-4 group relative rounded-md hover:bg-muted/50 p-2 -mx-2 cursor-pointer transition-colors"
                    onClick={() => editingFieldId !== field.id && handleEditFieldStart(field)}
                  >
                    <span className="text-muted-foreground flex items-center gap-2 shrink-0">
                      {field.type === 'phone' && <Phone className="h-4 w-4" />}
                      {field.type === 'email' && <Mail className="h-4 w-4" />}
                      {field.type === 'address' && <MapPin className="h-4 w-4" />}
                      {field.type === 'document' && <FileText className="h-4 w-4" />}
                      {field.type === 'relationship' && <Users className="h-4 w-4" />}
                      {field.type === 'custom' && <Tag className="h-4 w-4" />}
                      {field.label}
                    </span>
                    
                    {editingFieldId === field.id ? (
                      field.type === 'document' ? (
                        <div 
                          className="flex flex-1 gap-1 justify-end ml-4" 
                          onClick={(e) => e.stopPropagation()}
                          onBlur={(e) => {
                            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                              handleEditFieldSave();
                            }
                          }}
                        >
                          <Select 
                            value={editedDocType} 
                            onValueChange={(val) => {
                              setEditedDocType(val);
                              // We can also auto-save when doc type changes if we want, but let's just update state
                            }}
                          >
                            <SelectTrigger className="h-7 w-[70px] text-xs px-2 border-input bg-background">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="CC">CC</SelectItem>
                              <SelectItem value="CE">CE</SelectItem>
                              <SelectItem value="NIT">NIT</SelectItem>
                              <SelectItem value="Pasaporte">Pasaporte</SelectItem>
                            </SelectContent>
                          </Select>
                          <input 
                            autoFocus
                            value={editedFieldValue} 
                            onChange={(e) => setEditedFieldValue(e.target.value)}
                            onKeyDown={handleEditFieldKeyDown}
                            className="h-7 flex-1 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring text-right w-full min-w-[100px]"
                            placeholder="Número"
                          />
                        </div>
                      ) : field.type === 'relationship' ? (
                        <div className="flex-1 ml-4 justify-end flex" onClick={(e) => e.stopPropagation()}>
                          <Select 
                            value={editedFieldValue} 
                            onValueChange={(val) => {
                              setEditedFieldValue(val);
                              setFields(fields.map(f => f.id === field.id ? { ...f, value: val } : f));
                              setEditingFieldId(null);
                            }}
                          >
                            <SelectTrigger className="h-7 w-full max-w-[150px] text-xs px-2 border-input bg-background" autoFocus>
                              <SelectValue placeholder="Seleccionar" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Hijo(a)">Hijo(a)</SelectItem>
                              <SelectItem value="Padre/Madre">Padre/Madre</SelectItem>
                              <SelectItem value="Esposo(a)">Esposo(a)</SelectItem>
                              <SelectItem value="Hermano(a)">Hermano(a)</SelectItem>
                              <SelectItem value="Otro">Otro</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      ) : (
                        <div className="flex-1 ml-4" onClick={(e) => e.stopPropagation()}>
                           <input 
                              autoFocus
                              value={editedFieldValue} 
                              onChange={(e) => setEditedFieldValue(e.target.value)}
                              onBlur={handleEditFieldSave}
                              onKeyDown={handleEditFieldKeyDown}
                              className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring text-right"
                              placeholder="Valor"
                            />
                        </div>
                      )
                    ) : (
                      <div className="flex items-center gap-2 flex-1 justify-end overflow-hidden">
                        <span className="font-medium text-right truncate text-foreground/80">
                          {field.value 
                            ? (field.type === 'document' ? `${field.docType || 'CC'} ${field.value}` : field.value) 
                            : <span className="text-muted-foreground/50 italic">Vacío</span>}
                        </span>
                        <Edit2 className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                      </div>
                    )}
                  </div>
                ))}
                {fields.length === 0 && (
                  <span className="text-muted-foreground text-xs italic">Sin información</span>
                )}
                {(contact.customFields ?? []).length > 0 && (
                  <div className="mt-2 space-y-1 border-t border-border/40 pt-2">
                    <p className="px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">
                      Datos del formulario
                    </p>
                    {contact.customFields!.map((cf) => (
                      <div
                        key={cf.id}
                        className="flex items-start justify-between gap-4 rounded-md p-2 -mx-2"
                      >
                        <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                          <Tag className="h-4 w-4" />
                          {cf.name}
                        </span>
                        <span className="break-words text-right font-medium text-foreground/80">
                          {cf.value}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {/* "Campaña / Origen" (attribution) intentionally removed — the
                    team found the source/medium fields confusing and only wants
                    the form data shown above. */}
              </div>
            )}
          </div>
        </div>

        <Separator />

        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Users className="h-4 w-4" />
              <span>Parentesco</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-primary hover:bg-primary/10"
              onClick={() => {
                resetFamilyDialog();
                setIsFamilyDialogOpen(true);
              }}
              aria-label="Agregar familiar"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          {familyMembers.length > 0 && (
            <ul className="space-y-1 text-sm">
              {familyMembers.map((m) => (
                <li
                  key={m.id}
                  className="group flex items-center justify-between gap-2 rounded-md px-2 -mx-2 py-1.5 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-foreground">{m.name}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {FAMILY_RELATIONSHIP_LABELS[m.relationship]}
                      {m.phone && <> · {m.phone}</>}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => openEditFamilyDialog(m)}
                      className="h-5 w-5 rounded-full hover:bg-muted-foreground/15 flex items-center justify-center text-muted-foreground"
                      aria-label={`Editar ${m.name}`}
                    >
                      <Edit2 className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveFamilyMember(m.id)}
                      className="h-5 w-5 rounded-full hover:bg-muted-foreground/15 flex items-center justify-center text-muted-foreground"
                      aria-label={`Eliminar ${m.name}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Dialog
          open={isFamilyDialogOpen}
          onOpenChange={(open) => {
            setIsFamilyDialogOpen(open);
            if (!open) resetFamilyDialog();
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {editingFamilyId ? "Editar familiar" : "Agregar familiar"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">
                  Nombre y apellido <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={familyName}
                  onChange={(e) => setFamilyName(e.target.value)}
                  placeholder="Ej. Juan Pérez"
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Teléfono</Label>
                <Input
                  value={familyPhone}
                  onChange={(e) => setFamilyPhone(e.target.value)}
                  placeholder="Ej. +1 234 567 8900"
                  inputMode="tel"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">
                  Parentesco <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={familyRelationship || undefined}
                  onValueChange={(v) =>
                    setFamilyRelationship(v as FamilyMember["relationship"])
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar" />
                  </SelectTrigger>
                  <SelectContent>
                    {FAMILY_RELATIONSHIP_ORDER.map((r) => (
                      <SelectItem key={r} value={r}>
                        {FAMILY_RELATIONSHIP_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsFamilyDialogOpen(false)}
                disabled={familySaving}
              >
                Cancelar
              </Button>
              <Button
                onClick={handleSaveFamilyMember}
                disabled={
                  familySaving ||
                  !familyName.trim() ||
                  !familyRelationship
                }
              >
                {familySaving
                  ? editingFamilyId
                    ? "Guardando…"
                    : "Agregando…"
                  : editingFamilyId
                    ? "Guardar"
                    : "Agregar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Separator />

        <div className="p-4">
          <ContactNote contactId={contact.id} />
        </div>

        <Separator />

        <div className="p-4 space-y-4">
          <h3 className="text-sm font-semibold">Asignación</h3>
          {users.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              No hay agentes disponibles. La integración con GoHighLevel aún no
              expone la lista de usuarios.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Propietario</Label>
                <Select
                  value={selectedOwner || "__unassigned__"}
                  onValueChange={(v) => handleOwnerChange(v === "__unassigned__" ? "" : v)}
                >
                  <SelectTrigger className="w-full bg-popover hover:bg-popover [&>span]:flex [&>span]:items-center [&>span]:gap-2">
                    <SelectValue placeholder="Seleccionar propietario" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__unassigned__">
                      <span className="text-muted-foreground italic">Sin asignar</span>
                    </SelectItem>
                    {users.map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>
                        <div className="flex items-center gap-2">
                          <Avatar className="h-5 w-5">
                            {agent.avatar && <AvatarImage src={agent.avatar} />}
                            <AvatarFallback>{agent.name.substring(0, 2).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <span>{agent.name}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Seguidores</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="w-full justify-between font-normal px-3 h-10 bg-popover hover:bg-popover">
                      <div className="flex items-center gap-2 overflow-hidden truncate">
                        {selectedFollowers.length > 0 ? (
                          selectedFollowers.length === 1 ? (
                            (() => {
                              const agent = usersById.get(selectedFollowers[0]);
                              return (
                                <div className="flex items-center gap-2">
                                  <Avatar className="h-5 w-5">
                                    {agent?.avatar && <AvatarImage src={agent.avatar} />}
                                    <AvatarFallback>
                                      {(agent?.name ?? "??").substring(0, 2).toUpperCase()}
                                    </AvatarFallback>
                                  </Avatar>
                                  <span className="truncate">{agent?.name ?? "Usuario"}</span>
                                </div>
                              );
                            })()
                          ) : (
                            <div className="flex items-center gap-2">
                              <div className="flex -space-x-2">
                                {selectedFollowers.slice(0, 3).map((id) => {
                                  const agent = usersById.get(id);
                                  return (
                                    <Avatar key={id} className="h-5 w-5 border-2 border-background">
                                      {agent?.avatar && <AvatarImage src={agent.avatar} />}
                                      <AvatarFallback>
                                        {(agent?.name ?? "??").substring(0, 2).toUpperCase()}
                                      </AvatarFallback>
                                    </Avatar>
                                  );
                                })}
                              </div>
                              <span className="truncate text-sm">
                                {selectedFollowers.length} seleccionados
                              </span>
                            </div>
                          )
                        ) : (
                          <span className="text-muted-foreground">Seleccionar seguidores</span>
                        )}
                      </div>
                      <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-[280px]" align="start">
                    {users.map((agent) => (
                      <DropdownMenuCheckboxItem
                        key={agent.id}
                        checked={selectedFollowers.includes(agent.id)}
                        onCheckedChange={(checked) => handleToggleFollower(agent.id, Boolean(checked))}
                        onSelect={(e) => e.preventDefault()}
                      >
                        <div className="flex items-center gap-2 ml-2">
                          <Avatar className="h-5 w-5">
                            {agent.avatar && <AvatarImage src={agent.avatar} />}
                            <AvatarFallback>{agent.name.substring(0, 2).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <span>{agent.name}</span>
                        </div>
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          )}
        </div>

        <Separator />

        <div className="p-4 space-y-4 pb-8">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Documentos</h3>
            <Badge variant="secondary" className="text-xs font-normal">
              {allAttachments.length}
            </Badge>
          </div>

          <Tabs defaultValue="image" className="w-full">
            <TabsList className={cn(TAB_LIST_CLASS, "w-full grid grid-cols-4")}>
              <TabsTrigger value="image" className={cn(TAB_TRIGGER_CLASS, "text-[10px] sm:text-xs px-1")}>Imagen</TabsTrigger>
              <TabsTrigger value="doc" className={cn(TAB_TRIGGER_CLASS, "text-[10px] sm:text-xs px-1")}>Doc</TabsTrigger>
              <TabsTrigger value="link" className={cn(TAB_TRIGGER_CLASS, "text-[10px] sm:text-xs px-1")}>Enlaces</TabsTrigger>
              <TabsTrigger value="media" className={cn(TAB_TRIGGER_CLASS, "text-[10px] sm:text-xs px-1")}>Multimedia</TabsTrigger>
            </TabsList>

            {["image", "doc", "link", "media"].map((tab) => {
              const filteredDocs = allAttachments.filter((m) => {
                if (!m.attachment) return false;
                const type = m.attachment.type;
                if (tab === "image") return type === "image";
                if (tab === "doc") return type === "document" || type === "file";
                if (tab === "link") return type === "link";
                if (tab === "media") return type === "audio" || type === "video";
                return false;
              });

              return (
                <TabsContent key={tab} value={tab} className="mt-4 space-y-2">
                  {filteredDocs.length > 0 ? (
                    filteredDocs.map((msg, idx) => (
                      <div key={idx} className="flex items-center gap-3 p-3 rounded-xl border bg-card hover:bg-accent/50 transition-colors group cursor-pointer shadow-sm">
                        {msg.attachment?.type === 'image' && msg.attachment.url ? (
                          <ImageLightbox
                            src={msg.attachment.url}
                            alt={msg.attachment.name}
                            className="h-10 w-10 shrink-0 border bg-muted"
                          >
                            <img src={msg.attachment.url} alt={msg.attachment.name} className="h-full w-full object-cover" />
                          </ImageLightbox>
                        ) : msg.attachment?.type === 'video' && msg.attachment.url ? (
                          <VideoLightbox
                            src={msg.attachment.url}
                            alt={msg.attachment.name}
                            className="h-10 w-10 shrink-0 border bg-black"
                          >
                            <div className="relative h-full w-full">
                              <video
                                src={msg.attachment.url}
                                preload="metadata"
                                muted
                                playsInline
                                className="h-full w-full object-cover"
                              />
                              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/30">
                                <Play className="h-4 w-4 text-white" fill="currentColor" />
                              </div>
                            </div>
                          </VideoLightbox>
                        ) : (
                          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 text-primary">
                            {msg.attachment?.type === 'audio' ? <Headphones className="h-5 w-5" /> :
                             msg.attachment?.type === 'link' ? <LinkIcon className="h-5 w-5" /> :
                             <FileIcon className="h-5 w-5" />}
                          </div>
                        )}
                        <div className="flex flex-col overflow-hidden flex-1">
                          <span className="text-sm font-medium truncate">{msg.attachment?.name || 'Documento'}</span>
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{msg.attachment?.type}</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 opacity-0 group-hover:opacity-100 shrink-0 text-muted-foreground hover:text-foreground"
                          onClick={(e) => {
                            e.stopPropagation();
                            const url = msg.attachment?.url;
                            if (!url) return;
                            if (msg.attachment?.type === "link") {
                              // Plain links — open instead of forcing a download.
                              window.open(url, "_blank", "noopener");
                              return;
                            }
                            downloadAttachment(
                              url,
                              msg.attachment?.name || "documento"
                            ).catch((err) => {
                              console.warn("[download] failed", err);
                              toast({
                                title: "No se pudo descargar el archivo.",
                                variant: "destructive",
                              });
                            });
                          }}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-8 text-xs text-muted-foreground bg-muted/30 rounded-xl border border-dashed">
                      No hay archivos de este tipo
                    </div>
                  )}
                </TabsContent>
              );
            })}
          </Tabs>
        </div>

      </ScrollArea>
    </div>
  );
}
