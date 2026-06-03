// Soft "badge" classes per Tailwind color family. The chat-list stage
// badge ("embudo" pill) derives its colour from the stage's own
// `bg-<family>-500` swatch so every funnel stage shows in its real colour
// (Kiwi → lime, Consulta → pink, Web → cyan, …) instead of a flat grey.
// Listed as full literals so Tailwind's JIT keeps every class in the bundle.
const STAGE_BADGE_BY_FAMILY: Record<string, string> = {
  rose: "bg-rose-500/15 text-rose-700 dark:text-rose-400 hover:bg-rose-500/25",
  red: "bg-red-500/15 text-red-700 dark:text-red-400 hover:bg-red-500/25",
  orange: "bg-orange-500/15 text-orange-700 dark:text-orange-400 hover:bg-orange-500/25",
  amber: "bg-amber-500/15 text-amber-700 dark:text-amber-400 hover:bg-amber-500/25",
  yellow: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 hover:bg-yellow-500/25",
  lime: "bg-lime-500/15 text-lime-700 dark:text-lime-400 hover:bg-lime-500/25",
  green: "bg-green-500/15 text-green-700 dark:text-green-400 hover:bg-green-500/25",
  emerald: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/25",
  teal: "bg-teal-500/15 text-teal-700 dark:text-teal-400 hover:bg-teal-500/25",
  cyan: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 hover:bg-cyan-500/25",
  sky: "bg-sky-500/15 text-sky-700 dark:text-sky-400 hover:bg-sky-500/25",
  blue: "bg-blue-500/15 text-blue-700 dark:text-blue-400 hover:bg-blue-500/25",
  indigo: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400 hover:bg-indigo-500/25",
  violet: "bg-violet-500/15 text-violet-700 dark:text-violet-400 hover:bg-violet-500/25",
  purple: "bg-purple-500/15 text-purple-700 dark:text-purple-400 hover:bg-purple-500/25",
  fuchsia: "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-400 hover:bg-fuchsia-500/25",
  pink: "bg-pink-500/15 text-pink-700 dark:text-pink-400 hover:bg-pink-500/25",
  slate: "bg-slate-500/15 text-slate-700 dark:text-slate-400 hover:bg-slate-500/25",
  gray: "bg-gray-500/15 text-gray-700 dark:text-gray-400 hover:bg-gray-500/25",
  zinc: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-400 hover:bg-zinc-500/25",
};

// Resolve a stage's `bg-<family>-<weight>` swatch to its badge classes.
// Falls back to slate (grey) for unknown / missing colours.
export function stageBadgeClasses(color: string | undefined): string {
  const fallback = STAGE_BADGE_BY_FAMILY.slate;
  if (!color) return fallback;
  const family = color.match(/bg-([a-z]+)-/)?.[1];
  return (family && STAGE_BADGE_BY_FAMILY[family]) || fallback;
}
