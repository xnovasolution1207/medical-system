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

/** Parse a router pathname into the (tab, viewId) pair Index.tsx consumes. */
export function pathToNav(pathname: string): ChattingNav {
  if (!pathname.startsWith(CHATTING_PREFIX)) {
    return { tab: DEFAULT_TAB, viewId: null };
  }
  const rest = pathname.slice(CHATTING_PREFIX.length).replace(/^\/+|\/+$/g, "");
  if (rest === "") return { tab: DEFAULT_TAB, viewId: null };

  const segments = rest.split("/").map(decodeURIComponent);
  const [head, ...tail] = segments;

  if (head === "vistas") {
    const viewId = tail[0] ?? "";
    return viewId
      ? { tab: "", viewId }
      : // Bare /chatting/vistas with no id — degrade to default.
        { tab: DEFAULT_TAB, viewId: null };
  }

  if (head === "tareas") {
    const slot = tail[0];
    if (!slot) return { tab: "tareas-hoy", viewId: null };
    return { tab: `tareas-${slot}`, viewId: null };
  }

  if (TOP_LEVEL_TABS.has(head)) {
    return { tab: head, viewId: null };
  }

  // Unknown segment — fall back to the default so the SPA doesn't get
  // stuck on a tab id no component recognises.
  return { tab: DEFAULT_TAB, viewId: null };
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
