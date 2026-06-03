// All user-facing dates/times render in Peru local time (America/Lima,
// UTC-5). This is a Peru-only product, so display never depends on the
// viewer's machine timezone.
export const PERU_TZ = "America/Lima";

// "01:06 PM"
export function formatPeruTime(d: Date): string {
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: PERU_TZ,
  });
}

// "30/05/2026, 01:06 PM"
export function formatPeruDateTime(d: Date): string {
  return d.toLocaleString("es-PE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: PERU_TZ,
  });
}

// Peru-local calendar day as "YYYY-MM-DD" for same-day / yesterday math.
export function peruYmd(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: PERU_TZ });
}
