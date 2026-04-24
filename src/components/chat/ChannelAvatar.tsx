import React from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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

const channelIcons: Record<ChannelType, string | React.ReactNode> = {
  whatsapp: "https://upload.wikimedia.org/wikipedia/commons/6/6b/WhatsApp.svg",
  instagram: "https://upload.wikimedia.org/wikipedia/commons/e/e7/Instagram_logo_2016.svg",
  messenger: "https://upload.wikimedia.org/wikipedia/commons/b/be/Facebook_Messenger_logo_2020.svg",
  tiktok: "https://upload.wikimedia.org/wikipedia/commons/3/34/Ionicons_logo-tiktok.svg",
  sms: <MessageSquare className="h-2.5 w-2.5 text-white" />,
  email: <Mail className="h-2.5 w-2.5 text-white" />,
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
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <div className={cn("relative inline-block shrink-0", className)}>
          <Avatar className={cn("h-full w-full border border-border/50 bg-primary/10 transition-shadow duration-300", isActive && "animate-avatar-pop shadow-md ring-2 ring-primary/20 ring-offset-2 ring-offset-background")}>
            <AvatarImage src={avatarUrl} alt={name} className="object-cover" />
            <AvatarFallback className="text-muted-foreground font-medium">
              {initials}
            </AvatarFallback>
          </Avatar>


          {/* Channel badge - Bottom Right */}
          {channel && (
            <div className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-background bg-background shadow-sm overflow-hidden z-10">
              {typeof channelIcons[channel] === "string" ? (
                <img
                  src={channelIcons[channel] as string}
                  alt={channel}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-primary">
                  {channelIcons[channel] as React.ReactNode}
                </div>
              )}
            </div>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="right" className="text-xs font-medium">
        {name}
      </TooltipContent>
    </Tooltip>
  );
}
