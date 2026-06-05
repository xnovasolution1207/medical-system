import { forwardRef } from "react";
import { cn } from "@/lib/utils";

// Avatar for GHL's Conversation AI bot. A self-contained SVG so it stays
// crisp at any size: a violet→indigo→cyan gradient orb (the robot's head)
// with a glossy highlight, an antenna, a dark "visor" screen and two glowing
// cyan eyes plus a small smile. Rendered wherever an `aiBot` message /
// conversation needs to be visually distinguished from a human agent.
//
// forwardRef + prop spread so it can be used directly as a Radix
// `<TooltipTrigger asChild>` child (Slot passes a ref + handlers down).
export const AiBotAvatar = forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement>
>(function AiBotAvatar({ className, ...props }, ref) {
  return (
    <span
      ref={ref}
      {...props}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full",
        // Soft outer glow so the bot reads as "special" against the thread.
        "shadow-[0_0_0_1px_rgba(255,255,255,0.25),0_2px_8px_rgba(124,58,237,0.45)]",
        className
      )}
      aria-label="Asistente IA"
    >
      <svg viewBox="0 0 40 40" className="h-full w-full" role="img">
        <defs>
          <linearGradient id="aiBotGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#a78bfa" />
            <stop offset="45%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#22d3ee" />
          </linearGradient>
          <radialGradient id="aiBotGloss" cx="30%" cy="24%" r="72%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.6)" />
            <stop offset="42%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
        </defs>
        {/* Gradient orb (head) + glossy highlight for depth */}
        <circle cx="20" cy="20" r="20" fill="url(#aiBotGrad)" />
        <circle cx="20" cy="20" r="20" fill="url(#aiBotGloss)" />
        {/* Antenna: stalk + glowing tip */}
        <line x1="20" y1="5.5" x2="20" y2="10" stroke="white" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="20" cy="5" r="1.9" fill="#a5f3fc" />
        {/* Dark visor / face screen */}
        <rect x="9" y="10.5" width="22" height="19" rx="6.5" fill="rgba(15,23,42,0.92)" />
        <rect
          x="9" y="10.5" width="22" height="19" rx="6.5"
          fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="0.8"
        />
        {/* Two glowing cyan eyes */}
        <rect x="13" y="16" width="4.6" height="5.4" rx="2.3" fill="#67e8f9" />
        <rect x="22.4" y="16" width="4.6" height="5.4" rx="2.3" fill="#67e8f9" />
        {/* Friendly smile */}
        <path
          d="M16 24.4c1.2 1.3 6.8 1.3 8 0"
          fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="1.4" strokeLinecap="round"
        />
        {/* Side bolts / ears */}
        <rect x="6.4" y="17.5" width="2.4" height="5" rx="1.2" fill="rgba(255,255,255,0.85)" />
        <rect x="31.2" y="17.5" width="2.4" height="5" rx="1.2" fill="rgba(255,255,255,0.85)" />
      </svg>
    </span>
  );
});
