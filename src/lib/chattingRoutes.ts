// URL <-> sidebar-state mapping for the /chatting/* route tree.
//
// The sidebar drives two coupled state slots that used to live in
// Index.tsx as plain useState calls:
//   - activeMainTab   ("todos" | "asignados" | "seguidos" | "recordatorios"
//                      | "oportunidades" | "tareas-<slot>" | "")
//   - activeViewId    string | null  (a SavedView id)
//
// Selecting a saved view sets activeMainTab="" and activeViewId=<id>;
// selecting any other sidebar entry sets activeMainTab=<id> and
// activeViewId=null. The two are mutually exclusive in the UI.
//
// We map that onto the route tree the user asked for:
//   /chatting/todos
//   /chatting/asignados
//   /chatting/seguidos
//   /chatting/recordatorios
//   /chatting/oportunidades
//   /chatting/tareas/<slot>
//   /chatting/vistas/<viewId>
//
// "Fecha personalizada" carries a date label (e.g. "tareas-15 May") that
// the calendar callback stuffs straight into activeMainTab; we URL-encode
// the post-"tareas-" suffix into the /tareas/<slot> segment, so a custom
// range survives a refresh / share without invalidating the route.

export const CHATTING_PREFIX = "/chatting";
export const DEFAULT_TAB = "todos";
export const DEFAULT_PATH = `${CHATTING_PREFIX}/${DEFAULT_TAB}`;

export interface ChattingNav {
  /** Sidebar tab id ("todos", "asignados", "tareas-hoy", …) or "" when a saved view is active. */
  tab: string;
  /** Saved-view id when the URL points at /chatting/vistas/:id, else null. */
  viewId: string | null;
  /**
   * Active conversation id, deep-linked as the trailing path segment:
   *   /chatting/<tab>/<conversationId>
   *   /chatting/vistas/<viewId>/<conversationId>
   * null when no conversation is open in the URL. Task slots (/tareas/...) and
   * the kanban (/oportunidades) don't carry a conversation.
   */
  conversationId: string | null;
}

// Tabs whose pages render the conversation list (and therefore can deep-link an
// open conversation). The kanban and task slots are excluded.
export function isConversationView(tab: string, viewId: string | null): boolean {
  if (viewId) return true;
  if (!tab || tab === "oportunidades") return false;
  if (tab.startsWith("tareas-")) return false;
  return true;
}

// Top-level tabs that map 1:1 to /chatting/<tab>.
const TOP_LEVEL_TABS = new Set([
  "todos",
  "asignados",
  "seguidos",
  "recordatorios",
  "oportunidades",
  "archivados",
]);

/** Parse a router pathname into the (tab, viewId, conversationId) Index consumes. */
export function pathToNav(pathname: string): ChattingNav {
  if (!pathname.startsWith(CHATTING_PREFIX)) {
    return { tab: DEFAULT_TAB, viewId: null, conversationId: null };
  }
  const rest = pathname.slice(CHATTING_PREFIX.length).replace(/^\/+|\/+$/g, "");
  if (rest === "") return { tab: DEFAULT_TAB, viewId: null, conversationId: null };

  const segments = rest.split("/").map(decodeURIComponent);
  const [head, ...tail] = segments;

  if (head === "vistas") {
    const viewId = tail[0] ?? "";
    // /chatting/vistas/<viewId>/<conversationId>
    const conversationId = tail[1] || null;
    return viewId
      ? { tab: "", viewId, conversationId }
      : // Bare /chatting/vistas with no id — degrade to default.
        { tab: DEFAULT_TAB, viewId: null, conversationId: null };
  }

  if (head === "tareas") {
    const slot = tail[0];
    // /chatting/tareas/<slot>/<conversationId> — clicking a task opens its
    // conversation without leaving the task page.
    const conversationId = tail[1] || null;
    if (!slot) return { tab: "tareas-hoy", viewId: null, conversationId: null };
    return { tab: `tareas-${slot}`, viewId: null, conversationId };
  }

  if (TOP_LEVEL_TABS.has(head)) {
    // /chatting/<tab>/<conversationId>
    const conversationId = tail[0] || null;
    return { tab: head, viewId: null, conversationId };
  }

  // Unknown segment — fall back to the default so the SPA doesn't get
  // stuck on a tab id no component recognises.
  return { tab: DEFAULT_TAB, viewId: null, conversationId: null };
}

/** Build a /chatting/* path that round-trips to the given tab. */
export function tabToPath(tab: string): string {
  if (!tab) return DEFAULT_PATH;
  if (TOP_LEVEL_TABS.has(tab)) return `${CHATTING_PREFIX}/${tab}`;
  if (tab.startsWith("tareas-")) {
    const slot = tab.slice("tareas-".length);
    return slot
      ? `${CHATTING_PREFIX}/tareas/${encodeURIComponent(slot)}`
      : `${CHATTING_PREFIX}/tareas/hoy`;
  }
  return DEFAULT_PATH;
}

/** Build the canonical path for a saved view. */
export function viewIdToPath(viewId: string): string {
  return `${CHATTING_PREFIX}/vistas/${encodeURIComponent(viewId)}`;
}

/**
 * Build the path that opens `conversationId` within the current tab / saved
 * view, so each conversation has its own deep-linkable URL. Task/kanban views
 * don't host conversations, so a conversation there falls back to the default
 * conversation tab.
 */
export function conversationToPath(
  tab: string,
  viewId: string | null,
  conversationId: string
): string {
  const enc = encodeURIComponent(conversationId);
  if (viewId) return `${viewIdToPath(viewId)}/${enc}`;
  // Task slots host conversations too (clicking a task opens its chat) — keep
  // the user on the task page instead of bouncing them to /todos.
  if (tab.startsWith("tareas-")) {
    const slot = tab.slice("tareas-".length) || "hoy";
    return `${CHATTING_PREFIX}/tareas/${encodeURIComponent(slot)}/${enc}`;
  }
  if (TOP_LEVEL_TABS.has(tab) && tab !== "oportunidades") {
    return `${CHATTING_PREFIX}/${tab}/${enc}`;
  }
  return `${CHATTING_PREFIX}/${DEFAULT_TAB}/${enc}`;
}
