// REST client for the backend (which proxies GoHighLevel).
// In dev, VITE_BACKEND_URL is empty → requests are same-origin and the Vite
// proxy rewrites /api → http://localhost:3001. In production (e.g. the SPA
// on Vercel, backend on Render), set VITE_BACKEND_URL at build time to the
// backend's absolute URL so fetches target it directly.
import type {
  AgentUser,
  Conversation,
  FamilyMember,
  LeadBundle,
  Message,
  Opportunity,
  Pipeline,
  TagSummary,
  Task,
  User,
} from "@/components/chat/types";
import { getAuthToken, setAuthToken } from "./auth";

export interface BootstrapPayload {
  currentUser: User;
  conversations: Conversation[];
  conversationsNextCursor: number | null;
  pipelines: Pipeline[];
  stages: { id: string; label: string; color: string }[];
  opportunities: Opportunity[];
  tasks: Task[];
  // Roster of GHL staff users for agent-pickers (Propietario / Seguidores).
  // Empty when the GHL token lacks `users.readonly`.
  users: AgentUser[];
  // Location-level tag library — populates the "Etiquetas" autocomplete.
  // Empty when the GHL token lacks `locations.readonly`.
  tags: TagSummary[];
}

// Strip any trailing slash so we can always append "/api/..." cleanly.
const BACKEND_ORIGIN = (import.meta.env.VITE_BACKEND_URL ?? "").replace(/\/+$/, "");
const API_BASE = `${BACKEND_ORIGIN}/api`;

// Hosts that require backend mediation (Bearer auth on the GHL API).
// Everything else — public GHL CDN buckets, WhatsApp/Facebook media, etc. —
// is fetched directly by the browser; round-tripping public CDN bytes
// through our backend just adds latency and forces us to allow-list every
// new bucket GHL introduces.
const AUTH_REQUIRED_HOSTS = new Set(["services.leadconnectorhq.com"]);

export function proxyMediaUrl(url: string): string {
  try {
    const u = new URL(url);
    if (AUTH_REQUIRED_HOSTS.has(u.hostname)) {
      return `${API_BASE}/media?url=${encodeURIComponent(url)}`;
    }
  } catch {
    // Malformed/relative URL — fall through and use as-is.
  }
  return url;
}

// Backend errors come back as JSON `{ error: "...", stack?: "..." }`.
// We extract just the `error` field for display so the toast doesn't
// dump a stack trace (or the raw response body) into the user's face.
// Logged in full to the console for debugging — the message stays clean
// but a developer can still inspect the response.
async function parseErrorMessage(
  res: Response,
  method: string,
  path: string
): Promise<string> {
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const direct =
      typeof obj.error === "string"
        ? obj.error
        : typeof obj.message === "string"
          ? obj.message
          : null;
    if (direct) {
      console.error(`[api] ${method} ${path} ${res.status}:`, parsed);
      return direct;
    }
  }
  // Couldn't extract a user-facing message — fall back to status + a
  // short generic line. Still log the body for diagnosis.
  console.error(`[api] ${method} ${path} ${res.status}:`, text || "(empty body)");
  if (res.status >= 500) return `Error del servidor (${res.status}).`;
  if (res.status === 404) return "El recurso no existe.";
  if (res.status === 403) return "No tienes permiso para esta acción.";
  if (res.status === 400) return "Solicitud inválida.";
  return `Error ${res.status}.`;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  // Attach the OAuth-issued JWT when present. Backend's `requireSession`
  // pulls this off `Authorization: Bearer …` and resolves it to the
  // session in Redis.
  const token = getAuthToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    // Token expired or session evicted from Redis. Clear it so
    // AuthProvider re-routes to /login on the next render.
    if (token) setAuthToken(null);
    throw new Error("Tu sesión ha caducado. Inicia sesión de nuevo.");
  }
  if (!res.ok) {
    const message = await parseErrorMessage(res, method, path);
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  const json = await res.json();
  return (json && "data" in json ? json.data : json) as T;
}

export const api = {
  bootstrap: () => request<BootstrapPayload>("GET", "/bootstrap"),

  auth: {
    // Returns the GHL authorize URL the SPA should send the browser to.
    startLogin: () => request<{ url: string }>("GET", "/auth/login"),
    // Identifies the current session — drives the route guard's
    // "loaded?authenticated" decision after a reload.
    me: () =>
      request<{
        userId: string;
        locationId: string;
        userType: string | null;
        sessionExpiresAt: number;
      }>("GET", "/auth/me"),
    logout: () => request<{ ok: boolean }>("POST", "/auth/logout"),
    profile: {
      // Full GHL user record — drives the Profile form. Returns empty
      // strings (not null) for missing fields so the form can use them
      // as controlled input values directly.
      get: () =>
        request<{
          id: string;
          firstName: string;
          lastName: string;
          email: string;
          phone: string;
          profilePhoto: string | null;
        }>("GET", "/auth/me/profile"),
      // Update the GHL user. Optional `currentPassword` /
      // `newPassword` / `confirmPassword` trigger the password-change
      // path on the backend; all three are required together. The
      // backend probes a couple of GHL endpoints and surfaces a clean
      // error if none accept the change.
      update: (patch: {
        firstName?: string;
        lastName?: string;
        email?: string;
        phone?: string;
        profilePhoto?: string;
        currentPassword?: string;
        newPassword?: string;
        confirmPassword?: string;
      }) =>
        request<{
          id: string;
          firstName: string;
          lastName: string;
          email: string;
          phone: string;
          profilePhoto: string | null;
        }>("PATCH", "/auth/me/profile", patch),
      // Upload a new avatar via multipart. Bypasses the JSON `request`
      // helper because the body is FormData — but mirrors its 401-handling
      // and uses the same `parseErrorMessage` for clean toast text.
      uploadAvatar: async (file: File): Promise<{ profilePhoto: string }> => {
        const form = new FormData();
        form.append("file", file);
        const headers: Record<string, string> = {};
        const token = getAuthToken();
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const res = await fetch(`${API_BASE}/auth/me/avatar`, {
          method: "POST",
          headers,
          body: form,
        });
        if (res.status === 401) {
          if (token) setAuthToken(null);
          throw new Error("Tu sesión ha caducado. Inicia sesión de nuevo.");
        }
        if (!res.ok) {
          throw new Error(await parseErrorMessage(res, "POST", "/auth/me/avatar"));
        }
        const json = await res.json();
        return (json && "data" in json ? json.data : json) as { profilePhoto: string };
      },
    },
  },

  // Chat-message attachment uploads. POSTs the file + conversationId as
  // multipart to the backend, which forwards the bytes to GHL's
  // conversation-attachment endpoint and returns the URL we then attach
  // to the outbound message. conversationId is required because GHL
  // scopes the asset to that conversation; only URLs produced this way
  // are recognised by GHL's send-message handler as proper media.
  uploads: {
    create: async (
      file: File,
      conversationId: string
    ): Promise<{ url: string; name: string; size: number; mimeType: string }> => {
      const form = new FormData();
      form.append("file", file);
      form.append("conversationId", conversationId);
      const headers: Record<string, string> = {};
      const token = getAuthToken();
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`${API_BASE}/uploads`, {
        method: "POST",
        headers,
        body: form,
      });
      if (res.status === 401) {
        if (token) setAuthToken(null);
        throw new Error("Tu sesión ha caducado. Inicia sesión de nuevo.");
      }
      if (!res.ok) {
        throw new Error(await parseErrorMessage(res, "POST", "/uploads"));
      }
      const json = await res.json();
      return (json && "data" in json ? json.data : json) as {
        url: string;
        name: string;
        size: number;
        mimeType: string;
      };
    },
  },

  conversations: {
    list: (params?: {
      limit?: number;
      startAfterDate?: number;
      query?: string;
      // Advanced-filter pass-through. Forwarded to GHL's native conversation
      // search so filtering operates over the whole location, not just the
      // currently loaded window. Empty / undefined drops the param.
      assignedTo?: string;
      followers?: string;
      mentions?: string;
      tags?: string;
      lastMessageType?: string;
      lastMessageDirection?: "inbound" | "outbound";
      status?: string;
      mode?: "AND" | "OR";
    }) => {
      const qs = new URLSearchParams();
      if (params?.limit != null) qs.set("limit", String(params.limit));
      if (params?.startAfterDate != null) qs.set("startAfterDate", String(params.startAfterDate));
      if (params?.query) qs.set("query", params.query);
      if (params?.assignedTo) qs.set("assignedTo", params.assignedTo);
      if (params?.followers) qs.set("followers", params.followers);
      if (params?.mentions) qs.set("mentions", params.mentions);
      if (params?.tags) qs.set("tags", params.tags);
      if (params?.lastMessageType) qs.set("lastMessageType", params.lastMessageType);
      if (params?.lastMessageDirection)
        qs.set("lastMessageDirection", params.lastMessageDirection);
      if (params?.status) qs.set("status", params.status);
      if (params?.mode) qs.set("mode", params.mode);
      const query = qs.toString();
      return request<{ conversations: Conversation[]; nextCursor: number | null }>(
        "GET",
        `/conversations${query ? `?${query}` : ""}`
      );
    },
    get: (id: string) => request<Conversation>("GET", `/conversations/${id}`),
    // Total unread-conversation count across the whole GHL location.
    // Drives the "No leídos" sidebar badge so the number reflects every
    // unread lead in the tenant, not just the locally-loaded page.
    unreadCount: () =>
      request<{ total: number }>("GET", "/conversations/unread-count"),
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
      patch: Partial<{
        isFavorite: boolean;
        activeReminder: string | null;
        stage: string;
        // Add a snapshot to the conversation's pinned-message stack
        // (each pin renders as a banner above the chat). Pass `null`
        // to clear ALL pins (legacy clear-all path).
        pinnedMessage:
          | {
              id: string;
              text: string;
              date?: string;
              senderName?: string;
              channel?: string;
            }
          | null;
        // Remove a single pin by message id.
        unpinMessageId: string;
      }>
    ) => request<Record<string, unknown>>("PATCH", `/conversations/${id}`, patch),
    // Schedule a message into the future. `text` is optional when a
    // `templateId` is supplied (the backend resolves the body from GHL
    // at dispatch time so any template edit between now and scheduledFor
    // is honoured). WhatsApp messages > 24h after the last inbound MUST
    // pass a templateId per Meta policy — the SPA enforces that.
    schedule: (
      id: string,
      payload: {
        scheduledFor: string;
        channel?: Message["channel"];
        text?: string;
        templateId?: string;
        templateName?: string;
      }
    ) => request<{ id: string }>("POST", `/conversations/${id}/scheduled`, payload),
    cancelScheduled: (id: string, messageId: string) =>
      request<{ ok: boolean }>("DELETE", `/conversations/${id}/scheduled/${messageId}`),
  },

  // Saved GHL location templates / snippets. Used by the scheduling
  // dialog so the agent can pick a Meta-approved WhatsApp template
  // (mandatory for WhatsApp after 24h of conversation silence).
  templates: {
    list: (params?: { type?: "sms" | "whatsapp" | "email" }) => {
      const qs = new URLSearchParams();
      if (params?.type) qs.set("type", params.type);
      const q = qs.toString();
      return request<{
        templates: { id: string; name: string; type: string; body: string }[];
      }>("GET", `/templates${q ? `?${q}` : ""}`);
    },
  },

  // "Plantillas rápidas" — agent's local canned messages. Backed by
  // Prisma/SQLite per-location so they survive reloads + restarts.
  // The Zap toolbar popover and the Gestionar Plantillas dialog both
  // talk through these methods.
  quickTemplates: {
    list: () =>
      request<{
        templates: { id: string; title: string; body: string; category: string }[];
      }>("GET", "/quick-templates"),
    create: (payload: { title: string; body: string; category?: string }) =>
      request<{ id: string; title: string; body: string; category: string }>(
        "POST",
        "/quick-templates",
        payload
      ),
    update: (
      id: string,
      patch: { title?: string; body?: string; category?: string }
    ) =>
      request<{ id: string; title: string; body: string; category: string }>(
        "PATCH",
        `/quick-templates/${id}`,
        patch
      ),
    remove: (id: string) =>
      request<{ ok: boolean }>("DELETE", `/quick-templates/${id}`),
  },

  contacts: {
    // Fetch a single contact by id. Used by the opportunity chat
    // modal when the local conversations cache doesn't contain a
    // conversation for the picked opportunity yet — the modal still
    // wants to render the right-rail contact panel.
    get: (id: string) => request<User>("GET", `/contacts/${id}`),
    // Full lead bundle for a contact (contact + most-recent
    // conversation + messages + tasks). Same shape the WS
    // `lead.updated` event ships. Used by the opportunity chat
    // modal to recover the conversation when it's not already in
    // the SPA's loaded window.
    getLead: (id: string) =>
      request<LeadBundle>("GET", `/contacts/${id}/lead`),
    create: (payload: {
      name?: string;
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string;
      tags?: string[];
    }) => request<User>("POST", `/contacts`, payload),
    update: (
      id: string,
      patch: {
        name?: string;
        email?: string;
        phone?: string;
        tags?: string[];
        // GHL user id that owns the contact. Pass null/empty string to clear.
        assignedTo?: string | null;
        // Local-only watchlist of GHL user ids. Pass an empty array to clear.
        followers?: string[];
      }
    ) => request<User>("PATCH", `/contacts/${id}`, patch),
    delete: (id: string) => request<void>("DELETE", `/contacts/${id}`),
    // Family / dependents — the "Agregar familiar" modal in the right
    // rail. `addFamily` creates a brand-new GHL contact for the family
    // member and stores the link locally; the response carries the
    // FamilyMember entry the SPA appends to the active contact.
    addFamily: (
      id: string,
      payload: {
        name: string;
        phone: string;
        relationship: FamilyMember["relationship"];
      }
    ) => request<FamilyMember>("POST", `/contacts/${id}/family`, payload),
    removeFamily: (id: string, relationId: string) =>
      request<void>("DELETE", `/contacts/${id}/family/${relationId}`),
    listFamily: (id: string) =>
      request<FamilyMember[]>("GET", `/contacts/${id}/family`),
  },

  opportunities: {
    list: () => request<Opportunity[]>("GET", "/opportunities"),
    pipelines: () => request<Pipeline[]>("GET", "/opportunities/pipelines"),
    move: (id: string, stageId: string) =>
      request<Opportunity>("PATCH", `/opportunities/${id}`, { stageId }),
    // Patch fields other than the pipeline stage. Used by the right-rail
    // status badge (Abierto / Perdido / Ganado / Abandonado) and the
    // adjacent monetary-value field. Backend broadcasts an
    // `opportunity.updated` WS event so other clients reconcile.
    update: (
      id: string,
      patch: {
        status?: Opportunity["status"];
        monetaryValue?: number;
        name?: string;
      }
    ) => request<Opportunity>("PATCH", `/opportunities/${id}`, patch),
    create: (payload: {
      name: string;
      contactId: string;
      pipelineId: string;
      stageId: string;
      monetaryValue?: number;
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
