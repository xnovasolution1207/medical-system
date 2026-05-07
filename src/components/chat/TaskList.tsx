import React, { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChannelAvatar } from "./ChannelAvatar";
import { CheckCircle2, Circle, Clock, User as UserIcon, Edit2, LayoutList, AlignJustify, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Task } from "./types";

interface TaskListProps {
  tasks: Task[];
  onToggleTask: (id: string) => void;
  filterType: string;
  selectedUsers: string[];
  onSelectConversation: (id: string) => void;
  activeConversationId: string;
}

export function TaskList({ tasks, onToggleTask, filterType, selectedUsers, onSelectConversation, activeConversationId }: TaskListProps) {
  const [viewMode, setViewMode] = useState<"normal" | "compact" | "small">("normal");

  const filteredTasks = tasks.filter(t => {
    // 1. Filter by user if selectedUsers is not empty
    if (selectedUsers.length > 0 && !selectedUsers.includes(t.assignee.name)) {
      return false;
    }

    // 2. Filter by date/status
    if (filterType === "tareas-hoy") return t.dueDate.includes("Hoy") && t.status !== "completed";
    if (filterType === "tareas-atrasado") return (t.dueDate.includes("Ayer") || t.dueDate.includes("Atrasado")) && t.status !== "completed";
    if (filterType === "tareas-proximos") return (t.dueDate.includes("Mañana") || t.dueDate.includes("Próximos")) && t.status !== "completed";
    if (filterType === "tareas-realizadas") return t.status === "completed";
    if (filterType.startsWith("tareas-") && !["tareas-hoy", "tareas-atrasado", "tareas-proximos", "tareas-realizadas", "tareas-personalizada"].includes(filterType)) {
      const customDateStr = filterType.replace("tareas-", "");
      return t.dueDate.toLowerCase().includes(customDateStr.toLowerCase());
    }
    return true; // para "tareas-personalizada" o todos
  });

  return (
    <TooltipProvider>
      <div className="flex h-full w-full flex-col border-r bg-card text-card-foreground sm:w-80 lg:w-[350px]">
        <div className="flex flex-col border-b">
          <div className="flex h-[68px] items-center justify-between px-4 py-3">
            <h2 className="text-lg font-bold tracking-tight">Tareas</h2>
            <div className="flex items-center gap-3">
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

        <ScrollArea className="flex-1">
          <div className="flex flex-col gap-0.5 p-2">
            {filteredTasks.length === 0 ? (
              <div className="text-center p-8 text-sm text-muted-foreground flex flex-col items-center gap-2">
                <CheckCircle2 className="h-8 w-8 text-muted-foreground/50" />
                <p>No hay tareas para esta vista</p>
              </div>
            ) : (
              filteredTasks.map((task) => (
                <div
                  key={task.id}
                  onClick={() => onSelectConversation(task.conversationId)}
                  className={cn(
                    "group relative flex text-left transition-all hover:bg-muted/50 border cursor-pointer",
                    activeConversationId === task.conversationId 
                      ? "bg-slate-50/50 dark:bg-slate-900/50 border-border/50 shadow-sm" 
                      : "border-transparent hover:border-border/50",
                    task.status === "completed" && "opacity-60",
                    viewMode === "normal" ? "items-start gap-3 rounded-xl p-4 mb-2" : 
                    viewMode === "compact" ? "items-start gap-2.5 rounded-lg p-3 mb-1.5" : 
                    "items-center gap-2 rounded-md p-2 mb-1"
                  )}
                >
                  {activeConversationId === task.conversationId && (
                    <div className="absolute left-0 top-3 bottom-3 w-1.5 rounded-r-md bg-primary" />
                  )}
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
                          "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400"
                        )}>
                          <Clock className={viewMode === "normal" ? "h-3.5 w-3.5" : "h-3 w-3"} />
                          {task.dueDate}
                        </div>
                        
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className={cn(
                              "flex items-center justify-center rounded-full bg-slate-100/80 text-slate-600 dark:bg-slate-800 dark:text-slate-400 shrink-0 border border-border/50",
                              viewMode === "normal" ? "h-7 w-7" : "h-6 w-6"
                            )}>
                              {task.assignee.avatar ? (
                                <img src={task.assignee.avatar} alt={task.assignee.name} className="h-full w-full rounded-full object-cover" />
                              ) : (
                                <UserIcon className={viewMode === "normal" ? "h-3.5 w-3.5" : "h-3 w-3"} />
                              )}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>{task.assignee.name}</TooltipContent>
                        </Tooltip>
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
          </div>
        </ScrollArea>
      </div>
    </TooltipProvider>
  );
}
