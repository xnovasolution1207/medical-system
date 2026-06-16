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
  MessageTemplate,
  Opportunity,
  Pipeline,
  SavedView,
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

// Fetch an attachment via the backend media proxy and save it to disk with
// the supplied filename. Always goes through the proxy so we get reliable
// GHL auth, broad CDN-host coverage (GCS, WhatsApp, FB, etc.) and CORS-free
// blob access — the `download` attribute on an anchor only honors the
// filename when the href is same-origin or a blob: URL. Falls back to
// opening the original URL in a new tab if the proxy refuses (e.g. host
// not in the backend allowlist).
export async function downloadAttachment(
  url: string,
  filename: string
): Promise<void> {
  const proxied = `${API_BASE}/media?url=${encodeURIComponent(url)}`;
  const token = getAuthToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  let blob: Blob;
  try {
    const res = await fetch(proxied, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    blob = await res.blob();
  } catch {
    // Proxy unavailable / host not allowlisted — let the browser try the
    // original URL directly. Cross-origin sites usually render rather than
    // download, but that beats failing silently.
    window.open(url, "_blank", "noopener");
    return;
  }
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename || "documento";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

// Typed error so handlers can branch on backend-supplied error codes
// (e.g. WABA_MISSING) without parsing the message string. `code` is
// whatever the backend put in the JSON body's `code` field — undefined
// when the backend didn't supply one.
export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

// Backend errors come back as JSON `{ error: "...", code?: "..." }`.
// We extract the `error` field for display (so the toast doesn't dump
// a stack trace) and the `code` field for callers that need to branch.
// Logged in full to the console for debugging.
async function parseErrorPayload(
  res: Response,
  method: string,
  path: string
): Promise<{ message: string; code?: string }> {
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
    const code = typeof obj.code === "string" ? obj.code : undefined;
    // GHL wraps upstream provider errors ("Twilio Error", "Meta Error", …)
    // without forwarding the underlying error code, so the only thing their
    // support team can correlate against is the traceId. Surface it on the
    // toast so users can paste it into a ticket.
    const traceId = typeof obj.traceId === "string" ? obj.traceId : undefined;
    if (direct) {
      console.error(`[api] ${method} ${path} ${res.status}:`, parsed);
      const message = traceId ? `${direct} (traceId ${traceId})` : direct;
      return { message, code };
    }
  }
  // Couldn't extract a user-facing message — fall back to status + a
  // short generic line. Still log the body for diagnosis.
  console.error(`[api] ${method} ${path} ${res.status}:`, text || "(empty body)");
  if (res.status >= 500) return { message: `Error del servidor (${res.status}).` };
  if (res.status === 404) return { message: "El recurso no existe." };
  if (res.status === 403) return { message: "No tienes permiso para esta acción." };
  if (res.status === 400) return { message: "Solicitud inválida." };
  return { message: `Error ${res.status}.` };
}

// Back-compat helper for the multipart paths below that only want the
// human-readable message.
async function parseErrorMessage(
  res: Response,
  method: string,
  path: string
): Promise<string> {
  return (await parseErrorPayload(res, method, path)).message;
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
    throw new ApiError("Tu sesión ha caducado. Inicia sesión de nuevo.", 401);
  }
  if (!res.ok) {
    const { message, code } = await parseErrorPayload(res, method, path);
    throw new ApiError(message, res.status, code);
  }
  if (res.status === 204) return undefined as T;
  const json = await res.json();
  return (json && "data" in json ? json.data : json) as T;
}

export const api = {
  bootstrap: () => request<BootstrapPayload>("GET", "/bootstrap"),

  // Admin: dynamic management of the multi-tenant location allowlist. All
  // routes are gated server-side by requireAdmin (403 for non-admins).
  admin: {
    listLocations: () =>
      request<{
        enforced: boolean;
        locations: Array<{
          locationId: string;
          name: string | null;
          allowed: boolean;
          source: string | null;
          firstSeenAt: string;
          lastSeenAt: string;
        }>;
      }>("GET", "/admin/locations"),
    addLocation: (locationId: string, name?: string) =>
      request<{ ok: boolean }>("POST", "/admin/locations", { locationId, name }),
    setAllowed: (locationId: string, allowed: boolean) =>
      request<{ ok: boolean }>("PATCH", `/admin/locations/${encodeURIComponent(locationId)}`, {
        allowed,
      }),
    rename: (locationId: string, name: string) =>
      request<{ ok: boolean }>("PATCH", `/admin/locations/${encodeURIComponent(locationId)}`, {
        name,
      }),
    removeLocation: (locationId: string) =>
      request<{ ok: boolean }>("DELETE", `/admin/locations/${encodeURIComponent(locationId)}`),
    setEnforcement: (enforced: boolean) =>
      request<{ enforced: boolean }>("PUT", "/admin/settings/enforcement", { enforced }),
  },

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
        isAdmin: boolean;
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
      // Funnel/stage id. Not a native conversation-search field — the backend
      // resolves the stage's contacts via opportunity search and returns their
      // conversations, so the funnel filter spans the whole location.
      stage?: string;
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
      if (params?.stage) qs.set("stage", params.stage);
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
    // Optional scopes: `assignedTo` narrows to a single agent's leads,
    // `followers` narrows to leads in that agent's followersStore.
    unreadCount: (params?: { assignedTo?: string; followers?: string }) => {
      const qs = new URLSearchParams();
      if (params?.assignedTo) qs.set("assignedTo", params.assignedTo);
      if (params?.followers) qs.set("followers", params.followers);
      const query = qs.toString();
      return request<{ total: number }>(
        "GET",
        `/conversations/unread-count${query ? `?${query}` : ""}`
      );
    },
    // True total of conversations assigned to a user (GHL's reported count,
    // not a capped page) — drives the "Asignados a mí" badge.
    assignedCount: (assignedTo: string) =>
      request<{ count: number }>(
        "GET",
        `/conversations/assigned-count?assignedTo=${encodeURIComponent(assignedTo)}`
      ),
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
        // Reply/quote context ("Responder") — persisted server-side so the
        // quoted bubble survives a refresh (GHL has no native reply field).
        replyTo?: Message["replyTo"];
        clientId?: string;
        // WhatsApp template fields for instant template sends (the
        // "Enviar ahora" path in ScheduleMessageDialog). When set, the
        // backend routes the call through GHL's templated WhatsApp
        // send so the approved bubble is rendered — required past
        // Meta's 24h customer-service window. `text` is sent as a
        // preview/log string only and is ignored by Meta's renderer.
        templateId?: string;
        templateName?: string;
        templateLanguage?: string;
        // The template's baked-in header media — persisted server-side so it
        // re-attaches to GHL's media-less echo of the official template on
        // reload (display-only; doesn't change the send).
        templateMedia?: Message["attachment"];
      }
    ) => request<Message>("POST", `/conversations/${id}/messages`, payload),
    patch: (
      id: string,
      patch: Partial<{
        isFavorite: boolean;
        isArchived: boolean;
        // Sent alongside isArchived so the backend can persist the archive
        // durably keyed by contact (used to re-fetch it for the archive view).
        contactId: string;
        // "Marcar como leído" — clears the unread badge until a newer message.
        markRead: boolean;
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
    // Toggle the Conversation AI bot Active/Paused for this conversation's
    // contact. Fires the GHL bot-status workflow + writes the durable tag
    // mirror on the backend.
    setBotStatus: (id: string, status: "active" | "paused") =>
      request<{ botStatus: "active" | "paused" }>(
        "POST",
        `/conversations/${id}/bot-status`,
        { status }
      ),
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
        // BCP-47 tag forwarded to the backend's dispatcher so a Meta
        // template can be invoked with the right language. Only set
        // for WhatsApp templates from Meta — undefined for GHL
        // snippets.
        templateLanguage?: string;
      }
    ) => request<{ id: string }>("POST", `/conversations/${id}/scheduled`, payload),
    cancelScheduled: (id: string, messageId: string) =>
      request<{ ok: boolean }>("DELETE", `/conversations/${id}/scheduled/${messageId}`),
  },

  // Saved GHL location templates / snippets + Meta WhatsApp templates.
  // Used by the scheduling dialog so the agent can pick a Meta-approved
  // WhatsApp template (mandatory for WhatsApp after 24h of silence).
  //
  // For `type=whatsapp`: the backend reads the WhatsApp Business
  // Account id from LocationConfig and calls the Meta Graph API. When
  // no WABA is registered yet it throws ApiError with
  // code="WABA_MISSING" — callers should open the registration modal
  // and retry after the agent submits a WABA id.
  templates: {
    list: (params?: { type?: "sms" | "whatsapp" | "email" }) => {
      const qs = new URLSearchParams();
      if (params?.type) qs.set("type", params.type);
      const q = qs.toString();
      // For WhatsApp templates the backend attaches the rich Meta
      // payload (status, category, components → buttons, …) under
      // `whatsappDetail`. SMS/email templates omit it.
      return request<{
        templates: MessageTemplate[];
      }>("GET", `/templates${q ? `?${q}` : ""}`);
    },
  },

  // Saved filter views ("Vistas") — per-location, durable. The backend seeds
  // sensible defaults on first read.
  views: {
    list: () => request<SavedView[]>("GET", "/views"),
    upsert: (view: SavedView) =>
      request<SavedView>("PUT", `/views/${encodeURIComponent(view.id)}`, {
        name: view.name,
        filters: view.filters,
        logic: view.logic,
      }),
    remove: (id: string) =>
      request<{ ok: boolean }>("DELETE", `/views/${encodeURIComponent(id)}`),
  },

  // Open Graph link preview for a URL in a message. Returns null when the
  // page has no usable preview metadata.
  linkPreview: (url: string) =>
    request<{
      url: string;
      title?: string;
      description?: string;
      image?: string;
      siteName?: string;
    } | null>("GET", `/link-preview?url=${encodeURIComponent(url)}`),

  // Per-location app config. Today: just the WABA id used to fetch
  // WhatsApp templates from the Meta Graph API.
  locationConfig: {
    get: () =>
      request<{
        locationId: string;
        wabaId: string | null;
        whatsappProviderId?: string | null;
        greenApiInstanceId: string | null;
        greenApiBaseUrl: string | null;
        greenApiConfigured: boolean;
        botStatusWebhookUrl: string | null;
      }>("GET", "/location-config"),
    setWabaId: (wabaId: string | null) =>
      request<{ locationId: string; wabaId: string | null }>(
        "PUT",
        "/location-config/waba",
        { wabaId }
      ),
    // Per-sub-account Green API credentials. Send all three; baseUrl is
    // optional (derived from the instance id when blank). The apiToken is
    // never returned by GET — only `greenApiConfigured`.
    setGreenApi: (creds: {
      instanceId: string;
      apiToken: string;
      baseUrl?: string;
    }) =>
      request<{
        locationId: string;
        greenApiInstanceId: string | null;
        greenApiBaseUrl: string | null;
        greenApiConfigured: boolean;
      }>("PUT", "/location-config/green-api", creds),
    // Per-sub-account Conversation AI bot status workflow webhook.
    setBotStatusWebhookUrl: (url: string | null) =>
      request<{
        locationId: string;
        botStatusWebhookUrl: string | null;
        // Auto-probe result when a non-empty URL was saved.
        probe?: { ok: boolean; status: number; message?: string } | null;
      }>("PUT", "/location-config/bot-webhook", { url }),
    // Send a sample { contactId, status } POST to the bot webhook. Pass a
    // `url` to test before saving; otherwise the saved one is used. Also
    // makes GHL capture the `status` field for the workflow's If/Else.
    probeBotStatusWebhook: (url?: string, status?: "active" | "paused") =>
      request<{ ok: boolean; status: number; bodySnippet: string }>(
        "POST",
        "/location-config/bot-webhook/probe",
        { url, status }
      ),
  },

  // Per-template GHL Workflow Inbound Webhook URLs used to send WhatsApp
  // templates by name (one workflow per template variant). Stored per
  // (locationId, templateName, language).
  whatsappTemplateWebhooks: {
    list: () =>
      request<
        Array<{
          templateName: string;
          templateLanguage: string;
          webhookUrl: string;
          updatedAt?: string;
        }>
      >("GET", "/whatsapp-template-webhooks"),
    // Empty webhookUrl removes the row.
    upsert: (templateName: string, webhookUrl: string, language?: string) => {
      const qs = language ? `?language=${encodeURIComponent(language)}` : "";
      return request<{
        templateName: string;
        templateLanguage: string;
        webhookUrl: string;
        probe?: { ok: boolean; status: number; message?: string };
      }>(
        "PUT",
        `/whatsapp-template-webhooks/${encodeURIComponent(templateName)}${qs}`,
        { webhookUrl }
      );
    },
    remove: (templateName: string, language?: string) => {
      const qs = language ? `?language=${encodeURIComponent(language)}` : "";
      return request<void>(
        "DELETE",
        `/whatsapp-template-webhooks/${encodeURIComponent(templateName)}${qs}`
      );
    },
    probe: (templateName: string, language?: string) => {
      const qs = language ? `?language=${encodeURIComponent(language)}` : "";
      return request<{ ok: boolean; status: number; message?: string }>(
        "POST",
        `/whatsapp-template-webhooks/${encodeURIComponent(templateName)}/probe${qs}`
      );
    },
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
    // Every message-with-attachment for the contact, across the full chat
    // history. The right-rail "Documentos" tabs read from this so older
    // uploads (outside the lazily-loaded message window) still appear.
    attachments: (id: string) =>
      request<Message[]>("GET", `/contacts/${id}/attachments`),
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
        // Street address → GHL `address1`. Empty string clears it.
        address?: string;
        // Identity document → GHL custom field. Empty string clears it.
        documentNumber?: string;
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
    // `enrich` joins each opportunity to its linked conversation's
    // channel / direction / last-message time + the contact's followers so
    // the kanban's conversation-level filters work for every card. Costs a
    // few extra conversation reads server-side, so only the kanban requests it.
    list: (params?: { enrich?: boolean }) =>
      request<Opportunity[]>(
        "GET",
        `/opportunities${params?.enrich ? "?enrich=1" : ""}`
      ),
    pipelines: () => request<Pipeline[]>("GET", "/opportunities/pipelines"),
    // GHL's update-opportunity API requires the pipelineId alongside the
    // new stage id — without it the stage move is silently rejected and the
    // card snaps back on reload. Always pass the opportunity's pipeline.
    move: (id: string, stageId: string, pipelineId?: string) =>
      request<Opportunity>("PATCH", `/opportunities/${id}`, { stageId, pipelineId }),
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
    // Update title / due date (and optionally the body) of an existing
    // GHL task. Backed by the same PATCH endpoint as setCompleted —
    // the route maps any subset of fields it receives.
    update: (
      contactId: string,
      taskId: string,
      patch: { title?: string; dueDate?: string; body?: string }
    ) => request<Task>("PATCH", `/tasks/${contactId}/${taskId}`, patch),
  },
};
