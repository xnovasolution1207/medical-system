// Thin WebSocket subscriber. Reconnects with exponential backoff so a backend
// restart during dev doesn't require a page reload.
import type { Conversation, LeadBundle, Message, Opportunity, Task, User } from "@/components/chat/types";
import { getAuthToken } from "./auth";

export type WsEvent =
  | { type: "hello"; clientId: string }
  | { type: "message.created"; conversationId: string; message: Message }
  | { type: "conversation.updated"; conversation: Conversation }
  | { type: "conversation.read"; conversationId: string; readAt: number }
  | { type: "contact.updated"; contactId: string; patch: Partial<User> }
  | { type: "opportunity.updated"; opportunity: Opportunity }
  | { type: "task.created"; task: Task }
  | { type: "task.updated"; task: Task }
  | { type: "lead.updated"; contactId: string; lead: LeadBundle };

export type WsListener = (event: WsEvent) => void;

export interface Subscription {
  close(): void;
}

export function subscribe(listener: WsListener): Subscription {
  let socket: WebSocket | null = null;
  let closed = false;
  let attempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // In dev, VITE_BACKEND_URL is unset → we connect to the current page origin
  // and the Vite dev server proxies /ws to the backend. In production, it must
  // be set to the backend's absolute URL (http(s)://...); we swap the scheme
  // to ws(s):// and append /ws.
  const baseWsUrl = (() => {
    const backend = (import.meta.env.VITE_BACKEND_URL ?? "").replace(/\/+$/, "");
    if (backend) {
      return `${backend.replace(/^http/i, "ws")}/ws`;
    }
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/ws`;
  })();

  // Appends the current OAuth JWT to the WS URL. Browsers can't add an
  // Authorization header to a WebSocket handshake; the backend's `/ws`
  // server reads `?token=` instead and binds the socket to the user's
  // location so cross-tenant webhook events can't leak into this client.
  // We rebuild the URL on every (re)connect so token rotation across
  // logout/login is picked up automatically.
  function buildAuthedUrl(): string {
    const token = getAuthToken();
    if (!token) return baseWsUrl;
    return `${baseWsUrl}?token=${encodeURIComponent(token)}`;
  }

  function connect() {
    if (closed) return;
    socket = new WebSocket(buildAuthedUrl());
    socket.onopen = () => {
      attempts = 0;
    };
    socket.onmessage = (e) => {
      try {
        const data = JSON.parse(typeof e.data === "string" ? e.data : "") as WsEvent;
        listener(data);
      } catch (err) {
        console.warn("ws: bad payload", err);
      }
    };
    socket.onclose = () => {
      if (closed) return;
      attempts += 1;
      const delay = Math.min(30000, 500 * 2 ** Math.min(attempts, 6));
      reconnectTimer = setTimeout(connect, delay);
    };
    socket.onerror = () => {
      socket?.close();
    };
  }

  connect();

  return {
    close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    },
  };
}
