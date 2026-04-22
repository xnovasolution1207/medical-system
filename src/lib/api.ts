// REST client for the backend (which proxies GoHighLevel).
// All paths are relative; Vite proxies /api → http://localhost:3001 in dev.
import type {
  Conversation,
  Message,
  Opportunity,
  Pipeline,
  Task,
  User,
} from "@/components/chat/types";

export interface BootstrapPayload {
  currentUser: User;
  conversations: Conversation[];
  pipelines: Pipeline[];
  stages: { id: string; label: string; color: string }[];
  opportunities: Opportunity[];
  tasks: Task[];
}

const API_BASE = "/api";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`API ${method} ${path} ${res.status}: ${errText}`);
  }
  if (res.status === 204) return undefined as T;
  const json = await res.json();
  return (json && "data" in json ? json.data : json) as T;
}

export const api = {
  bootstrap: () => request<BootstrapPayload>("GET", "/bootstrap"),

  conversations: {
    list: () => request<Conversation[]>("GET", "/conversations"),
    get: (id: string) => request<Conversation>("GET", `/conversations/${id}`),
    messages: (id: string) => request<Message[]>("GET", `/conversations/${id}/messages`),
    send: (
      id: string,
      payload: {
        text: string;
        channel?: Message["channel"];
        attachment?: Message["attachment"];
        mentions?: string[];
        reminder?: string;
      }
    ) => request<Message>("POST", `/conversations/${id}/messages`, payload),
    patch: (
      id: string,
      patch: Partial<{ isFavorite: boolean; activeReminder: string | null; stage: string }>
    ) => request<Record<string, unknown>>("PATCH", `/conversations/${id}`, patch),
    schedule: (
      id: string,
      payload: { text: string; scheduledFor: string; channel?: Message["channel"] }
    ) => request<{ id: string }>("POST", `/conversations/${id}/scheduled`, payload),
    cancelScheduled: (id: string, messageId: string) =>
      request<{ ok: boolean }>("DELETE", `/conversations/${id}/scheduled/${messageId}`),
  },

  contacts: {
    update: (id: string, patch: { name?: string; email?: string; phone?: string; tags?: string[] }) =>
      request<User>("PATCH", `/contacts/${id}`, patch),
  },

  opportunities: {
    list: () => request<Opportunity[]>("GET", "/opportunities"),
    pipelines: () => request<Pipeline[]>("GET", "/opportunities/pipelines"),
    move: (id: string, stageId: string) =>
      request<Opportunity>("PATCH", `/opportunities/${id}`, { stageId }),
    create: (payload: {
      name: string;
      contactId: string;
      pipelineId: string;
      stageId: string;
    }) => request<Opportunity>("POST", "/opportunities", payload),
  },

  tasks: {
    list: () => request<Task[]>("GET", "/tasks"),
    create: (payload: {
      conversationId: string;
      title: string;
      dueDate: string;
      assignedTo?: string;
    }) => request<Task>("POST", "/tasks", payload),
    setCompleted: (contactId: string, taskId: string, completed: boolean) =>
      request<Task>("PATCH", `/tasks/${contactId}/${taskId}`, { completed }),
  },
};
