import React from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { MessageSquare, Mail } from "lucide-react";

export type ChannelType = "whatsapp" | "instagram" | "messenger" | "tiktok" | "sms" | "email";

interface ChannelAvatarProps {
  name: string;
  src?: string;
  channel?: ChannelType;
  status?: "online" | "offline" | "busy" | "away";
  className?: string;
  isActive?: boolean;
}

// Inline brand badges. Each is a coloured disc with a centred white
// glyph — the badge sits inside a white-bordered ring on the avatar so the
// brand colour reads clearly at the small (~5x5) size used in headers.
// We render the glyphs as inline SVG instead of <img src=wikipedia> because
// hotlinks to upload.wikimedia.org are routinely blocked / rate-limited and
// would leave the badge empty.
const channelGlyphs: Record<ChannelType, { bg: string; node: React.ReactNode }> = {
  whatsapp: {
    bg: "bg-[#25D366]",
    node: (
      <svg viewBox="0 0 32 32" className="h-3 w-3 fill-white" aria-hidden>
        <path d="M16 3C8.82 3 3 8.82 3 16c0 2.31.61 4.47 1.66 6.34L3 29l6.83-1.62A12.93 12.93 0 0 0 16 29c7.18 0 13-5.82 13-13S23.18 3 16 3zm0 23.6c-1.97 0-3.83-.55-5.41-1.5l-.39-.23-4.05.96.97-3.95-.25-.41A10.6 10.6 0 0 1 5.4 16C5.4 10.15 10.15 5.4 16 5.4S26.6 10.15 26.6 16 21.85 26.6 16 26.6zm5.83-7.96c-.32-.16-1.88-.93-2.17-1.04-.29-.11-.5-.16-.71.16-.21.32-.81 1.04-1 1.25-.18.21-.37.24-.69.08-.32-.16-1.34-.49-2.55-1.57-.94-.84-1.57-1.87-1.76-2.19-.18-.32-.02-.5.14-.66.14-.14.32-.37.48-.55.16-.18.21-.32.32-.53.11-.21.05-.4-.03-.55-.08-.16-.71-1.71-.97-2.34-.26-.62-.52-.53-.71-.54l-.61-.01c-.21 0-.55.08-.84.4-.29.32-1.1 1.07-1.1 2.62 0 1.55 1.13 3.04 1.29 3.25.16.21 2.22 3.39 5.39 4.75.75.32 1.34.51 1.8.66.76.24 1.45.21 2 .13.61-.09 1.88-.77 2.14-1.51.27-.74.27-1.38.18-1.51-.08-.13-.29-.21-.61-.37z" />
      </svg>
    ),
  },
  instagram: {
    bg: "bg-gradient-to-tr from-[#feda75] via-[#d62976] to-[#4f5bd5]",
    node: (
      <svg viewBox="0 0 32 32" className="h-3 w-3 fill-white" aria-hidden>
        <path d="M16 7.2c2.87 0 3.21.01 4.34.06 1.05.05 1.62.22 2 .37.5.2.86.43 1.24.81.38.38.62.74.81 1.24.15.38.32.95.37 2 .05 1.13.06 1.47.06 4.34s-.01 3.21-.06 4.34c-.05 1.05-.22 1.62-.37 2-.2.5-.43.86-.81 1.24-.38.38-.74.62-1.24.81-.38.15-.95.32-2 .37-1.13.05-1.47.06-4.34.06s-3.21-.01-4.34-.06c-1.05-.05-1.62-.22-2-.37-.5-.2-.86-.43-1.24-.81-.38-.38-.62-.74-.81-1.24-.15-.38-.32-.95-.37-2-.05-1.13-.06-1.47-.06-4.34s.01-3.21.06-4.34c.05-1.05.22-1.62.37-2 .2-.5.43-.86.81-1.24.38-.38.74-.62 1.24-.81.38-.15.95-.32 2-.37C12.79 7.21 13.13 7.2 16 7.2zm0-1.94c-2.92 0-3.29.01-4.43.06-1.14.05-1.92.23-2.6.5a5.25 5.25 0 0 0-1.9 1.24A5.25 5.25 0 0 0 5.83 9c-.27.68-.45 1.46-.5 2.6-.05 1.14-.06 1.5-.06 4.43s.01 3.29.06 4.43c.05 1.14.23 1.92.5 2.6.27.7.64 1.3 1.24 1.9.6.6 1.2.97 1.9 1.24.68.27 1.46.45 2.6.5 1.14.05 1.5.06 4.43.06s3.29-.01 4.43-.06c1.14-.05 1.92-.23 2.6-.5a5.25 5.25 0 0 0 1.9-1.24c.6-.6.97-1.2 1.24-1.9.27-.68.45-1.46.5-2.6.05-1.14.06-1.5.06-4.43s-.01-3.29-.06-4.43c-.05-1.14-.23-1.92-.5-2.6a5.25 5.25 0 0 0-1.24-1.9 5.25 5.25 0 0 0-1.9-1.24c-.68-.27-1.46-.45-2.6-.5C19.29 5.27 18.92 5.26 16 5.26zM16 10.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zm0 9.07a3.57 3.57 0 1 1 0-7.14 3.57 3.57 0 0 1 0 7.14zm5.72-9.32a1.29 1.29 0 1 0 0-2.58 1.29 1.29 0 0 0 0 2.58z" />
      </svg>
    ),
  },
  messenger: {
    bg: "bg-gradient-to-br from-[#00B2FF] to-[#006AFF]",
    node: (
      <svg viewBox="0 0 32 32" className="h-3 w-3 fill-white" aria-hidden>
        <path d="M16 4C9.37 4 4 9.04 4 15.27c0 3.55 1.74 6.71 4.46 8.78V29l4.07-2.24c1.09.3 2.25.46 3.47.46 6.63 0 12-5.04 12-11.27S22.63 4 16 4zm1.19 14.79l-3.05-3.26-5.96 3.26 6.55-6.95 3.13 3.26 5.88-3.26-6.55 6.95z" />
      </svg>
    ),
  },
  tiktok: {
    bg: "bg-black",
    node: (
      <svg viewBox="0 0 32 32" className="h-3 w-3 fill-white" aria-hidden>
        <path d="M22 4h-3.5v13.5a3.5 3.5 0 1 1-3.5-3.5v-3.6a7.1 7.1 0 1 0 7.1 7.1V11.5c1.46.95 3.2 1.5 5 1.5V9.5c-2.93 0-5-2.07-5-5z" />
      </svg>
    ),
  },
  sms: {
    bg: "bg-emerald-500",
    node: <MessageSquare className="h-2.5 w-2.5 text-white" aria-hidden />,
  },
  email: {
    bg: "bg-sky-500",
    node: <Mail className="h-2.5 w-2.5 text-white" aria-hidden />,
  },
};

const getInitials = (name: string) => {
  const parts = name.split(" ").filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const guessGender = (name: string) => {
  const cleanName = name.trim().split(" ")[0].toLowerCase();
  
  const femaleNames = new Set([
    "carmen", "ines", "inés", "isabel", "luz", "paz", "rosario", "socorro", 
    "sol", "guadalupe", "beatriz", "raquel", "marisol", "abigail", "ruth",
    "rut", "ester", "noemi", "noemí", "miriam", "judith", "ivonne", "michelle",
    "belen", "belén", "chloe", "shirley", "evelyn", "karen", "lizeth", "mabel", 
    "dulce", "flor", "abril", "mar", "pilar", "nieves", "angeles", "mercedes",
    "dolores", "rocio", "rocío", "milagros", "remedios", "cruz", "trinidad",
    "arely", "nayeli", "itzel", "xochitl", "sarahi", "sarahí", "anahí", "anahi",
    "soledad", "consuelo", "asuncion", "purificacion", "sagrario", "estrella"
  ]);
  
  const maleNames = new Set([
    "jose", "josé", "andres", "andrés", "carlos", "luis", "juan", "miguel", 
    "angel", "ángel", "rafael", "gabriel", "daniel", "manuel", "david", 
    "alejandro", "mario", "jorge", "pedro", "pablo", "raul", "raúl", "diego", 
    "eduardo", "fernando", "roberto", "ricardo", "hugo", "oscar", "óscar", 
    "martin", "martín", "jesus", "jesús", "victor", "víctor", "hector", "héctor", 
    "emilio", "julio", "cesar", "césar", "arturo", "sergio", "ivan", "iván", 
    "guillermo", "ramon", "ramón", "enrique", "omar", "francisco", "antonio", 
    "ruben", "rubén", "alfonso", "javier", "alberto", "gerardo", "mauricio", 
    "armando", "edgar", "ulises", "rene", "rené", "israel", "gilberto", "salvador", 
    "ignacio", "felipe", "joaquin", "joaquín", "alonso", "tomas", "tomás", 
    "ernesto", "agustin", "agustín", "lucas", "mateo", "santiago", "leonardo", 
    "matias", "matías", "emiliano", "maximiliano", "sebastian", "sebastián", 
    "nicolas", "nicolás", "samuel", "benjamin", "benjamín", "elias", "elías",
    "alex", "axel", "ian", "iker", "thiago", "santino", "enzo", "bautista"
  ]);
  
  if (maleNames.has(cleanName)) return "boy";
  if (femaleNames.has(cleanName)) return "girl";
  
  if (cleanName.endsWith("a") || cleanName.endsWith("y") || cleanName.endsWith("ie") || cleanName.endsWith("th") || cleanName.endsWith("eth") || cleanName.endsWith("z")) {
    return "girl";
  }
  return "boy";
};

const getAvatarUrl = (name: string, gender: string) => {
  const seed = encodeURIComponent(name.trim());
  // Using 'notionists' which is a very clean, minimalist line-art style
  // It looks great and neutral for any name, but we add subtle variations based on gender
  if (gender === "girl") {
    return `https://api.dicebear.com/7.x/notionists/svg?seed=${seed}&lips=variant02,variant03&backgroundColor=transparent`;
  } else {
    return `https://api.dicebear.com/7.x/notionists/svg?seed=${seed}&beard=variant01,variant02,variant03,variant04,variant05&beardProbability=30&backgroundColor=transparent`;
  }
};

export function ChannelAvatar({ name, src, channel, status, className, isActive }: ChannelAvatarProps) {
  const initials = getInitials(name);
  const gender = guessGender(name);
  const avatarUrl = src || getAvatarUrl(name, gender);

  return (
    <div className={cn("relative inline-block shrink-0", className)}>
      <Avatar className={cn("h-full w-full border border-border/50 bg-primary/10 transition-shadow duration-300", isActive && "animate-avatar-pop shadow-md ring-2 ring-primary/20 ring-offset-2 ring-offset-background")}>
        <AvatarImage src={avatarUrl} alt={name} className="object-cover" />
        <AvatarFallback className="text-muted-foreground font-medium">
          {initials}
        </AvatarFallback>
      </Avatar>

      {/* Channel badge - bottom right. White ring keeps the brand colour
          legible against any avatar / background. */}
      {channel && (
        <div
          className={cn(
            "absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-background shadow-sm z-10",
            channelGlyphs[channel].bg
          )}
          aria-label={channel}
        >
          {channelGlyphs[channel].node}
        </div>
      )}
    </div>
  );
}
