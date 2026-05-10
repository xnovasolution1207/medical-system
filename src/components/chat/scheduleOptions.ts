// Relative time presets used by the scheduling popover and template
// dialog. Each option resolves to a real ISO timestamp at submit time
// (so the backend always receives an absolute date).
//
// "Personalizado" is a sentinel — when chosen the UI surfaces a
// datetime-local picker so the agent can enter any future time.

export type ScheduleOptionId =
  | "hoy_5pm"
  | "manana_9am"
  | "lunes_9am"
  | "en_1h"
  | "en_3h"
  | "custom";

export interface ScheduleOption {
  id: ScheduleOptionId;
  label: string;
}

export const SCHEDULE_OPTIONS: ScheduleOption[] = [
  { id: "hoy_5pm", label: "Hoy a las 5:00 PM" },
  { id: "manana_9am", label: "Mañana a las 9:00 AM" },
  { id: "lunes_9am", label: "Lunes a las 9:00 AM" },
  { id: "en_1h", label: "En 1 hora" },
  { id: "en_3h", label: "En 3 horas" },
  { id: "custom", label: "Personalizado..." },
];

// Resolve a preset id into an absolute Date. For "Hoy a las 5:00 PM"
// when it's already past 5 PM today, we roll forward to the next day so
// the agent never accidentally schedules a message into the past.
//
// Returns null for the `custom` sentinel — the caller should pull the
// value from its own datetime-local input instead.
export function resolveScheduleOption(id: ScheduleOptionId): Date | null {
  const now = new Date();
  switch (id) {
    case "hoy_5pm": {
      const d = new Date(now);
      d.setHours(17, 0, 0, 0);
      if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
      return d;
    }
    case "manana_9am": {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d;
    }
    case "lunes_9am": {
      // 1 = Monday; getDay() → 0 (Sun) … 6 (Sat). When today is Monday
      // and it's already past 9 AM we still mean *next* Monday — the
      // user obviously wouldn't say "schedule for Monday at 9 AM" if
      // they meant the past hour.
      const d = new Date(now);
      d.setHours(9, 0, 0, 0);
      let daysUntilMon = (1 - d.getDay() + 7) % 7;
      if (daysUntilMon === 0 && d.getTime() <= now.getTime()) daysUntilMon = 7;
      d.setDate(d.getDate() + daysUntilMon);
      return d;
    }
    case "en_1h":
      return new Date(now.getTime() + 60 * 60 * 1000);
    case "en_3h":
      return new Date(now.getTime() + 3 * 60 * 60 * 1000);
    case "custom":
      return null;
  }
}

// Default value for an `<input type="datetime-local">` — one hour from
// now, rounded down to the minute. Pulled out so the popover's custom
// picker and the template dialog's custom picker stay in sync.
export function defaultLocalDatetime(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

// Friendly Spanish label for any past or future Date — used by the
// banner above the chat ("Mañana a las 9:00 AM").
export function formatScheduleLabel(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow =
    d.getFullYear() === tomorrow.getFullYear() &&
    d.getMonth() === tomorrow.getMonth() &&
    d.getDate() === tomorrow.getDate();
  const time = d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `Hoy a las ${time}`;
  if (isTomorrow) return `Mañana a las ${time}`;
  return d.toLocaleString("es-ES", {
    weekday: "long",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
