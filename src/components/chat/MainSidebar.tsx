import React, { useState } from "react";
import { Inbox, User, Eye, Bookmark, ChevronRight, ChevronLeft, ChevronDown, Plus, Hash, CheckSquare, Calendar, AlertCircle, Clock, CalendarDays, Users, Bell, Search, Moon, Sun, Check, Pencil, Trash2, Kanban, UserCog, LogOut, MessageSquare, MessageCircle, Archive } from "lucide-react";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/authContext";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuLabel, DropdownMenuCheckboxItem } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { format } from "date-fns";
import { es } from "date-fns/locale";

import { AgentUser, SavedView, Task } from "./types";
import { WabaRegistrationDialog } from "./WabaRegistrationDialog";

interface MainSidebarProps {
  savedViews: SavedView[];
  activeViewId: string | null;
  onSelectView: (id: string | null) => void;
  activeTab: string;
  onSelectTab: (id: string) => void;
  taskUserFilters: string[];
  setTaskUserFilters: (filters: string[]) => void;
  // Drives the "Tareas pendientes" badge count and feeds the
  // "Buscar delegado" agent picker. Both pull from the live bootstrap
  // payload so the sidebar reflects real GHL data instead of mocks.
  tasks?: Task[];
  users?: AgentUser[];
  onDeleteView?: (id: string) => void;
  forceExpanded?: boolean;
  // Count of conversations assigned to the logged-in agent — renders
  // as a badge next to "Asignados a mí".
  assignedToMeCount?: number;
}

export function MainSidebar({ savedViews, activeViewId, onSelectView, activeTab, onSelectTab, taskUserFilters, setTaskUserFilters, tasks = [], users = [], onDeleteView, forceExpanded = false, assignedToMeCount = 0 }: MainSidebarProps) {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const isExpanded = forceExpanded || internalExpanded;
  const setIsExpanded = setInternalExpanded;
  const [isVistasOpen, setIsVistasOpen] = useState(true);
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  // Two-letter initials for the avatar fallback. Falls back to "??" so we
  // never render an empty pill while the profile fetch is in flight.
  const accountInitials = (() => {
    const name = user?.name?.trim();
    if (!name) return user?.email?.[0]?.toUpperCase() ?? "??";
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  })();
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [dateRange, setDateRange] = useState<any>();

  useEffect(() => {
    setIsDarkMode(document.documentElement.classList.contains("dark"));
  }, []);

  const toggleTheme = () => {
    const newTheme = !isDarkMode;
    setIsDarkMode(newTheme);
    if (newTheme) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  };

  const [isTareasOpen, setIsTareasOpen] = useState(false);
  const [isTareasDropdownOpen, setIsTareasDropdownOpen] = useState(false);
  const [isViewsDropdownOpen, setIsViewsDropdownOpen] = useState(false);
  const [showAgents, setShowAgents] = useState(false);
  const [searchAgent, setSearchAgent] = useState("");
  // Toggles the "Registrar WABA ID" modal launched from the footer.
  // The same modal is opened lazily from ScheduleMessageDialog when the
  // backend reports WABA_MISSING — exposing it here lets the agent set
  // it up proactively instead of waiting for the first 409.
  const [isWabaModalOpen, setIsWabaModalOpen] = useState(false);

  // Live count of pending (non-completed) tasks. Drives the badge next to
  // "Tareas pendientes" in both the expanded and collapsed sidebars.
  const pendingTaskCount = React.useMemo(
    () => tasks.filter((t) => t.status !== "completed").length,
    [tasks]
  );

  // Real GHL staff roster from the bootstrap payload — replaces the legacy
  // mock list that used to feed the "Buscar delegado" picker. Tasks are
  // filtered by assignee NAME (see TaskList) so we surface the agent's
  // display name as the selection value. Empty when the token lacks
  // `users.readonly`.
  const agents = React.useMemo(
    () =>
      users.map((u) => ({
        id: u.id,
        name: u.name,
        avatar: u.avatar,
      })),
    [users]
  );

  const mainItems = [
    { id: "todos", label: "Todos", icon: Inbox },
    { id: "asignados", label: "Asignados a mí", icon: User },
    { id: "seguidos", label: "Seguidos por mí", icon: Eye },
    { id: "recordatorios", label: "Recordatorios", icon: Bell },
    { id: "oportunidades", label: "Oportunidades", icon: Kanban },
    { id: "archivados", label: "Archivados", icon: Archive },
  ];

  const taskOptions = [
    { id: "tareas-hoy", label: "Hoy", icon: Calendar },
    { id: "tareas-atrasado", label: "Atrasado", icon: AlertCircle },
    { id: "tareas-proximos", label: "Próximos", icon: Clock },
    { id: "tareas-realizadas", label: "Realizadas", icon: CheckSquare },
    { id: "tareas-personalizada", label: "Fecha personalizada", icon: CalendarDays },
  ];

  const handleVistasClick = () => {
    if (!isExpanded) {
      setIsExpanded(true);
      setIsVistasOpen(true);
    } else {
      setIsVistasOpen(!isVistasOpen);
    }
  };

  return (
    <div
      className={cn(
        "flex h-full flex-col border-r bg-card transition-all duration-300",
        isExpanded ? "w-64" : "w-[68px]"
      )}
    >
      <div className="flex h-[68px] items-center justify-between border-b px-4">
        {isExpanded && <span className="font-semibold text-foreground truncate pl-1">Vistas</span>}
        {!forceExpanded && (
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-8 w-8 shrink-0", !isExpanded && "mx-auto")}
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
        )}
      </div>

      <div className="flex-1 py-4 flex flex-col gap-2 px-3 overflow-y-auto">
        {mainItems.map((item) => {
          const showBadge = item.id === "asignados";
          const badgeCount = showBadge ? assignedToMeCount : 0;
          return (
          <Tooltip key={item.id} delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                variant={activeTab === item.id ? "secondary" : "ghost"}
                className={cn(
                  "justify-start h-10 w-full transition-all relative",
                  isExpanded ? "px-3" : "px-0 justify-center"
                )}
                onClick={() => {
                  onSelectTab(item.id);
                  onSelectView(null);
                }}
              >
                <item.icon className={cn("h-5 w-5 shrink-0", isExpanded && "mr-3 text-muted-foreground")} />
                {isExpanded && <span className="truncate flex-1 text-left">{item.label}</span>}
                {showBadge && (
                  isExpanded ? (
                    <span className="ml-auto flex items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary h-5 min-w-5 px-1.5">
                      {badgeCount}
                    </span>
                  ) : (
                    <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary h-4 min-w-4 px-1 ring-2 ring-background">
                      {badgeCount}
                    </span>
                  )
                )}
              </Button>
            </TooltipTrigger>
            {!isExpanded && (
              <TooltipContent side="right">
                {item.label}
              </TooltipContent>
            )}
          </Tooltip>
          );
        })}

        {isExpanded ? (
          <>
            <Collapsible open={isTareasOpen} onOpenChange={setIsTareasOpen} className="w-full mt-2">
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  className="justify-between h-10 w-full px-3 transition-all group"
                >
                  <div className="flex items-center">
                    <CheckSquare className="h-5 w-5 shrink-0 mr-3 text-muted-foreground" />
                    <span className="truncate">Tareas pendientes</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {pendingTaskCount > 0 && (
                      <span className="flex items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground h-5 min-w-5 px-1.5">
                        {pendingTaskCount}
                      </span>
                    )}
                    <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200", isTareasOpen && "rotate-180")} />
                  </div>
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-1 mt-1 px-3">
                <div className="mb-2 px-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Buscar delegado..."
                      className="h-8 w-full pl-8 bg-muted/40 text-xs border-none focus-visible:ring-1 focus-visible:ring-primary shadow-sm"
                      onClick={(e) => { e.stopPropagation(); setShowAgents(true); }}
                      onFocus={() => setShowAgents(true)}
                      onChange={(e) => { setSearchAgent(e.target.value); setShowAgents(true); }}
                      value={searchAgent}
                    />
                  </div>

                  {(showAgents || searchAgent || taskUserFilters.length > 0) && agents.length > 0 && (
                    <div className="max-h-40 overflow-y-auto mt-2 space-y-1">
                      {(searchAgent
                        ? agents.filter(a => a.name.toLowerCase().includes(searchAgent.toLowerCase()))
                        : agents
                      ).map((agent) => (
                        <div 
                          key={agent.id}
                          className={cn(
                            "flex items-center gap-2 p-1.5 rounded-md cursor-pointer hover:bg-accent text-sm",
                            taskUserFilters.includes(agent.name) && "bg-accent"
                          )}
                          onClick={() => {
                            if (taskUserFilters.includes(agent.name)) {
                              setTaskUserFilters(taskUserFilters.filter(name => name !== agent.name));
                            } else {
                              setTaskUserFilters([...taskUserFilters, agent.name]);
                              setSearchAgent("");
                            }
                          }}
                        >
                          <Avatar className="h-5 w-5">
                            <AvatarImage src={agent.avatar} />
                            <AvatarFallback>{agent.name.substring(0, 2).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <span className="truncate">{agent.name}</span>
                          {taskUserFilters.includes(agent.name) && (
                            <Check className="h-3.5 w-3.5 ml-auto text-primary" />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {taskOptions.map((opt) => {
                  if (opt.id === "tareas-personalizada") {
                    return (
                      <Popover key={opt.id}>
                        <PopoverTrigger asChild>
                          <Button
                            variant={activeTab === opt.id ? "secondary" : "ghost"}
                            size="sm"
                            className="w-full justify-start h-8 font-normal text-muted-foreground hover:text-foreground pl-8"
                          >
                            <opt.icon className="h-3.5 w-3.5 mr-2 shrink-0" />
                            <span className="whitespace-nowrap">{opt.label}</span>
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent side="right" align="start" className="p-0 border-none rounded-xl shadow-xl w-auto">
                          <CalendarComponent
                            mode="range"
                            selected={dateRange}
                            onSelect={(range: any) => {
                              setDateRange(range);
                              if (range?.from) {
                                if (range.to) {
                                  onSelectTab(`tareas-${format(range.from, "dd MMM", { locale: es })} - ${format(range.to, "dd MMM", { locale: es })}`);
                                  onSelectView(null);
                                } else {
                                  onSelectTab(`tareas-${format(range.from, "dd MMM", { locale: es })}`);
                                  onSelectView(null);
                                }
                              }
                            }}
                            className="bg-card rounded-xl border"
                          />
                        </PopoverContent>
                      </Popover>
                    );
                  }
                  return (
                    <Button
                      key={opt.id}
                      variant={activeTab === opt.id ? "secondary" : "ghost"}
                      size="sm"
                      className="w-full justify-start h-8 font-normal text-muted-foreground hover:text-foreground pl-8"
                      onClick={() => {
                        onSelectTab(opt.id);
                        onSelectView(null);
                      }}
                    >
                      <opt.icon className="h-3.5 w-3.5 mr-2 shrink-0" />
                      <span className="truncate">{opt.label}</span>
                    </Button>
                  );
                })}
              </CollapsibleContent>
            </Collapsible>

            <Collapsible open={isVistasOpen} onOpenChange={setIsVistasOpen} className="w-full mt-2">
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  className="justify-between h-10 w-full px-3 transition-all group"
                >
                  <div className="flex items-center">
                    <Bookmark className="h-5 w-5 shrink-0 mr-3 text-muted-foreground" />
                    <span className="truncate">Vistas guardadas</span>
                  </div>
                  <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200", isVistasOpen && "rotate-180")} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-1 mt-1 pl-11 pr-2">
                {savedViews.map((vista) => (
                  <div key={vista.id} className="relative group flex items-center">
                    <Button
                      variant={activeViewId === vista.id ? "secondary" : "ghost"}
                      size="sm"
                      className="w-full justify-start h-8 font-normal text-muted-foreground hover:text-foreground pr-14"
                      onClick={() => {
                        onSelectTab("");
                        onSelectView(vista.id);
                      }}
                    >
                      <Hash className="h-3.5 w-3.5 mr-2 shrink-0" />
                      <span className="truncate">{vista.name}</span>
                    </Button>
                    <div className="absolute right-1 opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-6 w-6 text-muted-foreground hover:text-foreground" 
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          onSelectTab("");
                          onSelectView(vista.id);
                          setTimeout(() => {
                            document.dispatchEvent(new CustomEvent('open-filter-builder', { detail: { editViewId: vista.id } }));
                          }, 150);
                        }}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-6 w-6 text-muted-foreground hover:text-destructive" 
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onDeleteView) onDeleteView(vista.id);
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start h-8 font-normal text-muted-foreground hover:text-foreground mt-2 border border-dashed border-border"
                  onClick={() => {
                    onSelectTab("todos");
                    onSelectView(null);
                    document.dispatchEvent(new CustomEvent('open-filter-builder'));
                  }}
                >
                  <Plus className="h-3.5 w-3.5 mr-2 shrink-0" />
                  <span className="truncate">Crear vista</span>
                </Button>
              </CollapsibleContent>
            </Collapsible>
          </>
        ) : (
          <>
            <DropdownMenu open={isTareasDropdownOpen} onOpenChange={setIsTareasDropdownOpen}>
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant={activeTab.startsWith("tareas") ? "secondary" : "ghost"}
                      className="justify-center h-10 w-full px-0 mt-2 transition-all relative"
                    >
                      <CheckSquare className="h-5 w-5 shrink-0" />
                      {pendingTaskCount > 0 && (
                        <span className="absolute top-1 right-1 flex items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground h-4 min-w-4 px-1">
                          {pendingTaskCount}
                        </span>
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="right">Tareas pendientes</TooltipContent>
              </Tooltip>
              <DropdownMenuContent side="right" align="start" className="w-64 p-2">
                <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                  Usuario
                </DropdownMenuLabel>
                <div className="px-2 mb-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Buscar delegado..."
                      className="h-8 w-full pl-8 bg-muted/40 text-xs border-none focus-visible:ring-1 focus-visible:ring-primary shadow-sm"
                      onClick={(e) => { e.stopPropagation(); setShowAgents(true); }}
                      onFocus={() => setShowAgents(true)}
                      onChange={(e) => { setSearchAgent(e.target.value); setShowAgents(true); }}
                      value={searchAgent}
                      onKeyDown={(e) => e.stopPropagation()}
                    />
                  </div>
                </div>

                {(showAgents || searchAgent || taskUserFilters.length > 0) && agents.length > 0 && (
                  <div className="max-h-40 overflow-y-auto px-1 mb-2 space-y-1">
                    {(searchAgent
                      ? agents.filter(a => a.name.toLowerCase().includes(searchAgent.toLowerCase()))
                      : agents
                    ).map((agent) => (
                      <DropdownMenuCheckboxItem
                        key={agent.id}
                        checked={taskUserFilters.includes(agent.name)}
                        onSelect={(e) => e.preventDefault()}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setTaskUserFilters([...taskUserFilters, agent.name]);
                            setSearchAgent("");
                          } else {
                            setTaskUserFilters(taskUserFilters.filter(name => name !== agent.name));
                          }
                        }}
                        className="text-sm cursor-pointer py-1.5"
                      >
                        <div className="flex items-center gap-2 ml-2">
                          <Avatar className="h-5 w-5">
                            <AvatarImage src={agent.avatar} />
                            <AvatarFallback>{agent.name.substring(0, 2).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <span>{agent.name}</span>
                        </div>
                      </DropdownMenuCheckboxItem>
                    ))}
                  </div>
                )}
                
                <DropdownMenuSeparator className="my-2" />
                
                <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                  Fecha
                </DropdownMenuLabel>
                {taskOptions.map((opt) => {
                  if (opt.id === "tareas-personalizada") {
                    return (
                      <DropdownMenuSub key={opt.id}>
                        <DropdownMenuSubTrigger className="flex items-center">
                          <opt.icon className="h-4 w-4 mr-2 text-muted-foreground" />
                          <span className="whitespace-nowrap">{opt.label}</span>
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="p-0 border-none rounded-xl shadow-xl">
                          <CalendarComponent
                            mode="range"
                            selected={dateRange}
                            onSelect={(range: any) => {
                              setDateRange(range);
                              if (range?.from) {
                                if (range.to) {
                                  onSelectTab(`tareas-${format(range.from, "dd MMM", { locale: es })} - ${format(range.to, "dd MMM", { locale: es })}`);
                                  onSelectView(null);
                                } else {
                                  onSelectTab(`tareas-${format(range.from, "dd MMM", { locale: es })}`);
                                  onSelectView(null);
                                }
                              }
                            }}
                            className="bg-card rounded-xl border"
                          />
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    );
                  }
                  return (
                    <DropdownMenuItem
                      key={opt.id}
                      onClick={() => {
                        onSelectTab(opt.id);
                        onSelectView(null);
                      }}
                      className={cn(activeTab === opt.id && "bg-secondary")}
                    >
                      <opt.icon className="h-4 w-4 mr-2 text-muted-foreground" />
                      {opt.label}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu open={isViewsDropdownOpen} onOpenChange={setIsViewsDropdownOpen}>
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant={activeViewId ? "secondary" : "ghost"}
                      className="justify-center h-10 w-full px-0 mt-2 transition-all"
                    >
                      <Bookmark className="h-5 w-5 shrink-0" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="right">Vistas guardadas</TooltipContent>
              </Tooltip>
              <DropdownMenuContent side="right" align="start" className="w-48">
                {savedViews.map((vista) => (
                  <div key={vista.id} className="relative group flex items-center px-1">
                    <DropdownMenuItem
                      onClick={() => {
                        onSelectTab("");
                        onSelectView(vista.id);
                      }}
                      className={cn("flex-1 pr-14 cursor-pointer", activeViewId === vista.id && "bg-secondary")}
                    >
                      <Hash className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                      <span className="truncate">{vista.name}</span>
                    </DropdownMenuItem>
                    <div className="absolute right-2 opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-6 w-6 text-muted-foreground hover:text-foreground h-full py-0" 
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          setIsViewsDropdownOpen(false);
                          onSelectTab("");
                          onSelectView(vista.id);
                          setTimeout(() => {
                            document.dispatchEvent(new CustomEvent('open-filter-builder', { detail: { editViewId: vista.id } }));
                          }, 150);
                        }}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-6 w-6 text-muted-foreground hover:text-destructive h-full py-0" 
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onDeleteView) onDeleteView(vista.id);
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => {
                  onSelectTab("todos");
                  onSelectView(null);
                  document.dispatchEvent(new CustomEvent('open-filter-builder'));
                }}>
                  <Plus className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                  Crear vista
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>

      <div className="p-3 border-t flex flex-col gap-1">
        {/* Compact account block — avatar (or initials) + name + status,
            opens a dropdown with the two account actions. Mirrors the
            preview's layout. The trigger collapses to an avatar-only
            button when the rail is in its narrow mode. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className={cn(
                "h-12 w-full transition-all relative rounded-xl hover:bg-accent/50",
                isExpanded ? "justify-start px-2" : "justify-center px-0"
              )}
            >
              <div className="flex items-center gap-3 min-w-0">
                <Avatar className="h-8 w-8 shrink-0">
                  {user?.avatar && <AvatarImage src={user.avatar} alt={user.name ?? ""} />}
                  <AvatarFallback className="text-xs font-semibold">
                    {accountInitials}
                  </AvatarFallback>
                </Avatar>
                {isExpanded && (
                  <div className="flex flex-col items-start overflow-hidden">
                    <span className="text-[13px] font-semibold truncate w-full text-foreground">
                      {user?.name ?? "Mi cuenta"}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-medium truncate w-full">
                      En línea
                    </span>
                  </div>
                )}
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            side="right"
            className="w-56 mb-2 ml-2 p-2 rounded-2xl shadow-xl"
          >
            <DropdownMenuItem
              className="rounded-xl cursor-pointer py-2.5"
              onClick={() => navigate("/profile")}
            >
              <UserCog className="mr-2 h-4 w-4" />
              <span>Mi Perfil</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="rounded-xl cursor-pointer py-2.5"
              onClick={() => navigate("/settings/whatsapp-templates")}
            >
              <MessageCircle className="mr-2 h-4 w-4" />
              <span>Plantillas WhatsApp</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="my-1" />
            <DropdownMenuItem
              className="rounded-xl text-destructive focus:text-destructive cursor-pointer py-2.5"
              onClick={async () => {
                await logout();
                navigate("/login", { replace: true });
              }}
            >
              <LogOut className="mr-2 h-4 w-4" />
              <span>Cerrar sesión</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              className={cn(
                "justify-start h-10 w-full transition-all relative rounded-xl",
                isExpanded ? "px-3" : "px-0 justify-center"
              )}
              onClick={() => setIsWabaModalOpen(true)}
            >
              <MessageSquare className={cn("h-5 w-5 shrink-0 text-muted-foreground", isExpanded && "mr-3")} />
              {isExpanded && <span className="truncate flex-1 text-left">Registrar WABA ID</span>}
            </Button>
          </TooltipTrigger>
          {!isExpanded && (
            <TooltipContent side="right">Registrar WABA ID</TooltipContent>
          )}
        </Tooltip>

        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              className={cn(
                "justify-start h-10 w-full transition-all relative rounded-xl",
                isExpanded ? "px-3" : "px-0 justify-center"
              )}
              onClick={toggleTheme}
            >
              {isDarkMode ? (
                <Sun className={cn("h-5 w-5 shrink-0 text-muted-foreground", isExpanded && "mr-3")} />
              ) : (
                <Moon className={cn("h-5 w-5 shrink-0 text-muted-foreground", isExpanded && "mr-3")} />
              )}
              {isExpanded && <span className="truncate flex-1 text-left">{isDarkMode ? "Modo Claro" : "Modo Oscuro"}</span>}
            </Button>
          </TooltipTrigger>
          {!isExpanded && (
            <TooltipContent side="right">
              {isDarkMode ? "Modo Claro" : "Modo Oscuro"}
            </TooltipContent>
          )}
        </Tooltip>
      </div>

      <WabaRegistrationDialog
        open={isWabaModalOpen}
        onOpenChange={setIsWabaModalOpen}
      />
    </div>
  );
}
