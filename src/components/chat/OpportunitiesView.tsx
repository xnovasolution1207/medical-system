import React, { useMemo, useState } from "react";
import {
  Search,
  Filter,
  ArrowUpDown,
  Download,
  Plus,
  Settings,
  LayoutGrid,
  List as ListIcon,
  Phone,
  Calendar as CalendarIcon,
  Globe,
  Check,
  Menu,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
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
import type { Conversation, Opportunity, Pipeline } from "./types";

interface OpportunitiesViewProps {
  opportunities: Opportunity[];
  pipeline?: Pipeline;
  // Source for the "Crear oportunidad" contact picker. We pull contacts from
  // the conversations the SPA has already loaded — without `users.readonly`
  // (and without a separate /contacts/search endpoint exposed to the SPA),
  // this is the most pragmatic source. Not provided ⇒ picker shows "no
  // contactos disponibles".
  conversations?: Conversation[];
  onMoveOpportunity?: (id: string, stageId: string) => void;
  onCreateOpportunity?: (payload: {
    name: string;
    contactId: string;
    pipelineId: string;
    stageId: string;
    monetaryValue?: number;
  }) => void | Promise<void>;
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

export function OpportunitiesView({
  opportunities,
  pipeline,
  conversations,
  onMoveOpportunity,
  onCreateOpportunity,
  onOpenMobileNav,
  onOpenChat,
  onBulkDeleteOpportunities,
}: OpportunitiesViewProps) {
  const { toast } = useToast();
  const [viewMode, setViewMode] = useState<"board" | "list">("board");
  const [searchQuery, setSearchQuery] = useState("");
  const [draggedOppId, setDraggedOppId] = useState<string | null>(null);
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

  // Filtros Avanzados
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [sourceFilters, setSourceFilters] = useState<string[]>([]);
  const [stageFilters, setStageFilters] = useState<string[]>([]);

  // Ordenar
  const [sortKey, setSortKey] = useState<SortKey>("recientes");

  // Crear oportunidad dialog
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newOppContactId, setNewOppContactId] = useState("");
  const [newOppName, setNewOppName] = useState("");
  const [newOppStageId, setNewOppStageId] = useState("");
  const [newOppValue, setNewOppValue] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  // Filter + sort chain. Search + advanced filters narrow first; sort runs on
  // the result. `Opportunity.date` is a localized display string (e.g.
  // "28 abr 2026") — lexical compare is good-enough for v1 ordering; if it
  // becomes an issue, plumb `createdAtIso` through `toFrontendOpportunity`.
  const filteredOpps = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = opportunities.filter((o) => o.name.toLowerCase().includes(q));
    if (statusFilters.length) list = list.filter((o) => statusFilters.includes(o.status));
    if (sourceFilters.length) list = list.filter((o) => sourceFilters.includes(o.source));
    if (stageFilters.length) list = list.filter((o) => stageFilters.includes(o.stageId));

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
  }, [opportunities, searchQuery, statusFilters, sourceFilters, stageFilters, sortKey]);

  const activeFilterCount =
    statusFilters.length + sourceFilters.length + stageFilters.length;

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
  };

  const toggleFilter = (
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    value: string
  ) => {
    setter((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  };

  const clearFilters = () => {
    setStatusFilters([]);
    setSourceFilters([]);
    setStageFilters([]);
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
      <div className="flex min-h-[68px] flex-wrap items-center justify-between gap-3 px-4 py-3 border-b shrink-0 bg-white dark:bg-slate-950 lg:flex-nowrap lg:gap-4 lg:py-0">
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

          {/* Filtros Avanzados */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="icon" className="md:size-auto md:px-3 md:gap-2 shrink-0 relative">
                <Filter className="h-4 w-4" />
                <span className="hidden md:inline">Filtros</span>
                <span className="hidden xl:inline">Avanzados</span>
                {activeFilterCount > 0 && (
                  <span className="absolute -top-1 -right-1 md:static md:ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                    {activeFilterCount}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-0">
              <div className="max-h-[60vh] overflow-y-auto p-3 space-y-4">
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Estado
                  </p>
                  {(Object.keys(STATUS_LABELS) as Opportunity["status"][]).map((s) => (
                    <label
                      key={s}
                      className="flex items-center gap-2 text-sm cursor-pointer select-none"
                    >
                      <Checkbox
                        checked={statusFilters.includes(s)}
                        onCheckedChange={() => toggleFilter(setStatusFilters, s)}
                      />
                      <span>{STATUS_LABELS[s]}</span>
                    </label>
                  ))}
                </div>

                {availableSources.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Origen
                    </p>
                    {availableSources.map((src) => (
                      <label
                        key={src}
                        className="flex items-center gap-2 text-sm cursor-pointer select-none"
                      >
                        <Checkbox
                          checked={sourceFilters.includes(src)}
                          onCheckedChange={() => toggleFilter(setSourceFilters, src)}
                        />
                        <span className="truncate">{src}</span>
                      </label>
                    ))}
                  </div>
                )}

                {stages.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Etapa
                    </p>
                    {stages.map((s) => (
                      <label
                        key={s.id}
                        className="flex items-center gap-2 text-sm cursor-pointer select-none"
                      >
                        <Checkbox
                          checked={stageFilters.includes(s.id)}
                          onCheckedChange={() => toggleFilter(setStageFilters, s.id)}
                        />
                        <span className="truncate">{s.label}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <div className="border-t p-2 flex justify-between items-center bg-muted/30">
                <span className="text-xs text-muted-foreground">
                  {activeFilterCount === 0
                    ? "Sin filtros activos"
                    : `${activeFilterCount} filtro${activeFilterCount === 1 ? "" : "s"} activo${activeFilterCount === 1 ? "" : "s"}`}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={clearFilters}
                  disabled={activeFilterCount === 0}
                >
                  Limpiar
                </Button>
              </div>
            </PopoverContent>
          </Popover>

          {/* Ordenar */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="md:size-auto md:px-3 md:gap-2 shrink-0">
                <ArrowUpDown className="h-4 w-4" />
                <span className="hidden md:inline">Ordenar</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Ordenar por
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={sortKey}
                onValueChange={(v) => setSortKey(v as SortKey)}
              >
                {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                  <DropdownMenuRadioItem key={key} value={key}>
                    {SORT_LABELS[key]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Importar — stubbed (no GHL bulk-create endpoint exposed).
              Hidden below xl to keep the primary actions visible. */}
          <Button variant="outline" className="hidden xl:inline-flex gap-2 shrink-0" onClick={handleComingSoon}>
            <Download className="h-4 w-4" />
            Importar
          </Button>

          {/* Gestionar campos — stubbed (GHL pipeline-stage CRUD isn't in the v2 API).
              Hidden below xl to keep the primary actions visible. */}
          <Button variant="outline" className="hidden xl:inline-flex gap-2 shrink-0" onClick={handleComingSoon}>
            <Settings className="h-4 w-4" />
            Gestionar campos
          </Button>

          {/* Crear oportunidad — primary action, always visible. Label collapses on small screens. */}
          <Button
            size="icon"
            className="md:size-auto md:px-4 md:gap-2 shrink-0"
            onClick={() => {
              if (!pipeline) {
                toast({
                  title: "No hay pipeline disponible",
                  description: "No se encontró un pipeline en GoHighLevel.",
                  variant: "destructive",
                });
                return;
              }
              setIsCreateOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            <span className="hidden md:inline">Crear</span>
            <span className="hidden lg:inline">oportunidad</span>
          </Button>

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
            {selectedOppIds.size > 0 && (
              <div className="mb-3 flex items-center justify-between rounded-lg border bg-card px-3 py-2 shadow-sm">
                <span className="text-sm">
                  <span className="font-semibold">{selectedOppIds.size}</span> seleccionada
                  {selectedOppIds.size === 1 ? "" : "s"}
                </span>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={clearOppSelection}>
                    Limpiar
                  </Button>
                  {onBulkDeleteOpportunities && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={async () => {
                        const ids = Array.from(selectedOppIds);
                        await onBulkDeleteOpportunities(ids);
                        clearOppSelection();
                      }}
                    >
                      Eliminar seleccionadas
                    </Button>
                  )}
                </div>
              </div>
            )}
            <div className="flex gap-4 h-full pb-4 w-max">
              {stages.map((stage) => {
                const stageOpps = filteredOpps.filter((o) => o.stageId === stage.id);
                const stageTotal = stageOpps.reduce(
                  (sum, opp) => sum + (opp.monetaryValue ?? 0),
                  0
                );
                return (
                  <div
                    key={stage.id}
                    className="flex flex-col w-72 bg-muted/30 rounded-lg border shrink-0"
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, stage.id)}
                  >
                    <div className="p-3 border-b bg-muted/50 rounded-t-lg shrink-0">
                      <div className="flex items-center justify-between">
                        <h3 className="font-medium text-sm truncate">{stage.label}</h3>
                        <span className="text-xs text-muted-foreground bg-background px-2 py-0.5 rounded-full border shrink-0">
                          {stageOpps.length}
                        </span>
                      </div>
                      {stageTotal > 0 && (
                        <div className="mt-1 text-[11px] font-medium text-muted-foreground">
                          ${stageTotal.toLocaleString("es-PE", { minimumFractionDigits: 2 })}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 p-2 space-y-2 overflow-y-auto">
                      {stageOpps.map((opp) => {
                        const isSelected = selectedOppIds.has(opp.id);
                        const canOpenChat = Boolean(onOpenChat && opp.contactId);
                        return (
                          <div
                            key={opp.id}
                            draggable
                            onDragStart={(e) => handleDragStart(e, opp.id)}
                            onClick={() => {
                              if (canOpenChat) onOpenChat?.(opp.contactId);
                            }}
                            className={cn(
                              "bg-card border rounded-md p-3 shadow-sm hover:shadow-md transition-shadow active:cursor-grabbing relative",
                              canOpenChat ? "cursor-pointer" : "cursor-grab",
                              isSelected && "ring-2 ring-primary ring-offset-1"
                            )}
                          >
                            {/* Selection checkbox — click without bubbling so the
                                card's onClick (open chat) doesn't also fire. */}
                            <div
                              className={cn(
                                "absolute top-2 left-2 z-10 transition-opacity",
                                isSelected ? "opacity-100" : "opacity-0 hover:opacity-100 group-hover:opacity-100"
                              )}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => toggleOppSelected(opp.id)}
                              />
                            </div>
                            <div className="flex items-start justify-between mb-2 pl-6">
                              <h4 className="font-medium text-sm truncate">{opp.name}</h4>
                              <Avatar className="h-6 w-6 shrink-0">
                                <AvatarFallback>{opp.name.charAt(0)}</AvatarFallback>
                              </Avatar>
                            </div>
                            <div className="space-y-1.5 mt-3">
                              <div className="flex items-center text-xs text-muted-foreground">
                                <Globe className="h-3.5 w-3.5 mr-2 shrink-0" />
                                <span className="truncate">{opp.source}</span>
                              </div>
                              {opp.monetaryValue ? (
                                <div className="flex items-center text-xs text-muted-foreground">
                                  <Phone className="h-3.5 w-3.5 mr-2 shrink-0 opacity-0" />
                                  <span className="truncate">${opp.monetaryValue}</span>
                                </div>
                              ) : null}
                              <div className="flex items-center text-xs text-muted-foreground">
                                <CalendarIcon className="h-3.5 w-3.5 mr-2 shrink-0" />
                                <span>{opp.date}</span>
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
          <div className="border rounded-lg bg-card max-w-6xl mx-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre del lead</TableHead>
                  <TableHead>Etapa</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Medio de captación</TableHead>
                  <TableHead>Fecha de creación</TableHead>
                  <TableHead className="text-right">Propietario</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOpps.map((opp) => (
                  <TableRow key={opp.id}>
                    <TableCell className="font-medium">{opp.name}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold bg-muted/50">
                        {stageLookup.get(opp.stageId) ?? opp.stageId}
                      </span>
                    </TableCell>
                    <TableCell className="capitalize">{opp.status}</TableCell>
                    <TableCell>{opp.source}</TableCell>
                    <TableCell>{opp.date}</TableCell>
                    <TableCell className="text-right">
                      <Avatar className="h-6 w-6 ml-auto">
                        <AvatarFallback>{opp.name.charAt(0)}</AvatarFallback>
                      </Avatar>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredOpps.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center h-24 text-muted-foreground">
                      No se encontraron oportunidades.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

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
    </div>
  );
}
