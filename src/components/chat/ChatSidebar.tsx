import React, { useState, useCallback } from "react";
import { ChannelAvatar } from "./ChannelAvatar";
import { Search, Plus, MoreHorizontal, Filter, Calendar, ListFilter, Save, X, Star, Archive, CheckCheck, Trash2, Bell, AtSign, StickyNote, CheckSquare, LayoutList, List, AlignJustify, Loader2, Menu } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Conversation } from "./types";
import { cn } from "@/lib/utils";
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
  savedViews?: SavedView[];
  activeViewId?: string | null;
  onSaveView?: (view: SavedView) => void;
  stages?: { id: string; label: string; color: string; }[];
  activeTab?: string;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  // Search is controlled by the parent: typing in the input drives a
  // server-side query against the whole GHL location (not just the loaded
  // window), so name matching must live outside this component.
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  isSearching?: boolean;
  // May be async — the parent kicks off an HTTP delete + backfill chain.
  // We await it so the dialog stays open ("Eliminando…") until the work
  // finishes.
  onDeleteConversation?: (id: string) => void | Promise<void>;
  // Opens the MainSidebar drawer on screens below `md`. Index.tsx provides it;
  // the hamburger button below renders only when this prop is set.
  onOpenMobileNav?: () => void;
}

export function ChatSidebar({
  conversations,
  tasks = [],
  activeConversationId,
  onSelectConversation,
  onToggleFavorite,
  savedViews = [],
  activeViewId = null,
  onSaveView,
  stages = [],
  activeTab = "todos",
  onLoadMore,
  hasMore = false,
  isLoadingMore = false,
  searchValue,
  onSearchChange,
  isSearching = false,
  onDeleteConversation,
  onOpenMobileNav,
}: ChatSidebarProps) {
  const [filter, setFilter] = useState<"all" | "unread" | "recent" | "favorites">("all");
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
  // Delete-confirmation state. We keep the lead's name alongside the id so
  // the dialog copy can read "Se eliminará a {name}…" without re-deriving it
  // from the conversations array at render time (the row may have already
  // been optimistically removed by the time the dialog re-renders).
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const { toast } = useToast();

  const [builderFilters, setBuilderFilters] = useState<FilterCondition[]>([]);
  const [builderLogic, setBuilderLogic] = useState<"AND" | "OR">("AND");
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
  
  React.useEffect(() => {
    if (activeView) {
      setBuilderFilters(activeView.filters);
      setBuilderLogic(activeView.logic);
    }
  }, [activeView]);

  const currentFilters = builderFilters;
  const currentLogic = builderLogic;

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

  const filteredConversations = conversations.filter((conv) => {
    if (activeTab === "recordatorios" && !conv.activeReminder) {
      return false;
    }

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

    // Advanced filters
    if (currentFilters.length > 0) {
      const passesFilters = currentFilters.map(cond => {
        if (!cond.value) return true;
        let match = false;
        const valLower = cond.value.toLowerCase();
        
        // Mock filtering logic
        switch (cond.field) {
          case "asignado":
            match = conv.participant.assignedTo?.toLowerCase().includes(valLower) || false;
            break;
          case "canal_ultimo_mensaje":
            match = conv.source === valLower;
            break;
          case "etiqueta":
            match = conv.participant.tags?.some(t => t.toLowerCase().includes(valLower)) || false;
            break;
          case "embudo_actual":
            match = (conv.stage ?? "").toLowerCase().includes(valLower);
            break;
          default:
            match = true;
        }

        if (cond.operator === "no_es" || cond.operator === "no_contiene") {
          return !match;
        }
        return match;
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
  const totalUnread = conversations.reduce((acc, curr) => acc + (curr.unreadCount || 0), 0);

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
          <Dialog open={isAddContactOpen} onOpenChange={setIsAddContactOpen}>
            <DialogContent className="sm:max-w-[425px] p-6 rounded-[24px]">
              <DialogHeader className="mb-4">
                <DialogTitle className="text-xl font-semibold">Agregar contacto</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Nombre y apellido *</Label>
                  <Input id="name" placeholder="Ej. Juan Pérez" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Teléfono *</Label>
                  <Input id="phone" placeholder="Ej. +1 234 567 8900" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="address">Dirección</Label>
                  <Input id="address" placeholder="Ej. Calle 123, Ciudad" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="document">Número de documento</Label>
                  <div className="flex gap-2">
                    <Select defaultValue="CC">
                      <SelectTrigger className="w-[100px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CC">CC</SelectItem>
                        <SelectItem value="CE">CE</SelectItem>
                        <SelectItem value="NIT">NIT</SelectItem>
                        <SelectItem value="Pasaporte">Pasaporte</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input id="document" className="flex-1" placeholder="Número" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="relationship">Parentesco</Label>
                  <Select>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar parentesco" />
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
                <div className="pt-4 flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setIsAddContactOpen(false)} className="rounded-full">Cancelar</Button>
                  <Button onClick={() => {
                    toast({ title: "Contacto agregado", description: "El contacto ha sido agregado exitosamente." });
                    setIsAddContactOpen(false);
                  }} className="rounded-full">Guardar contacto</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          <Dialog open={isNewConversationOpen} onOpenChange={setIsNewConversationOpen}>
            <DialogContent className="sm:max-w-[600px] rounded-[24px] p-8 border-none shadow-2xl bg-white dark:bg-slate-950">
              <DialogHeader className="mb-6">
                <DialogTitle className="text-2xl font-semibold text-center text-slate-900 dark:text-white">Nueva conversación</DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button 
                  className="flex flex-col items-center text-center p-8 rounded-[20px] border-2 border-slate-100 dark:border-slate-800/60 hover:border-primary hover:bg-slate-50/50 dark:hover:bg-slate-900/50 transition-all group"
                  onClick={() => setIsNewConversationOpen(false)}
                >
                  <div className="h-24 w-24 rounded-full bg-[#f0f5ff] dark:bg-primary/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300 overflow-hidden border border-primary/10">
                    <img src="https://api.dicebear.com/7.x/notionists/svg?seed=Felix&backgroundColor=transparent" alt="Contacto" className="h-20 w-20 object-cover" />
                  </div>
                  <h3 className="font-semibold text-lg mb-2 text-slate-900 dark:text-white">Contacto</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mb-8 max-w-[200px]">Iniciar chat con un cliente o lead actual</p>
                  <div className="mt-auto px-8 py-2.5 rounded-full border-2 border-primary text-primary text-sm font-semibold group-hover:bg-primary group-hover:text-primary-foreground transition-colors w-full">
                    Seleccionar
                  </div>
                </button>

                <button 
                  className="flex flex-col items-center text-center p-8 rounded-[20px] border-2 border-slate-100 dark:border-slate-800/60 hover:border-primary hover:bg-slate-50/50 dark:hover:bg-slate-900/50 transition-all group"
                  onClick={() => setIsNewConversationOpen(false)}
                >
                  <div className="h-24 w-24 rounded-full bg-[#f0f5ff] dark:bg-primary/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300 overflow-hidden border border-primary/10">
                    <img src="https://api.dicebear.com/7.x/notionists/svg?seed=TeamWork&backgroundColor=transparent&glasses=variant02" alt="Miembro del equipo" className="h-20 w-20 object-cover" />
                  </div>
                  <h3 className="font-semibold text-lg mb-2 text-slate-900 dark:text-white">Miembro del equipo</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mb-8 max-w-[200px]">Chat interno con un compañero de trabajo</p>
                  <div className="mt-auto px-8 py-2.5 rounded-full border-2 border-primary text-primary text-sm font-semibold group-hover:bg-primary group-hover:text-primary-foreground transition-colors w-full">
                    Seleccionar
                  </div>
                </button>
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
          <TabsList className="w-full flex bg-slate-100 dark:bg-slate-800/50 rounded-full p-1 h-auto">
            <TabsTrigger value="unread" className="flex-1 text-[11px] font-medium rounded-full py-1.5 text-slate-500 dark:text-slate-400 data-[state=active]:bg-white dark:data-[state=active]:bg-slate-600 data-[state=active]:text-slate-900 dark:data-[state=active]:text-white data-[state=active]:shadow-sm flex items-center justify-center gap-1.5">
              No leídos
              {totalUnread > 0 && (
                <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary/10 px-1.5 text-[10px] font-bold text-primary">
                  {totalUnread}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="all" className="flex-1 text-[11px] font-medium rounded-full py-1.5 text-slate-500 dark:text-slate-400 data-[state=active]:bg-white dark:data-[state=active]:bg-slate-600 data-[state=active]:text-slate-900 dark:data-[state=active]:text-white data-[state=active]:shadow-sm">Todos</TabsTrigger>
            <TabsTrigger value="recent" className="flex-1 text-[11px] font-medium rounded-full py-1.5 text-slate-500 dark:text-slate-400 data-[state=active]:bg-white dark:data-[state=active]:bg-slate-600 data-[state=active]:text-slate-900 dark:data-[state=active]:text-white data-[state=active]:shadow-sm">Recientes</TabsTrigger>
            <TabsTrigger value="favorites" className="w-10 shrink-0 text-[11px] font-medium rounded-full py-1.5 text-slate-500 dark:text-slate-400 data-[state=active]:bg-white dark:data-[state=active]:bg-slate-600 data-[state=active]:text-slate-900 dark:data-[state=active]:text-white data-[state=active]:shadow-sm flex items-center justify-center" title="Favoritos">
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
              {currentFilters.map(cond => (
                <Badge key={cond.id} variant="secondary" className="text-xs h-6 px-2.5 font-normal flex items-center gap-1.5 rounded-full bg-slate-200/50 dark:bg-slate-800/50 text-slate-700 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800/70 border-0">
                  {cond.field}: {cond.value}
                  <X className="h-3.5 w-3.5 cursor-pointer opacity-70 hover:opacity-100 transition-opacity" onClick={() => {
                    const newFilters = currentFilters.filter(f => f.id !== cond.id);
                    setBuilderFilters(newFilters);
                  }} />
                </Badge>
              ))}
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
            <div className="text-center p-4 text-sm text-muted-foreground">
              {search.trim()
                ? isSearching
                  ? "Buscando en GoHighLevel..."
                  : `Sin resultados para "${search.trim()}"`
                : "No hay conversaciones"}
            </div>
          ) : (
            filteredConversations.map((conv) => {
              const hasMentions = conv.messages?.some(m => m.mentions && m.mentions.length > 0);
              const hasInternalComments = conv.messages?.some(m => m.channel === "internal");
              const hasPendingTasks = tasks.some(t => t.conversationId === conv.id && t.status === "pending");
              
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
                            <DropdownMenuItem className="gap-2 cursor-pointer">
                              <Archive className="h-4 w-4" />
                              <span>Archivar</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem className="gap-2 cursor-pointer">
                              <CheckCheck className="h-4 w-4" />
                              <span>Marcar como leído</span>
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
                      <span
                        className={cn(
                          // min-w-0 lets the span shrink inside the flex row;
                          // without it the unbroken text overflows and pushes
                          // the trailing unread badge off the right edge.
                          "line-clamp-1 min-w-0 flex-1 text-xs leading-tight pr-2",
                          conv.unreadCount > 0
                            ? "font-semibold text-foreground"
                            : "text-muted-foreground"
                        )}
                        title={conv.lastMessage}
                      >
                        {conv.lastMessage}
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
                      {conv.stage && (() => {
                        const currentStage = stages.find(s => s.id === conv.stage) || { label: conv.stage, color: "bg-slate-500" };

                        let colorClasses = "bg-slate-500/15 text-slate-700 dark:text-slate-400 hover:bg-slate-500/25";
                        if (currentStage.color.includes("rose")) colorClasses = "bg-rose-500/15 text-rose-700 dark:text-rose-400 hover:bg-rose-500/25";
                        else if (currentStage.color.includes("amber")) colorClasses = "bg-amber-500/15 text-amber-700 dark:text-amber-400 hover:bg-amber-500/25";
                        else if (currentStage.color.includes("emerald")) colorClasses = "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/25";
                        else if (currentStage.color.includes("sky")) colorClasses = "bg-sky-500/15 text-sky-700 dark:text-sky-400 hover:bg-sky-500/25";

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
