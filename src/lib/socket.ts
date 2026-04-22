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
}

export function subscribe(listener: WsListener): Subscription {
  let socket: WebSocket | null = null;
  let closed = false;
  let attempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const wsUrl = (() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/ws`;
  })();

  function connect() {
    if (closed) return;
    socket = new WebSocket(wsUrl);
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
