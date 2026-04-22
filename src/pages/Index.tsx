import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Pipeline,
  Opportunity,
  User,
} from "@/components/chat/types";
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

export default function Index() {
  const { toast } = useToast();

  const [bootstrapped, setBootstrapped] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  const [currentUser, setCurrentUser] = useState<User>(FALLBACK_USER);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [stages, setStages] = useState<{ id: string; label: string; color: string }[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [savedViews, setSavedViews] = useState<SavedView[]>(INITIAL_SAVED_VIEWS);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [activeMainTab, setActiveMainTab] = useState("todos");
  const [taskUserFilters, setTaskUserFilters] = useState<string[]>([]);
  const [isContactSidebarOpen, setIsContactSidebarOpen] = useState(true);

  // Track which conversation message-lists we've already hydrated to avoid
  // refetching on every selection.
  const hydratedConversations = useRef<Set<string>>(new Set());

  // ---- Bootstrap ----
  useEffect(() => {
    let cancelled = false;
    api
      .bootstrap()
      .then((data: BootstrapPayload) => {
        if (cancelled) return;
        setCurrentUser(data.currentUser);
        setConversations(data.conversations);
        setOpportunities(data.opportunities);
        setPipelines(data.pipelines);
        setStages(data.stages);
        setTasks(data.tasks);
        setActiveId(data.conversations[0]?.id ?? null);
        setBootstrapped(true);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("bootstrap failed", err);
        setBootstrapError(err instanceof Error ? err.message : "Error al cargar datos");
        setBootstrapped(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- WebSocket subscription ----
  useEffect(() => {
    const sub = subscribe((event) => {
      if (event.type === "message.created") {
        setConversations((prev) =>
          prev.map((c) => {
            if (c.id !== event.conversationId) return c;
            // Skip duplicates if we already optimistically appended this id.
            if (c.messages.some((m) => m.id === event.message.id)) return c;
            return {
              ...c,
              messages: [...c.messages, event.message],
              lastMessage: event.message.text || c.lastMessage,
              timestamp: event.message.timestamp || c.timestamp,
            };
          })
        );
      } else if (event.type === "conversation.updated") {
        setConversations((prev) => {
          const idx = prev.findIndex((c) => c.id === event.conversation.id);
          if (idx === -1) return [event.conversation, ...prev];
          // Preserve already-hydrated message list when WS only refreshes header data.
          const existing = prev[idx];
          const merged: Conversation = {
            ...event.conversation,
            messages: existing.messages.length ? existing.messages : event.conversation.messages,
            scheduledMessages: existing.scheduledMessages ?? event.conversation.scheduledMessages,
          };
          const next = prev.slice();
          next[idx] = merged;
          return next;
        });
      } else if (event.type === "opportunity.updated") {
        setOpportunities((prev) => {
          const idx = prev.findIndex((o) => o.id === event.opportunity.id);
          if (idx === -1) return [event.opportunity, ...prev];
          const next = prev.slice();
          next[idx] = event.opportunity;
          return next;
        });
      } else if (event.type === "task.created") {
        setTasks((prev) => (prev.some((t) => t.id === event.task.id) ? prev : [event.task, ...prev]));
      } else if (event.type === "task.updated") {
        setTasks((prev) => prev.map((t) => (t.id === event.task.id ? event.task : t)));
      }
    });
    return () => sub.close();
  }, []);

  // ---- Lazy-hydrate full message list when a conversation is selected ----
  useEffect(() => {
    if (!activeId) return;
    if (hydratedConversations.current.has(activeId)) return;
    hydratedConversations.current.add(activeId);
    api.conversations
      .get(activeId)
      .then((full) => {
        setConversations((prev) => prev.map((c) => (c.id === full.id ? { ...c, ...full } : c)));
      })
      .catch((err) => console.error("conversation fetch failed", err));
  }, [activeId]);

  const activeConversation = conversations.find((c) => c.id === activeId);

  // ---- Handlers ----
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
      const optimisticId = `tmp-${Date.now()}`;
      const optimistic: Message = {
        id: optimisticId,
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

      setConversations((prev) =>
        prev.map((conv) =>
          conv.id === activeId
            ? {
                ...conv,
                messages: [...conv.messages, optimistic],
                lastMessage: text || "Archivo adjunto",
                timestamp: optimistic.timestamp,
                ...(reminder ? { activeReminder: reminder } : {}),
              }
            : conv
        )
      );

      api.conversations
        .send(activeId, { text, channel, attachment, mentions, reminder })
        .then((sent) => {
          setConversations((prev) =>
            prev.map((conv) =>
              conv.id === activeId
                ? {
                    ...conv,
                    messages: conv.messages.map((m) => (m.id === optimisticId ? { ...sent, replyTo } : m)),
                  }
                : conv
            )
          );
        })
        .catch((err) => {
          console.error("send failed", err);
          setConversations((prev) =>
            prev.map((conv) =>
              conv.id === activeId
                ? {
                    ...conv,
                    messages: conv.messages.map((m) =>
                      m.id === optimisticId ? { ...m, status: "error" as const } : m
                    ),
                  }
                : conv
            )
          );
          toast({ title: "No se pudo enviar el mensaje", description: String(err), variant: "destructive" });
        });
    },
    [activeId, currentUser.id, toast]
  );

  const handleScheduleMessage = useCallback(
    (conversationId: string, text: string, date: string, channel: Message["channel"]) => {
      const localChannel = (channel as "sms" | "email" | "whatsapp" | "internal") ?? "sms";
      const optimisticId = `sch-tmp-${Date.now()}`;
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? {
                ...c,
                scheduledMessages: [
                  ...(c.scheduledMessages ?? []),
                  { id: optimisticId, text, scheduledFor: date, channel: localChannel },
                ],
              }
            : c
        )
      );
      api.conversations
        .schedule(conversationId, { text, scheduledFor: date, channel: localChannel })
        .then((saved) => {
          setConversations((prev) =>
            prev.map((c) =>
              c.id === conversationId
                ? {
                    ...c,
                    scheduledMessages: (c.scheduledMessages ?? []).map((m) =>
                      m.id === optimisticId ? { ...m, id: saved.id } : m
                    ),
                  }
                : c
            )
          );
        })
        .catch((err) => console.error("schedule failed", err));
    },
    []
  );

  const handleCancelScheduledMessage = useCallback((conversationId: string, messageId: string) => {
    setConversations((prev) =>
      prev.map((c) =>
        c.id === conversationId
          ? { ...c, scheduledMessages: (c.scheduledMessages ?? []).filter((m) => m.id !== messageId) }
          : c
      )
    );
    api.conversations.cancelScheduled(conversationId, messageId).catch((err) =>
      console.error("cancel scheduled failed", err)
    );
  }, []);

  const handleUpdateStage = useCallback(
    (id: string, stage: Conversation["stage"]) => {
      setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, stage } : c)));
      api.conversations.patch(id, { stage }).catch((err) => console.error("stage update failed", err));
      // If this conversation has an opportunity, also move it server-side.
      const conv = conversations.find((c) => c.id === id);
      const opp = conv?.contactId
        ? opportunities.find((o) => o.contactId === conv.contactId)
        : undefined;
      if (opp && opp.stageId !== stage) {
        setOpportunities((prev) =>
          prev.map((o) => (o.id === opp.id ? { ...o, stageId: stage } : o))
        );
        api.opportunities.move(opp.id, stage).catch((err) =>
          console.error("opportunity move failed", err)
        );
      }
    },
    [conversations, opportunities]
  );

  const handleClearReminder = useCallback((id: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, activeReminder: undefined } : c))
    );
    api.conversations.patch(id, { activeReminder: null }).catch((err) =>
      console.error("clear reminder failed", err)
    );
  }, []);

  const handleSetReminder = useCallback((id: string, reminder: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, activeReminder: reminder } : c))
    );
    api.conversations.patch(id, { activeReminder: reminder }).catch((err) =>
      console.error("set reminder failed", err)
    );
  }, []);

  const handleToggleFavorite = useCallback((id: string) => {
    let nextValue = false;
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        nextValue = !c.isFavorite;
        return { ...c, isFavorite: nextValue };
      })
    );
    api.conversations.patch(id, { isFavorite: nextValue }).catch((err) =>
      console.error("toggle favorite failed", err)
    );
  }, []);

  const handleUpdateContactName = useCallback(
    (contactId: string, newName: string) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.participant.id === contactId
            ? { ...c, participant: { ...c.participant, name: newName } }
            : c
        )
      );
      api.contacts.update(contactId, { name: newName }).catch((err) => {
        console.error("contact update failed", err);
        toast({ title: "No se pudo actualizar el contacto", description: String(err), variant: "destructive" });
      });
    },
    [toast]
  );

  const handleAddTask = useCallback(
    (task: Omit<Task, "id">) => {
      const optimisticId = `t-tmp-${Date.now()}`;
      const optimistic: Task = { ...task, id: optimisticId };
      setTasks((prev) => [optimistic, ...prev]);
      if (!task.conversationId) return;
      api.tasks
        .create({
          conversationId: task.conversationId,
          title: task.title,
          dueDate: task.dueDate,
          assignedTo: task.assignee.name,
        })
        .then((saved) => {
          setTasks((prev) => prev.map((t) => (t.id === optimisticId ? saved : t)));
        })
        .catch((err) => {
          console.error("create task failed", err);
          setTasks((prev) => prev.filter((t) => t.id !== optimisticId));
          toast({ title: "No se pudo crear la tarea", description: String(err), variant: "destructive" });
        });
    },
    [toast]
  );

  const handleToggleTask = useCallback(
    (id: string) => {
      let nextStatus: Task["status"] = "completed";
      let contactId: string | undefined;
      setTasks((prev) =>
        prev.map((t) => {
          if (t.id !== id) return t;
          nextStatus = t.status === "completed" ? "pending" : "completed";
          const conv = conversations.find((c) => c.id === t.conversationId);
          contactId = conv?.contactId ?? conv?.participant.id;
          return { ...t, status: nextStatus };
        })
      );
      if (contactId && !id.startsWith("t-tmp-")) {
        api.tasks
          .setCompleted(contactId, id, nextStatus === "completed")
          .catch((err) => console.error("toggle task failed", err));
      }
    },
    [conversations]
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

  const handleMoveOpportunity = useCallback((id: string, stageId: string) => {
    setOpportunities((prev) => prev.map((o) => (o.id === id ? { ...o, stageId } : o)));
    api.opportunities.move(id, stageId).catch((err) => console.error("opportunity move failed", err));
  }, []);

  const opportunitiesPipeline = useMemo(() => pipelines[0], [pipelines]);

  if (!bootstrapped) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background text-muted-foreground">
        Cargando datos de GoHighLevel…
      </div>
    );
  }

  if (bootstrapError) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center gap-2 bg-background p-6 text-center">
        <h1 className="text-xl font-semibold">No se pudo conectar al backend</h1>
        <p className="text-sm text-muted-foreground max-w-lg">{bootstrapError}</p>
        <p className="text-xs text-muted-foreground">
          Verifica que el backend esté corriendo en http://localhost:3001 y que GHL_API_KEY/GHL_LOCATION_ID estén configurados.
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
            />
          ) : (
            <ChatSidebar
              conversations={conversations}
              tasks={tasks}
              activeConversationId={activeId || ""}
              onSelectConversation={setActiveId}
              onToggleFavorite={handleToggleFavorite}
              activeViewId={activeViewId}
              savedViews={savedViews}
              onSaveView={handleSaveView}
              stages={stages}
              activeTab={activeMainTab}
            />
          )}
        </div>
      )}

      {activeMainTab === "oportunidades" ? (
        <div className="flex-1 h-full min-w-0 overflow-hidden">
          <OpportunitiesView
            opportunities={opportunities}
            pipeline={opportunitiesPipeline}
            onMoveOpportunity={handleMoveOpportunity}
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
              onToggleContactSidebar={() => setIsContactSidebarOpen(!isContactSidebarOpen)}
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
            isContactSidebarOpen ? "w-80 xl:w-96 border-l" : "w-0 overflow-hidden border-none"
          )}
        >
          <div className="w-80 xl:w-96 h-full">
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
    </div>
  );
}
