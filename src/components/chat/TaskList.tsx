import React, { useEffect, useRef, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChannelAvatar } from "./ChannelAvatar";
import { CheckCircle2, Circle, Clock, User as UserIcon, Edit2, LayoutList, AlignJustify, List, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { AgentUser, Task } from "./types";

interface TaskListProps {
  tasks: Task[];
  onToggleTask: (id: string) => void;
  filterType: string;
  selectedUsers: string[];
  onSelectConversation: (id: string) => void;
  activeConversationId: string;
  // Agent roster — used to resolve the assignee's avatar (the task itself only
  // carries the assignee name/id).
  users?: AgentUser[];
  onOpenMobileNav?: () => void;
}

// Initials for an avatar fallback: first letter of first + last word.
function assigneeInitials(name: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function TaskList({ tasks, onToggleTask, filterType, selectedUsers, onSelectConversation, activeConversationId, users = [], onOpenMobileNav }: TaskListProps) {
  const [viewMode, setViewMode] = useState<"normal" | "compact" | "small">("normal");
  // Infinite scroll: render 25 tasks at a time and reveal 25 more as the list is
  // scrolled near its bottom, so a large filtered set stays fast to render.
  const TASK_PAGE_SIZE = 25;
  const [visibleCount, setVisibleCount] = useState(TASK_PAGE_SIZE);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Reset to the first page whenever the active filter/user scope changes.
  useEffect(() => {
    setVisibleCount(TASK_PAGE_SIZE);
  }, [filterType, selectedUsers.join("|")]);

  // Date filtering is done on the raw ISO due date (`dueAt`), compared as a
  // Peru-local calendar day ("YYYY-MM-DD" sorts chronologically). The localized
  // `dueDate` label ("Hoy, 03:00 PM", "30 may, ...") is display-only and is
  // only used as a fallback for legacy rows that predate `dueAt`.
  const PERU_TZ = "America/Lima";
  const peruDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: PERU_TZ });
  const todayStr = peruDay(new Date());
  // Shift a "YYYY-MM-DD" by N days (used for relative-label fallback).
  const shiftYmd = (ymd: string, days: number): string => {
    const [y, m, d] = ymd.split("-").map(Number);
    const x = new Date(Date.UTC(y, m - 1, d) + days * 86400000);
    return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}-${String(x.getUTCDate()).padStart(2, "0")}`;
  };
  const dayOf = (t: Task): string | null => {
    if (t.dueAt) {
      const d = new Date(t.dueAt);
      if (!isNaN(d.getTime())) return peruDay(d);
    }
    // Fallback for rows that arrived without a raw ISO (older cached data):
    // derive the day from the relative display label so filters still work.
    const lbl = (t.dueDate || "").toLowerCase();
    if (lbl.startsWith("hoy")) return todayStr;
    if (lbl.startsWith("mañana") || lbl.startsWith("manana")) return shiftYmd(todayStr, 1);
    if (lbl.startsWith("ayer")) return shiftYmd(todayStr, -1);
    return null;
  };

  const filteredTasks = tasks.filter(t => {
    // 1. Filter by user if selectedUsers is not empty
    if (selectedUsers.length > 0 && !selectedUsers.includes(t.assignee.name)) {
      return false;
    }

    // 2. Filter by date/status
    if (filterType === "tareas-realizadas") return t.status === "completed";

    const day = dayOf(t);

    if (filterType === "tareas-hoy") {
      if (t.status === "completed") return false;
      return day ? day === todayStr : t.dueDate.includes("Hoy");
    }
    if (filterType === "tareas-atrasado") {
      if (t.status === "completed") return false;
      return day ? day < todayStr : (t.dueDate.includes("Ayer") || t.dueDate.includes("Atrasado"));
    }
    if (filterType === "tareas-proximos") {
      // "Próximos" = upcoming pending work: today and onward (not overdue,
      // not done). Includes today so tasks due "Hoy" still surface here.
      if (t.status === "completed") return false;
      return day
        ? day >= todayStr
        : (t.dueDate.includes("Hoy") || t.dueDate.includes("Mañana") || t.dueDate.includes("Próximos"));
    }

    // Custom date / range from the calendar. New tokens are ISO:
    //   "tareas-YYYY-MM-DD"            (single day)
    //   "tareas-YYYY-MM-DD_YYYY-MM-DD" (range)
    // Legacy tokens were a localized label ("tareas-16 jun"); fall back to a
    // substring match so old bookmarked URLs still resolve.
    if (filterType.startsWith("tareas-") && filterType !== "tareas-personalizada") {
      const token = filterType.replace("tareas-", "");
      const iso = token.match(/^(\d{4}-\d{2}-\d{2})(?:_(\d{4}-\d{2}-\d{2}))?$/);
      if (iso) {
        const from = iso[1];
        const to = iso[2] ?? from;
        return day ? day >= from && day <= to : false;
      }
      return t.dueDate.toLowerCase().includes(token.toLowerCase());
    }
    return true; // para "tareas-personalizada" o todos
  });

  const visibleTasks = filteredTasks.slice(0, visibleCount);
  const hasMore = filteredTasks.length > visibleTasks.length;

  // Auto-open the FIRST task's conversation when entering a task filter — as if
  // it were clicked — so the chat area isn't empty on arrival. Only fires when
  // nothing is already open (never overrides a manual selection) and once per
  // filter, picking the first task that actually has a conversation.
  const firstTaskConvId = filteredTasks.find((t) => t.conversationId)?.conversationId;
  const autoSelectedFilterRef = useRef<string | null>(null);
  useEffect(() => {
    // Already auto-selected for this filter → don't fight a later manual pick.
    if (autoSelectedFilterRef.current === filterType) return;
    // Something is already open (a manual click, or briefly the previous
    // filter's conversation during a tab switch) — wait. Crucially we DON'T mark
    // the filter as handled here: doing so with a stale conversation (left over
    // from the filter we just left) would block the auto-select once it clears,
    // which is exactly why switching into "Realizadas" didn't auto-open.
    if (activeConversationId) return;
    if (firstTaskConvId) {
      autoSelectedFilterRef.current = filterType;
      onSelectConversation(firstTaskConvId);
    }
  }, [filterType, firstTaskConvId, activeConversationId, onSelectConversation]);

  // Reveal the next page when the (Radix) scroll viewport nears its bottom.
  useEffect(() => {
    const root = scrollRef.current;
    const vp = root?.querySelector(
      "[data-radix-scroll-area-viewport]"
    ) as HTMLElement | null;
    if (!vp) return;
    const onScroll = () => {
      if (vp.scrollHeight - vp.scrollTop - vp.clientHeight < 300) {
        setVisibleCount((c) => (c < filteredTasks.length ? c + TASK_PAGE_SIZE : c));
      }
    };
    vp.addEventListener("scroll", onScroll, { passive: true });
    return () => vp.removeEventListener("scroll", onScroll);
  }, [filteredTasks.length]);

  return (
    <TooltipProvider>
      <div className="flex h-full w-full flex-col border-r bg-card text-card-foreground md:w-72 lg:w-80 xl:w-[350px]">
        <div className="flex flex-col border-b">
          <div className="flex h-[68px] items-center justify-between gap-2 px-4 py-3">
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
              <h2 className="text-lg font-bold tracking-tight truncate">Tareas</h2>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="flex items-center gap-0.5 bg-muted/50 p-0.5 rounded-md">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant={viewMode === "normal" ? "secondary" : "ghost"} size="icon" className="h-7 w-7 rounded-sm" onClick={() => setViewMode("normal")}>
                      <LayoutList className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Vista Normal</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant={viewMode === "compact" ? "secondary" : "ghost"} size="icon" className="h-7 w-7 rounded-sm" onClick={() => setViewMode("compact")}>
                      <AlignJustify className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Vista Compacta</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant={viewMode === "small" ? "secondary" : "ghost"} size="icon" className="h-7 w-7 rounded-sm" onClick={() => setViewMode("small")}>
                      <List className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Vista Pequeña</TooltipContent>
                </Tooltip>
              </div>
              <Badge variant="secondary" className="font-normal">
                {filteredTasks.length} {filteredTasks.length === 1 ? 'tarea' : 'tareas'}
              </Badge>
            </div>
          </div>
        </div>

        <ScrollArea className="flex-1" ref={scrollRef}>
          <div className="flex flex-col gap-0.5 p-2">
            {filteredTasks.length === 0 ? (
              <div className="text-center p-8 text-sm text-muted-foreground flex flex-col items-center gap-2">
                <CheckCircle2 className="h-8 w-8 text-muted-foreground/50" />
                <p>No hay tareas para esta vista</p>
              </div>
            ) : (
              visibleTasks.map((task) => (
                <div
                  key={task.id}
                  onClick={() => onSelectConversation(task.conversationId)}
                  className={cn(
                    "group relative flex text-left transition-all hover:bg-muted/50 border cursor-pointer",
                    activeConversationId === task.conversationId
                      ? "bg-neutral-100 dark:bg-[#ffffff0d] border-border/60 shadow-sm"
                      : "border-transparent hover:border-border/50",
                    task.status === "completed" && "opacity-60",
                    viewMode === "normal" ? "items-start gap-3 rounded-xl p-4 mb-2" :
                    viewMode === "compact" ? "items-start gap-2.5 rounded-lg p-3 mb-1.5" :
                    "items-center gap-2 rounded-md p-2 mb-1"
                  )}
                >
                  {/* Purple left accent: full when active, a hint on hover so
                      every card gets the polished highlight of the active one. */}
                  <div
                    className={cn(
                      "absolute left-0 top-3 bottom-3 w-1.5 rounded-r-md bg-primary transition-opacity",
                      activeConversationId === task.conversationId
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-50"
                    )}
                  />
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleTask(task.id);
                    }}
                    className={cn(
                      "flex-shrink-0 text-slate-400 hover:text-primary transition-colors relative z-10",
                      viewMode === "small" ? "mt-0" : "mt-0.5"
                    )}
                  >
                    {task.status === "completed" ? (
                      <CheckCircle2 className={cn(
                        "text-emerald-500",
                        viewMode === "normal" ? "h-6 w-6" : viewMode === "compact" ? "h-5 w-5" : "h-4 w-4"
                      )} />
                    ) : (
                      <Circle className={cn(
                        "stroke-[1.5]",
                        viewMode === "normal" ? "h-6 w-6" : viewMode === "compact" ? "h-5 w-5" : "h-4 w-4"
                      )} />
                    )}
                  </button>

                  <div className="flex flex-1 flex-col overflow-hidden pl-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn(
                        "font-semibold text-slate-900 dark:text-slate-100 line-clamp-1",
                        task.status === "completed" && "line-through text-slate-500",
                        viewMode === "normal" ? "text-[15px]" : viewMode === "compact" ? "text-[14px]" : "text-[13px]"
                      )}>
                        {task.title}
                      </span>
                      {viewMode !== "small" && (
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-6 w-6 rounded-md relative z-10"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>
                    
                    {viewMode !== "small" && (
                      <div className={cn("flex items-center gap-2", viewMode === "normal" ? "mt-2" : "mt-1")}>
                        <ChannelAvatar 
                          name={task.contact.name} 
                          src={task.contact.avatar} 
                          className={viewMode === "normal" ? "h-6 w-6" : "h-5 w-5"}
                        />
                        <span className={cn(
                          "text-slate-500 dark:text-slate-400 truncate",
                          viewMode === "normal" ? "text-[14px]" : "text-[13px]"
                        )}>
                          {task.contact.name}
                        </span>
                      </div>
                    )}

                    {viewMode !== "small" && (
                      <div className={cn("flex flex-wrap items-center gap-2", viewMode === "normal" ? "mt-3" : "mt-2")}>
                        <div className={cn(
                          "flex items-center gap-1.5 rounded-full font-medium",
                          viewMode === "normal" ? "px-2.5 py-1 text-[13px]" : "px-2 py-0.5 text-[12px]",
                          task.dueDate.includes("Ayer") ? "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400" :
                          task.dueDate.includes("Hoy") ? "bg-amber-100/80 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400" :
                          "bg-neutral-100 text-neutral-700 dark:bg-neutral-700/60 dark:text-neutral-300"
                        )}>
                          <Clock className={viewMode === "normal" ? "h-3.5 w-3.5" : "h-3 w-3"} />
                          {task.dueDate}
                        </div>
                        
                        {(() => {
                          // Resolve the assignee's avatar from the roster (the
                          // task only carries the name/id); fall back to initials.
                          const rosterUser = users.find(
                            (u) => u.id === task.assignee.id || u.name === task.assignee.name
                          );
                          const avatar = task.assignee.avatar || rosterUser?.avatar;
                          const hasName = Boolean(task.assignee.name && task.assignee.name !== "Agente");
                          return (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className={cn(
                                  "flex items-center justify-center overflow-hidden rounded-full bg-slate-100/80 text-slate-600 dark:bg-slate-800 dark:text-slate-400 shrink-0 border border-border/50",
                                  viewMode === "normal" ? "h-7 w-7" : "h-6 w-6"
                                )}>
                                  {avatar ? (
                                    <img src={avatar} alt={task.assignee.name} className="h-full w-full rounded-full object-cover" />
                                  ) : hasName ? (
                                    <span className={cn("font-semibold", viewMode === "normal" ? "text-[10px]" : "text-[9px]")}>
                                      {assigneeInitials(task.assignee.name)}
                                    </span>
                                  ) : (
                                    <UserIcon className={viewMode === "normal" ? "h-3.5 w-3.5" : "h-3 w-3"} />
                                  )}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>{task.assignee.name}</TooltipContent>
                            </Tooltip>
                          );
                        })()}
                      </div>
                    )}
                    
                    {viewMode === "small" && (
                      <div className="flex items-center gap-2 mt-0.5 text-[12px] text-slate-500">
                        <span className="truncate">{task.contact.name}</span>
                        <span>•</span>
                        <span className={cn(
                          task.dueDate.includes("Ayer") ? "text-rose-600 dark:text-rose-400" :
                          task.dueDate.includes("Hoy") ? "text-amber-600 dark:text-amber-400" : ""
                        )}>{task.dueDate}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
            {hasMore && (
              <button
                type="button"
                onClick={() =>
                  setVisibleCount((c) =>
                    Math.min(filteredTasks.length, c + TASK_PAGE_SIZE)
                  )
                }
                className="w-full py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                Mostrar más ({filteredTasks.length - visibleTasks.length})
              </button>
            )}
          </div>
        </ScrollArea>
      </div>
    </TooltipProvider>
  );
}
