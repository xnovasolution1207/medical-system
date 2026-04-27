// REST client for the backend (which proxies GoHighLevel).
// In dev, VITE_BACKEND_URL is empty → requests are same-origin and the Vite
// proxy rewrites /api → http://localhost:3001. In production (e.g. the SPA
// on Vercel, backend on Render), set VITE_BACKEND_URL at build time to the
// backend's absolute URL so fetches target it directly.
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
  conversationsNextCursor: number | null;
  pipelines: Pipeline[];
  stages: { id: string; label: string; color: string }[];
  opportunities: Opportunity[];
  tasks: Task[];
}

// Strip any trailing slash so we can always append "/api/..." cleanly.
const BACKEND_ORIGIN = (import.meta.env.VITE_BACKEND_URL ?? "").replace(/\/+$/, "");
const API_BASE = `${BACKEND_ORIGIN}/api`;

// Returns a URL that streams the given media file through the backend proxy.
// This sidesteps CORS restrictions and auth requirements on GHL's CDN for
// video and audio resources (which are more strictly enforced than images).
export function proxyMediaUrl(url: string): string {
  return `${API_BASE}/media?url=${encodeURIComponent(url)}`;
}

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
    list: (params?: { limit?: number; startAfterDate?: number; query?: string }) => {
      const qs = new URLSearchParams();
      if (params?.limit != null) qs.set("limit", String(params.limit));
      if (params?.startAfterDate != null) qs.set("startAfterDate", String(params.startAfterDate));
      if (params?.query) qs.set("query", params.query);
      const query = qs.toString();
      return request<{ conversations: Conversation[]; nextCursor: number | null }>(
        "GET",
        `/conversations${query ? `?${query}` : ""}`
      );
    },
    get: (id: string) => request<Conversation>("GET", `/conversations/${id}`),
    messages: (id: string, params?: { lastMessageId?: string; limit?: number }) => {
      const qs = new URLSearchParams();
      if (params?.lastMessageId) qs.set("lastMessageId", params.lastMessageId);
      if (params?.limit != null) qs.set("limit", String(params.limit));
      const query = qs.toString();
      return request<{ messages: Message[]; hasMore: boolean; oldestId?: string }>(
        "GET",
        `/conversations/${id}/messages${query ? `?${query}` : ""}`
      );
    },
    send: (
      id: string,
      payload: {
        text: string;
        channel?: Message["channel"];
        attachment?: Message["attachment"];
        mentions?: string[];
        reminder?: string;
        clientId?: string;
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
    delete: (id: string) => request<void>("DELETE", `/contacts/${id}`),
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
