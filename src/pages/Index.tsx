import React, { useState } from "react";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { TaskList } from "@/components/chat/TaskList";
import { ChatMessageArea } from "@/components/chat/ChatMessageArea";
import { ContactSidebar } from "@/components/chat/ContactSidebar";
import { MainSidebar } from "@/components/chat/MainSidebar";
import { OpportunitiesView } from "@/components/chat/OpportunitiesView";
import { mockConversations, currentUser, mockTasks } from "@/components/chat/mockData";
import { Message, Conversation, SavedView, Task } from "@/components/chat/types";
import { cn } from "@/lib/utils";

const INITIAL_SAVED_VIEWS: SavedView[] = [
  { id: "v1", name: "Meta", filters: [], logic: "AND" },
  { id: "v2", name: "Tik Tok", filters: [], logic: "AND" },
  { id: "v3", name: "Google", filters: [], logic: "AND" },
  { id: "v4", name: "Caliente", filters: [], logic: "AND" },
  { id: "v5", name: "Seguimiento", filters: [], logic: "AND" }
];

export default function Index() {
  const [conversations, setConversations] = useState(mockConversations);
  const [activeId, setActiveId] = useState<string | null>(conversations[0]?.id || null);
  const [tasks, setTasks] = useState<Task[]>(mockTasks);
  const [savedViews, setSavedViews] = useState<SavedView[]>(INITIAL_SAVED_VIEWS);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [activeMainTab, setActiveMainTab] = useState("todos");
  const [taskUserFilters, setTaskUserFilters] = useState<string[]>([]);
  const [isContactSidebarOpen, setIsContactSidebarOpen] = useState(true);
  const [stages, setStages] = useState([
    { id: "caliente", label: "Caliente", color: "bg-rose-500" },
    { id: "tibio", label: "Tibio", color: "bg-amber-500" },
    { id: "agendado", label: "Agendado", color: "bg-emerald-500" },
    { id: "frio", label: "Frío", color: "bg-sky-500" },
  ]);

  const activeConversation = conversations.find((c) => c.id === activeId);

  const handleSendMessage = (text: string, attachment?: Message["attachment"], channel: Message["channel"] = "sms", mentions?: string[], reminder?: string, replyTo?: Message["replyTo"]) => {
    if (!activeId) return;

    const newMessage: Message = {
      id: `m${Date.now()}`,
      senderId: currentUser.id,
      text,
      timestamp: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      isRead: true,
      attachment,
      channel,
      mentions,
      reminder,
      replyTo
    };

    setConversations((prev) =>
      prev.map((conv) => {
        if (conv.id === activeId) {
          return {
            ...conv,
            lastMessage: text || "Archivo adjunto",
            timestamp: "Just now",
            messages: [...conv.messages, newMessage],
            ...(reminder ? { activeReminder: reminder } : {}),
          };
        }
        return conv;
      })
    );
  };

  const handleScheduleMessage = (conversationId: string, text: string, date: string, channel: Message["channel"]) => {
    setConversations((prev) =>
      prev.map((conv) => {
        if (conv.id === conversationId) {
          const newScheduled = {
            id: `sch${Date.now()}`,
            text,
            scheduledFor: date,
            channel: channel as any,
          };
          return {
            ...conv,
            scheduledMessages: [...(conv.scheduledMessages || []), newScheduled],
          };
        }
        return conv;
      })
    );
  };

  const handleCancelScheduledMessage = (conversationId: string, messageId: string) => {
    setConversations((prev) =>
      prev.map((conv) => {
        if (conv.id === conversationId) {
          return {
            ...conv,
            scheduledMessages: conv.scheduledMessages?.filter(m => m.id !== messageId),
          };
        }
        return conv;
      })
    );
  };

  const handleUpdateStage = (id: string, stage: Conversation["stage"]) => {
    setConversations((prev) =>
      prev.map((conv) => (conv.id === id ? { ...conv, stage } : conv))
    );
  };

  const handleClearReminder = (id: string) => {
    setConversations((prev) =>
      prev.map((conv) => (conv.id === id ? { ...conv, activeReminder: undefined } : conv))
    );
  };

  const handleSetReminder = (id: string, reminder: string) => {
    setConversations((prev) =>
      prev.map((conv) => (conv.id === id ? { ...conv, activeReminder: reminder } : conv))
    );
  };

  const handleToggleFavorite = (id: string) => {
    setConversations((prev) =>
      prev.map((conv) =>
        conv.id === id ? { ...conv, isFavorite: !conv.isFavorite } : conv
      )
    );
  };

  const handleUpdateContactName = (id: string, newName: string) => {
    setConversations((prev) =>
      prev.map((conv) => {
        if (conv.participant.id === id) {
          return {
            ...conv,
            participant: { ...conv.participant, name: newName }
          };
        }
        return conv;
      })
    );
  };

  const handleAddTask = (task: Omit<Task, "id">) => {
    const newTask: Task = { ...task, id: `t${Date.now()}` };
    setTasks((prev) => [...prev, newTask]);
  };

  const handleToggleTask = (id: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status: t.status === "completed" ? "pending" : "completed" } : t))
    );
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* Main Navigation Rail - hidden on mobile */}
      <div className="h-full shrink-0 hidden md:block">
        <MainSidebar 
          savedViews={savedViews}
          activeViewId={activeViewId}
          onSelectView={setActiveViewId}
          activeTab={activeMainTab}
          onSelectTab={setActiveMainTab}
          taskUserFilters={taskUserFilters}
          setTaskUserFilters={setTaskUserFilters}
          onDeleteView={(id) => {
            setSavedViews(prev => prev.filter(v => v.id !== id));
            if (activeViewId === id) setActiveViewId(null);
          }}
        />
      </div>

      {/* Left Sidebar - hidden on mobile if a chat is active */}
      {activeMainTab !== "oportunidades" && (
        <div
          className={`h-full shrink-0 ${
            activeId ? "hidden md:block" : "block w-full md:w-auto"
          }`}
        >
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
              onSaveView={(view) => {
                setSavedViews(prev => {
                  const exists = prev.find(v => v.id === view.id);
                  if (exists) {
                    return prev.map(v => v.id === view.id ? view : v);
                  }
                  return [...prev, view];
                });
                setActiveViewId(view.id);
              }}
              stages={stages}
              activeTab={activeMainTab}
            />
          )}
        </div>
      )}

      {/* Main Chat Area - hidden on mobile if no chat is active */}
      {activeMainTab === "oportunidades" ? (
        <div className="flex-1 h-full min-w-0 overflow-hidden">
          <OpportunitiesView />
        </div>
      ) : (
        <div
          className={`flex-1 h-full min-w-0 ${
            !activeId ? "hidden md:flex" : "flex"
          }`}
        >
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
              <h3 className="text-xl font-semibold text-foreground">
                Bandeja de Entrada
              </h3>
              <p className="mt-2 max-w-sm text-muted-foreground">
                Selecciona una conversación de la barra lateral para comenzar a enviar mensajes.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Right Sidebar - Contact Details */}
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
              onUpdateContactName={(newName) => handleUpdateContactName(activeConversation.participant.id, newName)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
