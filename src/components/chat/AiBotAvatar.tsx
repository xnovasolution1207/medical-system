import { forwardRef, useState } from "react";
import { cn } from "@/lib/utils";

// Custom AI-bot avatar image (medical robot mascot). Lives in /public, so it's
// served at the site root. Swap this constant to change the bot's avatar.
const AI_BOT_IMAGE_SRC = "/bot_image_1.jpg";

// Avatar for GHL's Conversation AI bot. Renders the custom mascot image,
// cropped to a circle with a soft glow so the bot reads as "special" against
// the thread. If the image ever fails to load, it falls back to a
// self-contained SVG (a violet→indigo→cyan gradient orb with a visor face) so
// the avatar never renders broken. Rendered wherever an `aiBot` message /
// conversation needs to be visually distinguished from a human agent.
//
// forwardRef + prop spread so it can be used directly as a Radix
// `<TooltipTrigger asChild>` child (Slot passes a ref + handlers down).
export const AiBotAvatar = forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement>
>(function AiBotAvatar({ className, ...props }, ref) {
  const [imgFailed, setImgFailed] = useState(false);
  return (
    <span
      ref={ref}
      {...props}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full",
        className
      )}
      aria-label="Asistente IA"
    >
      {!imgFailed ? (
        <img
          src={AI_BOT_IMAGE_SRC}
          alt="Asistente IA"
          // Nudge the scale up a touch so the robot fills the circle and the
          // empty blue margins of the source art don't dominate the crop.
          className="h-full w-full scale-110 object-cover"
          loading="lazy"
          draggable={false}
          onError={() => setImgFailed(true)}
        />
      ) : (
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
      )}
    </span>
  );
});
