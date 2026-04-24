// Thin WebSocket subscriber. Reconnects with exponential backoff so a backend
// restart during dev doesn't require a page reload.
import type { Conversation, Message, Opportunity, Task } from "@/components/chat/types";

export type WsEvent =
  | { type: "hello"; clientId: string }
  | { type: "message.created"; conversationId: string; message: Message }
  | { type: "conversation.updated"; conversation: Conversation }
  | { type: "opportunity.updated"; opportunity: Opportunity }
  | { type: "task.created"; task: Task }
  | { type: "task.updated"; task: Task };

export type WsListener = (event: WsEvent) => void;

export interface Subscription {
  close(): void;
  // Tells the backend which conversation this client is currently viewing so
  // the poller can target a fast tail loop at it. Pass null to clear focus.
  // Safe to call any time (queued before the socket is open).
  setFocus(conversationId: string | null): void;
}

export function subscribe(listener: WsListener): Subscription {
  let socket: WebSocket | null = null;
  let closed = false;
  let attempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingFocus: string | null = null;
  let focusSent = false;

  // In dev, VITE_BACKEND_URL is unset → we connect to the current page origin
  // and the Vite dev server proxies /ws to the backend. In production, it must
  // be set to the backend's absolute URL (http(s)://...); we swap the scheme
  // to ws(s):// and append /ws.
  const wsUrl = (() => {
    const backend = (import.meta.env.VITE_BACKEND_URL ?? "").replace(/\/+$/, "");
    if (backend) {
      return `${backend.replace(/^http/i, "ws")}/ws`;
    }
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/ws`;
  })();

  function flushFocus() {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: "focus", conversationId: pendingFocus }));
    focusSent = true;
  }

  function connect() {
    if (closed) return;
    socket = new WebSocket(wsUrl);
    socket.onopen = () => {
      attempts = 0;
      // Re-send focus on every (re)connection so the backend stays in sync.
      focusSent = false;
      if (pendingFocus !== null || focusSent) flushFocus();
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
    setFocus(conversationId) {
      pendingFocus = conversationId;
      flushFocus();
    },
  };
}
