import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChannelAvatar } from "./ChannelAvatar";
import { AiBotAvatar } from "./AiBotAvatar";
import { ImageLightbox } from "./ImageLightbox";
import { VideoLightbox } from "./VideoLightbox";
import { AudioPlayer } from "./AudioPlayer";
import { LinkPreview } from "./LinkPreview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuCheckboxItem } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScheduleMessageDialog } from "./ScheduleMessageDialog";
import {
  SCHEDULE_OPTIONS,
  defaultLocalDatetime,
  formatScheduleLabel,
  resolveScheduleOption,
  type ScheduleOptionId,
} from "./scheduleOptions";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Label } from "@/components/ui/label";
import { Phone, Video, Info, Paperclip, Smile, Send, X, FileIcon, FileText, Tags, Tag, DollarSign, Image as ImageIcon, Bold, Italic, Underline, Link as LinkIcon, List, Clock, MessageCircle, Star, Sparkles, Mail, Trash2, Loader2, ChevronDown, Bell, User as UserIcon, CheckSquare, CheckCircle2, Circle, BookmarkPlus, Edit2, Check, PanelRight, Search, CornerUpLeft, ArrowRight, Play, Pause, Reply, AlertCircle, MoreHorizontal, Menu, Inbox, Mic, Zap, Contact, Waypoints, Delete, Download, Pin, PinOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Conversation, Message, MessageButton, User, Task, AgentUser } from "./types";
import { cn } from "@/lib/utils";
import { TAB_LIST_CLASS, TAB_TRIGGER_CLASS } from "@/lib/tabStyles";
import { proxyMediaUrl, api } from "@/lib/api";
import { peruYmd, formatPeruDateTime } from "@/lib/datetime";
import {
  useTemplates,
  compileTemplateMatchers,
  matchTemplateByBody,
  buttonsFromTemplate,
  templateButtonsFor,
} from "@/lib/templatesQuery";

interface ChatMessageAreaProps {
  conversation: Conversation;
  currentUser: User;
  // Staff roster used by the internal-note "@" mention picker. Empty when
  // the GHL token lacks `users.readonly` — in that case the picker simply
  // doesn't open and mentions fall back to the legacy word-only regex.
  users?: AgentUser[];
  tasks: Task[];
  onAddTask: (task: Omit<Task, "id">) => void;
  // Patch an existing task. Only the fields the editor exposes
  // (title / dueDate) are supported today.
  onUpdateTask?: (id: string, patch: { title?: string; dueDate?: string }) => void;
  onToggleTask: (id: string) => void;
  onSendMessage: (text: string, attachment?: Message["attachment"], channel?: Message["channel"], mentions?: string[], reminder?: string, replyTo?: Message["replyTo"]) => void;
  onScheduleMessage?: (
    conversationId: string,
    text: string,
    date: string,
    channel?: Message["channel"],
    template?: { id: string; name?: string; language?: string }
  ) => void;
  // "Enviar ahora" path from the WhatsApp template dialog. Same shape
  // as onScheduleMessage minus the date — the parent fires the
  // template through the regular send pipeline immediately.
  onSendTemplateNow?: (
    conversationId: string,
    text: string,
    channel: NonNullable<Message["channel"]>,
    template: {
      id: string;
      name?: string;
      language?: string;
      buttons?: MessageButton[];
      // Replacement media: when set, send the file + text (free-form, Green
      // API) instead of the official Meta template.
      attachment?: Message["attachment"];
      // The template's own baked-in header media — display-only, rendered on
      // the sent bubble when the official template is sent (no custom file).
      templateMedia?: Message["attachment"];
    }
  ) => Promise<void> | void;
  onCancelScheduledMessage?: (conversationId: string, messageId: string) => void;
  onUpdateStage?: (id: string, stage: Conversation["stage"]) => void;
  onClearReminder?: (id: string) => void;
  onSetReminder?: (id: string, reminder: string) => void;
  onToggleFavorite?: (id: string) => void;
  onMarkAsRead?: (id: string) => void;
  onMarkAsUnread?: (id: string) => void;
  // Forward an audio attachment to another conversation (opens a picker in
  // Index, which has the conversation list + cross-conversation send).
  onForwardAudio?: (audioUrl: string) => void;
  onSetBotStatus?: (id: string, status: "active" | "paused") => void;
  // True while the conversation's full history is being fetched on select —
  // shows a loading spinner in the message area.
  isLoadingHistory?: boolean;
  stages: { id: string; label: string; color: string; }[];
  setStages: (stages: { id: string; label: string; color: string; }[]) => void;
  isContactSidebarOpen?: boolean;
  onToggleContactSidebar?: () => void;
  hasOlderMessages?: boolean;
  isLoadingOlderMessages?: boolean;
  onLoadOlderMessages?: () => void;
  onDeleteLead?: () => void;
  // Pin a message snapshot to the conversation's pinned-message stack
  // (or, with `null`, clear all pins). Each pin renders as its own
  // banner above the message list.
  onPinMessage?: (
    conversationId: string,
    pinned: { id: string; text: string; date?: string; senderName?: string; channel?: string } | null
  ) => void;
  // Remove a single pinned snapshot by its message id (per-banner X
  // button and the per-message "Desfijar" menu item).
  onUnpinMessage?: (conversationId: string, messageId: string) => void;
  // Opens the MainSidebar drawer on screens below `md`. Index.tsx provides it
  // so the user can reach navigation while a conversation is open on mobile.
  onOpenMobileNav?: () => void;
  // Opens the lead-list drawer on screens below `md`. Lets the agent pick a
  // different conversation without leaving the active chat.
  onOpenChatList?: () => void;
}

// Video message thumbnail. Attempts to show the first frame via
// preload="metadata"; falls back to a static slate card with the filename
// when the browser can't extract a poster (unsupported codec, CORS, etc.).
// Clicking always opens VideoLightbox with native controls + autoPlay.
function VideoThumbnail({ src, name }: { src: string; name: string }) {
  const [posterFailed, setPosterFailed] = React.useState(false);
  // Route through the backend proxy to bypass CDN CORS restrictions and
  // Bearer-auth requirements that block <video> / range requests in the browser.
  const proxied = proxyMediaUrl(src);
  return (
    <VideoLightbox src={proxied} alt={name} className="block w-full">
      <div className="relative w-full">
        {posterFailed ? (
          <div className="flex min-h-[130px] w-full flex-col items-center justify-center gap-2 rounded-lg bg-slate-800 px-6 py-5">
            <Video className="h-8 w-8 text-slate-400" />
            <span className="max-w-[180px] truncate text-xs text-slate-400">{name}</span>
          </div>
        ) : (
          <video
            src={proxied}
            preload="metadata"
            muted
            playsInline
            onError={() => setPosterFailed(true)}
            className="w-full max-h-[300px] rounded-lg object-cover bg-black transition-transform group-hover:scale-[1.02]"
          />
        )}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-black/25 opacity-90 transition-opacity group-hover:opacity-100">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/90 shadow-lg">
            <Play className="h-6 w-6 translate-x-0.5 text-slate-900" fill="currentColor" />
          </div>
        </div>
      </div>
    </VideoLightbox>
  );
}

// Display labels for the channel composer tabs. `internal` is "Comentarios
// Interno" rather than a channel because it's the agent-private notes tab,
// not an outbound channel.
const CHANNEL_LABELS: Record<NonNullable<Message["channel"]>, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  messenger: "Messenger",
  tiktok: "TikTok",
  sms: "SMS",
  email: "Email",
  internal: "Comentarios Interno",
};

// Stable left-to-right order for the channel tabs. Channels not in this list
// won't render — every channel the lead actually uses must be included here.
const CHANNEL_ORDER: Array<NonNullable<Message["channel"]>> = [
  "whatsapp",
  "instagram",
  "messenger",
  "tiktok",
  "sms",
  "email",
  "internal",
];

// Predicates for the message-history filter dropdown ("Todo / Conversaciones /
// Actividades / SMS / WhatsApp / …"). A message is shown when at least one
// of the active filter labels has a predicate that returns true. Labels that
// don't appear here intentionally match nothing — they're GHL-domain types
// (Pagos, Factura, Citas, AI logs) that aren't surfaced in the chat stream
// today, so selecting them filters everything out, which is the truthful UX.
const MESSAGE_FILTER_PREDICATES: Record<string, (m: Message) => boolean> = {
  Conversaciones: (m) => !m.systemEvent,
  Actividades: (m) => Boolean(m.systemEvent),
  SMS: (m) => m.channel === "sms",
  WhatsApp: (m) => m.channel === "whatsapp",
  "Comentario interno": (m) => m.channel === "internal" && !m.systemEvent,
  Oportunidades: (m) => m.systemEvent?.type === "opportunity_moved",
};

function messageMatchesFilters(message: Message, filters: string[]): boolean {
  // Empty selection or "Todo" → no filtering.
  if (filters.length === 0 || filters.includes("Todo")) return true;
  return filters.some((label) => MESSAGE_FILTER_PREDICATES[label]?.(message) ?? false);
}

// Attachment types the bubble actually knows how to render. Anything outside
// this set falls through to `null` in the render switch — without a fallback
// the bubble shows up empty.
// Task description templates persist in localStorage (browser-local). No GHL
// equivalent exists for these, so this is the durable store; survives reloads
// and the per-conversation remount of this component.
const TASK_PRESETS_KEY = "medchat:taskPresets";
const DEFAULT_TASK_PRESETS = [
  "Llamar para seguimiento",
  "Enviar cotización",
  "Agendar reunión",
];
function loadTaskPresets(): string[] {
  try {
    const raw = localStorage.getItem(TASK_PRESETS_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr.filter((x): x is string => typeof x === "string");
    }
  } catch {
    // ignore parse / storage errors → fall back to defaults
  }
  return DEFAULT_TASK_PRESETS;
}
function saveTaskPresets(presets: string[]): void {
  try {
    localStorage.setItem(TASK_PRESETS_KEY, JSON.stringify(presets));
  } catch {
    // storage unavailable (private mode / quota) — non-fatal
  }
}

const RENDERABLE_ATTACHMENT_TYPES: ReadonlySet<NonNullable<Message["attachment"]>["type"]> = new Set([
  "image",
  "video",
  "audio",
  "file",
  "document",
  "link",
]);

// Build an outbound attachment object from a GHL template's file URL.
// Template files arrive as already-hosted URLs (no File / upload), so we
// infer the media type + display name from the URL itself. The type
// drives bubble rendering (image / video inline, everything else a pill).
function attachmentFromTemplateUrl(url: string): NonNullable<Message["attachment"]> {
  // Strip query / hash before reading the extension and filename.
  const clean = url.split(/[?#]/)[0];
  const name = decodeURIComponent(clean.split("/").pop() || "archivo") || "archivo";
  const ext = (name.split(".").pop() || "").toLowerCase();
  const type: NonNullable<Message["attachment"]>["type"] = [
    "jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "heic",
  ].includes(ext)
    ? "image"
    : ["mp4", "mov", "webm", "avi", "mkv", "m4v", "3gp"].includes(ext)
      ? "video"
      : ["mp3", "wav", "ogg", "m4a", "aac", "opus"].includes(ext)
        ? "audio"
        : "file";
  return { type, url, name };
}

// Per-channel pre-flight validation for outbound file attachments. The
// outbound /conversations/messages call goes to GHL, which forwards to
// Twilio (SMS/MMS) or Meta (WhatsApp). Both providers return opaque
// wrappers when they reject — "Twilio Error - ERR_BAD_REQUEST" or
// "Meta Error" with no underlying code — so the only way to give the
// agent an actionable reason is to validate against each channel's
// documented media matrix BEFORE we upload. Returns a Spanish-language
// rejection reason, or null when the file is acceptable.
//
// Sources:
//   - WhatsApp: HighLevel's "WhatsApp integration message types" table
//     (image JPEG/PNG ≤5 MB, video MP4/3GPP ≤16 MB, audio AAC/MP4/MPEG/AMR/OGG
//     ≤16 MB, document PDF/Word/Excel/PowerPoint/etc. ≤100 MB,
//     sticker static WebP outbound).
//   - SMS: Twilio MMS hard cap of 5 MB (carriers downsample further).
const WA_IMAGE_MIME = new Set(["image/jpeg", "image/jpg", "image/png"]);
const WA_VIDEO_MIME = new Set(["video/mp4", "video/3gpp"]);
const WA_AUDIO_MIME = new Set([
  "audio/aac",
  "audio/mp4",
  "audio/mpeg",
  "audio/mp3",
  "audio/amr",
  "audio/ogg",
  "audio/3gpp",
]);
const WA_DOCUMENT_MIME = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
]);

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Inspect the first 16 bytes of the file and identify the real format
// from its magic-byte signature. The browser-supplied `file.type` is
// based on extension and is unreliable — an iPhone HEIC photo saved as
// "foo.jpg" still reports `image/jpeg`, a QuickTime/MOV renamed `.mp4`
// still reports `video/mp4`, etc. Meta and Twilio reject those at the
// provider edge with opaque wrappers ("Meta Error", "Twilio Error -
// ERR_BAD_REQUEST"), so we have no way to give the agent a precise
// reason unless we sniff the bytes locally. Returns the actual MIME or
// null when the signature is unrecognised.
async function sniffActualMime(file: File): Promise<string | null> {
  const slice = file.slice(0, 16);
  const buf = new Uint8Array(await slice.arrayBuffer());
  if (buf.length < 4) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return "image/png";
  }
  // GIF: "GIF8"
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) {
    return "image/gif";
  }
  // RIFF container — WebP (image) or WAVE (audio). Brand at bytes 8..11.
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf.length >= 12
  ) {
    const brand = String.fromCharCode(buf[8], buf[9], buf[10], buf[11]);
    if (brand === "WEBP") return "image/webp";
    if (brand === "WAVE") return "audio/wav";
  }
  // ISO base media (MP4, MOV, 3GP, HEIC, ...): "ftyp" at bytes 4..7,
  // brand string at bytes 8..11 disambiguates.
  if (
    buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70 &&
    buf.length >= 12
  ) {
    const brand = String.fromCharCode(buf[8], buf[9], buf[10], buf[11]).toLowerCase();
    if (["heic", "heix", "mif1", "msf1", "heim", "heis"].includes(brand)) return "image/heic";
    if (brand.startsWith("3g")) return "video/3gpp";
    if (brand === "qt  ") return "video/quicktime";
    // Catch-all for the MP4 brand family (isom, iso2, mp41, mp42, avc1,
    // M4V, M4A, dash, ...). M4A is audio-only but uses the same
    // container; we can't tell without reading further so report mp4.
    return "video/mp4";
  }
  // PDF: "%PDF"
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
    return "application/pdf";
  }
  // ID3-tagged MP3 ("ID3")
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return "audio/mpeg";
  // Raw MP3 frame sync (FF Fx)
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return "audio/mpeg";
  // OGG: "OggS"
  if (buf[0] === 0x4f && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53) {
    return "audio/ogg";
  }
  // AMR: "#!AMR"
  if (
    buf[0] === 0x23 && buf[1] === 0x21 && buf[2] === 0x41 &&
    buf[3] === 0x4d && buf[4] === 0x52
  ) {
    return "audio/amr";
  }
  // ZIP-based Office (50 4B 03 04) — too generic to disambiguate docx vs
  // xlsx vs pptx without unzipping; trust the claimed MIME for those.
  return null;
}

// Some MIME pairs are functionally identical and shouldn't be flagged
// as a mismatch (the browser/OS just labels the same bytes differently).
function isEquivalentMime(a: string, b: string): boolean {
  if (a === b) return true;
  const norm = (m: string): string => {
    if (m === "image/jpg") return "image/jpeg";
    if (m === "audio/mp3") return "audio/mpeg";
    return m;
  };
  return norm(a) === norm(b);
}

async function validateAttachmentForChannel(
  file: File,
  channel: NonNullable<Message["channel"]>
): Promise<string | null> {
  const claimed = (file.type || "").toLowerCase();
  const actual = await sniffActualMime(file);

  // Honesty check: if the bytes contradict the browser's MIME claim,
  // tell the agent before they waste a round-trip uploading a file
  // Meta/Twilio will reject. iPhone HEIC saved as ".jpg" is the
  // canonical case; a renamed .mov sent as ".mp4" is the other.
  if (actual && claimed && !isEquivalentMime(actual, claimed)) {
    return `El archivo dice ser "${claimed}" pero su contenido real es "${actual}". Conviértelo al formato correcto o renómbralo antes de enviarlo.`;
  }

  // From here on prefer the sniffed MIME — it's authoritative when we
  // got one, and the rest of the validator treats `mime` as truth.
  const mime = actual || claimed;
  if (channel === "sms") {
    if (file.size > 5 * 1024 * 1024) {
      return `Twilio MMS sólo admite hasta 5 MB. Este archivo pesa ${formatBytes(file.size)}. Envíalo por WhatsApp.`;
    }
    return null;
  }
  if (channel === "whatsapp") {
    if (mime.startsWith("image/")) {
      if (mime === "image/webp") {
        if (file.size > 100 * 1024) {
          return `WhatsApp limita stickers estáticos (WebP) a 100 KB. Este archivo pesa ${formatBytes(file.size)}.`;
        }
        return null;
      }
      if (!WA_IMAGE_MIME.has(mime)) {
        return `WhatsApp sólo admite imágenes JPEG o PNG. Tipo detectado: ${mime || "desconocido"}.`;
      }
      if (file.size > 5 * 1024 * 1024) {
        return `WhatsApp limita imágenes a 5 MB. Este archivo pesa ${formatBytes(file.size)}.`;
      }
      return null;
    }
    if (mime.startsWith("video/")) {
      if (!WA_VIDEO_MIME.has(mime)) {
        return `WhatsApp sólo admite video MP4 o 3GPP. Tipo detectado: ${mime || "desconocido"}.`;
      }
      if (file.size > 16 * 1024 * 1024) {
        return `WhatsApp limita videos a 16 MB. Este archivo pesa ${formatBytes(file.size)}.`;
      }
      return null;
    }
    if (mime.startsWith("audio/")) {
      if (!WA_AUDIO_MIME.has(mime)) {
        return `WhatsApp sólo admite audio AAC, MP4, MPEG, AMR u OGG. Tipo detectado: ${mime || "desconocido"}.`;
      }
      if (file.size > 16 * 1024 * 1024) {
        return `WhatsApp limita audios a 16 MB. Este archivo pesa ${formatBytes(file.size)}.`;
      }
      return null;
    }
    // Anything else has to be a document. Reject unknown MIME outright —
    // sending a random binary makes Meta reject with no useful detail.
    if (!WA_DOCUMENT_MIME.has(mime)) {
      return `WhatsApp no admite este tipo de archivo. Tipos válidos: imagen (JPEG/PNG, máx 5 MB), video (MP4/3GPP, máx 16 MB), audio (AAC/MP4/MPEG/AMR/OGG, máx 16 MB), documento (PDF/Word/Excel/PowerPoint/etc., máx 100 MB). Tipo detectado: ${mime || "desconocido"}.`;
    }
    if (file.size > 100 * 1024 * 1024) {
      return `WhatsApp limita documentos a 100 MB. Este archivo pesa ${formatBytes(file.size)}.`;
    }
    return null;
  }
  return null;
}

// Spanish month abbreviations for the date-separator pills.
const MONTHS_ES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

// Curated emoji set for the message-composer picker. Grouped roughly by
// expression → gesture → heart → object / weather, but rendered as a single
// flat grid to keep the picker small and fast (no library, no font fetch).
const EMOJI_SET: ReadonlyArray<{ label: string; emojis: string[] }> = [
  {
    label: "Caras",
    emojis: [
      "😀", "😁", "😂", "🤣", "😃", "😄", "😅", "😆", "😉", "😊",
      "😋", "😎", "😍", "😘", "🥰", "🤗", "🤔", "🤨", "😐", "😶",
      "🙄", "😏", "😣", "😮", "😯", "😪", "🥱", "😴", "😌", "😛",
      "😜", "🤤", "😒", "😓", "🙂", "🙃", "😞", "😟", "😢", "😭",
      "😨", "😱", "🤯", "🥳", "🤩", "🥺", "😇", "🤓", "😬", "🤐",
    ],
  },
  {
    label: "Gestos",
    emojis: [
      "👍", "👎", "👌", "🤞", "🤟", "🤘", "🤙", "👏", "🙌", "🙏",
      "💪", "👋", "🤝", "✌️", "👀", "💯", "💥", "✨", "🎉", "🎊",
    ],
  },
  {
    label: "Corazones",
    emojis: [
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔",
      "💖", "💗", "💓", "💞", "💝", "💘", "💕", "💟", "🌹", "🌷",
    ],
  },
  {
    label: "Símbolos",
    emojis: [
      "✅", "❌", "⚠️", "🔥", "🌟", "⭐", "💧", "🌈", "☀️", "🌙",
      "⏰", "📅", "💼", "📞", "📧", "💰", "💊", "🩺", "🏥", "🦷",
    ],
  },
];


// Stable per-day key so we can detect when the day changes between two
// adjacent messages and inject a separator. Returns "" when the date isn't
// resolvable so messages without a `date` field don't trigger spurious
// separators.
function dayKey(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// "Hoy" / "Ayer" / "DD Mmm YYYY" — matches the WhatsApp-style separator the
// app uses elsewhere. Falls back to an empty string for unresolvable inputs.
function formatDateLabel(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  // Compare calendar days in Peru time (America/Lima) so the "Hoy / Ayer"
  // boundary is Peru's midnight, not the viewer's machine timezone.
  const thatYmd = peruYmd(d); // "YYYY-MM-DD"
  const todayYmd = peruYmd(new Date());
  if (thatYmd === todayYmd) return "Hoy";
  const [ty, tm, td] = todayYmd.split("-").map(Number);
  const yest = new Date(Date.UTC(ty, tm - 1, td) - 24 * 3600 * 1000);
  const yestYmd = `${yest.getUTCFullYear()}-${String(yest.getUTCMonth() + 1).padStart(2, "0")}-${String(yest.getUTCDate()).padStart(2, "0")}`;
  if (thatYmd === yestYmd) return "Ayer";
  const [y, m, day] = thatYmd.split("-").map(Number);
  return `${day} ${MONTHS_ES[m - 1]} ${y}`;
}

// Split an internal-note body around the staff names captured in
// `mentions` and wrap each `@Name` token in a styled pill. Names are
// matched longest-first so "@Ana Martínez" beats a bare "@Ana" when both
// are in the roster.
// Turn bare http(s) URLs in a plain string into clickable links —
// underlined, open in a new tab — like WhatsApp/Messenger. Trailing
// punctuation (".", ")", etc.) is kept out of the link target. The link
// color adapts to the bubble: on the colored (outbound) bubble a dark-blue
// link is invisible, so use a light blue; on light bubbles use dark blue.
function linkifyText(
  text: string,
  onColoredBubble = false
): React.ReactNode {
  if (!text) return text;
  const linkClass = onColoredBubble
    ? "text-blue-200 underline underline-offset-2 break-all hover:text-white"
    : "text-blue-600 underline underline-offset-2 break-all hover:text-blue-700 dark:text-blue-400";
  const re = /https?:\/\/[^\s]+/g;
  const out: React.ReactNode[] = [];
  let lastIndex = 0;
  let i = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) out.push(text.slice(lastIndex, match.index));
    let url = match[0];
    let trailing = "";
    const t = url.match(/[.,;:!?)\]}>"']+$/);
    if (t) {
      trailing = t[0];
      url = url.slice(0, url.length - trailing.length);
    }
    out.push(
      <a
        key={`url-${i++}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className={linkClass}
      >
        {url}
      </a>
    );
    if (trailing) out.push(trailing);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) out.push(text.slice(lastIndex));
  return out.length ? out : text;
}

// First bare http(s) URL in a string, with trailing punctuation trimmed —
// used to pick which link to render an Open Graph preview card for.
function firstHttpUrl(text: string): string | null {
  if (!text) return null;
  const m = text.match(/https?:\/\/[^\s]+/);
  if (!m) return null;
  let url = m[0];
  const t = url.match(/[.,;:!?)\]}>"']+$/);
  if (t) url = url.slice(0, url.length - t[0].length);
  return url;
}

function renderTextWithMentions(text: string, mentions: string[]): React.ReactNode {
  const names = mentions.filter(Boolean);
  if (names.length === 0) return linkifyText(text);
  const sorted = [...new Set(names)].sort((a, b) => b.length - a.length);
  const escaped = sorted.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`@(${escaped.join("|")})`, "g");
  const out: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex)
      out.push(
        <React.Fragment key={`seg-${lastIndex}`}>
          {linkifyText(text.slice(lastIndex, match.index))}
        </React.Fragment>
      );
    out.push(
      <span
        key={`mention-${match.index}`}
        className="inline rounded px-1 py-px font-semibold text-amber-800 bg-amber-200/60 dark:text-amber-200 dark:bg-amber-500/25"
      >
        @{match[1]}
      </span>
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length)
    out.push(
      <React.Fragment key={`seg-${lastIndex}`}>
        {linkifyText(text.slice(lastIndex))}
      </React.Fragment>
    );
  return out;
}

// Substitute WhatsApp template placeholders (`{{1}}`, `{{2}}`, …)
// with the recipient's name fields so the SPA bubble matches what
// Meta actually delivers. GHL fills these in at send time — but the
// local optimistic message echoes the raw template body, so without
// this the agent sees "Hola {{1}}" instead of the substituted value.
//
// Heuristic for the mapping:
//   - Template uses ONLY {{1}}            → {{1}} = full contact name
//     (matches the common GHL setup `{{contact.name}}` for the only
//     variable in a template).
//   - Template uses BOTH {{1}} and {{2}}  → {{1}} = first name,
//     {{2}} = last name (split on whitespace).
//   - Higher placeholders ({{3}}+) stay literal — we don't try to
//     guess what they map to.
//
// Conservative: only operates on `{{N}}` numeric tokens. Plain text
// that happens to contain a literal "{{1}}" gets substituted too,
// but that's vanishingly rare in real conversation content.
function substituteTemplateVars(
  text: string,
  contactName: string | undefined
): string {
  if (!text || !contactName) return text;
  const trimmed = contactName.trim();
  if (!trimmed) return text;
  const hasVar2 = /\{\{\s*2\s*\}\}/.test(text);
  if (hasVar2) {
    const parts = trimmed.split(/\s+/);
    const first = parts[0] ?? trimmed;
    const last = parts.slice(1).join(" ") || first;
    return text
      .replace(/\{\{\s*1\s*\}\}/g, first)
      .replace(/\{\{\s*2\s*\}\}/g, last);
  }
  return text.replace(/\{\{\s*1\s*\}\}/g, trimmed);
}

// True when the bubble would otherwise render nothing visible: no text, no
// system event, not an internal-channel notes bubble, and no attachment with
// a recognised type. This catches outbound voice notes recorded in the GHL
// native composer that come through without a body and without a fetchable
// `attachments[]` URL — without this fallback the chat shows an empty pill.
function bubbleHasNoVisibleContent(m: Message): boolean {
  if (m.text) return false;
  if (m.systemEvent) return false;
  if (m.channel === "internal") return false; // internal notes have their own
  // mentions/reminder rendering path that we don't want to override.
  if (m.attachment && RENDERABLE_ATTACHMENT_TYPES.has(m.attachment.type)) return false;
  return true;
}

// Call (phone) button in the chat header is temporarily hidden by request.
// Set to `true` to re-enable it.
const SHOW_CALL_BUTTON = false;

// Initials for an avatar fallback: first letter of the first + last word
// (e.g. "Migselle Rossello" → "MR"). Single word → its first two letters.
function nameInitials(name: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function ChatMessageArea({
  conversation,
  currentUser,
  users = [],
  tasks,
  onAddTask,
  onUpdateTask,
  onToggleTask,
  onSendMessage,
  onScheduleMessage,
  onSendTemplateNow,
  onCancelScheduledMessage,
  onUpdateStage,
  onClearReminder,
  onSetReminder,
  onToggleFavorite,
  onMarkAsRead,
  onMarkAsUnread,
  onForwardAudio,
  onSetBotStatus,
  isLoadingHistory = false,
  stages,
  setStages,
  isContactSidebarOpen,
  onToggleContactSidebar,
  hasOlderMessages = false,
  isLoadingOlderMessages = false,
  onLoadOlderMessages,
  onDeleteLead,
  onPinMessage,
  onUnpinMessage,
  onOpenMobileNav,
  onOpenChatList,
}: ChatMessageAreaProps) {
  const [inputText, setInputText] = useState("");
  // Multiple staged attachments — the agent can select/queue several files and
  // send them all at once (each goes out as its own message).
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  // Object URLs for image/video/PDF/audio previews of the staged files (null for
  // other types). Revoked when the staged set changes to avoid leaks.
  const filePreviews = useMemo(
    () =>
      selectedFiles.map((f) => {
        const isPdf =
          f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
        return f.type.startsWith("image/") ||
          f.type.startsWith("video/") ||
          f.type.startsWith("audio/") ||
          isPdf
          ? URL.createObjectURL(f)
          : null;
      }),
    [selectedFiles]
  );
  // Inline audio preview: one shared <audio>; track which card is playing.
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [playingAudioIdx, setPlayingAudioIdx] = useState<number | null>(null);
  const togglePreviewAudio = (idx: number) => {
    const url = filePreviews[idx];
    if (!url) return;
    let el = previewAudioRef.current;
    if (!el) {
      el = new Audio();
      el.onended = () => setPlayingAudioIdx(null);
      el.onpause = () => setPlayingAudioIdx((cur) => (el!.ended ? null : cur));
      previewAudioRef.current = el;
    }
    if (playingAudioIdx === idx) {
      el.pause();
      setPlayingAudioIdx(null);
      return;
    }
    el.src = url;
    el.currentTime = 0;
    el.play()
      .then(() => setPlayingAudioIdx(idx))
      .catch(() => setPlayingAudioIdx(null));
  };
  // Stop preview playback whenever the staged set changes (or on unmount).
  useEffect(() => {
    return () => {
      previewAudioRef.current?.pause();
    };
  }, [selectedFiles]);
  useEffect(
    () => () => filePreviews.forEach((u) => u && URL.revokeObjectURL(u)),
    [filePreviews]
  );
  // Files baked into a picked GHL template (snippet "attach files"). These
  // are already-hosted URLs — no upload step — staged so they're sent
  // alongside the template body. Cleared after send or manual removal.
  const [templateAttachments, setTemplateAttachments] = useState<
    NonNullable<Message["attachment"]>[]
  >([]);
  // The composer opens on the lead's primary channel. The component is
  // remounted (key={conversation.id} in Index.tsx) when switching leads, so a
  // useState initializer is enough — we don't need to re-derive on prop change.
  const [activeChannel, setActiveChannel] = useState<NonNullable<Message["channel"]>>(
    () => conversation.source ?? "whatsapp"
  );

  // Channels visible as tabs: the conversation's primary source + any channel
  // the message history actually uses + always-internal (private notes).
  const availableChannels = (() => {
    const seen = new Set<NonNullable<Message["channel"]>>([conversation.source, "internal"]);
    for (const m of conversation.messages) {
      if (m.channel) seen.add(m.channel);
    }
    return CHANNEL_ORDER.filter((c) => seen.has(c));
  })();
  const [activeReminder, setActiveReminder] = useState<string | null>(conversation.activeReminder || null);

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isRecordingPaused, setIsRecordingPaused] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Real GHL user id of the logged-in agent. `currentUser.id` is the "agent"
  // dedup sentinel — NOT a valid GHL user id — so resolve the real one from
  // the roster by name. Tasks MUST be assigned to this; GHL rejects "agent"
  // with "The assigned to field is invalid". Undefined if the roster hasn't
  // loaded or the agent isn't in it (then "me" is offered no option and the
  // task is created unassigned rather than with an invalid id).
  const myGhlUserId = useMemo(
    () =>
      users.find(
        (u) => u.name?.toLowerCase() === currentUser.name?.toLowerCase()
      )?.id,
    [users, currentUser.name]
  );

  // Outbound message bubbles show the contact's assigned user (Owner),
  // regardless of who actually sent each message. Resolve the owner from the
  // roster once for the whole thread.
  const ownerUser = useMemo(() => {
    const ownerId = conversation.participant?.assignedTo;
    return ownerId ? users.find((u) => u.id === ownerId) : undefined;
  }, [users, conversation.participant?.assignedTo]);

  const [isTaskDialogOpen, setIsTaskDialogOpen] = useState(false);
  // When non-null, the Nueva Tarea dialog is being used to edit an
  // existing task (vs. creating a new one). The submit handler branches
  // on this — if set, it patches via onUpdateTask; if null, it creates
  // via onAddTask. Reset to null whenever the dialog closes.
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);

  // Pre-fill the dialog with an existing task's fields and open it in
  // edit mode. Dialog state is shared with the create flow so we
  // re-use the same inputs; `editingTaskId` is what flips behaviour.
  const openTaskEditor = useCallback((task: Task) => {
    setEditingTaskId(task.id);
    setNewTaskTitle(task.title);
    // The backend already maps GHL's ISO dueDate back to the friendly
    // labels ("Hoy" / "Mañana" / "Próxima semana" / a localised date).
    // We only need to detect whether the saved label is one of the
    // four presets; anything else flips to "Personalizado" with the
    // raw value carried through customDueDateTime so the agent can
    // edit it without losing precision.
    const presets = ["Hoy", "Mañana", "Próxima semana"];
    if (presets.includes(task.dueDate)) {
      setNewTaskDueDate(task.dueDate);
      setCustomDueDateTime("");
    } else {
      setNewTaskDueDate("Personalizado");
      // Try to interpret the stored value as an ISO; otherwise leave
      // the picker empty so the user picks a fresh time. The native
      // datetime-local input wants "YYYY-MM-DDTHH:mm".
      const parsed = new Date(task.dueDate);
      if (!isNaN(parsed.getTime())) {
        const pad = (n: number) => String(n).padStart(2, "0");
        setCustomDueDateTime(
          `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
        );
      } else {
        setCustomDueDateTime("");
      }
    }
    setNewTaskAssignee(
      task.assignee.id ||
        users.find((u) => u.name === task.assignee.name)?.id ||
        myGhlUserId ||
        ""
    );
    setIsTaskDialogOpen(true);
  }, [currentUser.name, users, myGhlUserId]);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDueDate, setNewTaskDueDate] = useState("Hoy");
  // Captured by the datetime-local input when "Personalizado" is the chosen
  // preset. Shape is "YYYY-MM-DDTHH:mm" — `new Date(value)` parses it as
  // local time, then we hand the ISO string to the backend.
  const [customDueDateTime, setCustomDueDateTime] = useState("");
  // Holds the GHL user id of the selected assignee (default: current user's
  // real GHL id — never the "agent" sentinel, which GHL rejects).
  const [newTaskAssignee, setNewTaskAssignee] = useState(myGhlUserId ?? "");
  // Task description templates ("Plantillas de tarea"). Persisted to
  // localStorage so saved/edited/deleted templates survive a reload AND a
  // conversation switch (this component is remounted per conversation via
  // key={conversation.id}, which previously reset them to the defaults).
  const [taskPresets, setTaskPresets] = useState<string[]>(loadTaskPresets);
  // Mirror every change back to localStorage.
  useEffect(() => {
    saveTaskPresets(taskPresets);
  }, [taskPresets]);
  const [editingPresetIndex, setEditingPresetIndex] = useState<number | null>(null);
  const [editingPresetValue, setEditingPresetValue] = useState("");
  // Controlled so selecting a template closes the dropdown.
  const [templatePopoverOpen, setTemplatePopoverOpen] = useState(false);
  const [isStagesOpen, setIsStagesOpen] = useState(false);
  const [editingStageId, setEditingStageId] = useState<string | null>(null);
  const [editingStageName, setEditingStageName] = useState("");
  const [messageFilters, setMessageFilters] = useState<string[]>(["Todo"]);
  const [filterSearch, setFilterSearch] = useState("");

  // Filtered message list driven by the message-history filter dropdown
  // ("Todo / Conversaciones / WhatsApp / SMS / …"). The render loop maps over
  // this list, and `prevMessage` lookups for consecutive grouping use the
  // same filtered indices so collapsing behavior matches what's on screen.
  //
  // We also de-duplicate by `id` here as a safety net. The merge paths that
  // populate `conversation.messages` (mergeIncomingMessage, the lead.updated
  // existingIds filter, the load-older-messages dedup) all attempt to keep
  // the array unique, but they race against each other across WS reconnects,
  // optimistic-send echoes, and the lazy-hydrate `...existing, ...full`
  // swap. A transient duplicate would otherwise trip React's "two children
  // with the same key" warning and could cause a node to be omitted on the
  // next render. Keeping the first occurrence preserves message order.
  const visibleMessages = useMemo(() => {
    const seen = new Set<string>();
    const out: Message[] = [];
    for (const m of conversation.messages) {
      if (seen.has(m.id)) continue;
      if (!messageMatchesFilters(m, messageFilters)) continue;
      seen.add(m.id);
      out.push(m);
    }
    return out;
  }, [conversation.messages, messageFilters]);
  const [replyingToMessage, setReplyingToMessage] = useState<Message | null>(null);

  // Template-aware button resolution. Three signals, in order:
  //   (1) message.buttons — populated by the optimistic send when the
  //       agent fires a template through the SPA.
  //   (2) message.templateName — set by the backend decorator when a
  //       SentTemplate row was reconciled with this messageId. Looked
  //       up by exact (name, language) in the cached templates list.
  //   (3) body match — for any outbound whatsapp text that came back
  //       from GHL stripped of template metadata (the common case
  //       across reloads / other-agent views), compare against every
  //       cached template treating `{{N}}` as a wildcard. The most
  //       specific match wins; an unmatched message renders no buttons.
  //
  // The templates list is fetched only when at least one visible
  // message is a candidate so a pure free-form thread pays nothing.
  const needsTemplates = useMemo(
    () =>
      visibleMessages.some(
        (m) =>
          (!m.buttons || m.buttons.length === 0) &&
          (m.templateName ||
            (m.channel === "whatsapp" && m.senderId === "agent" && !!m.text))
      ),
    [visibleMessages]
  );
  const templatesQuery = useTemplates("whatsapp", { enabled: needsTemplates });
  const templateMatchers = useMemo(
    () => compileTemplateMatchers(templatesQuery.data),
    [templatesQuery.data]
  );
  // Debug: log the templates cache state once per change so you can
  // see how many candidates the body-match has to choose from.
  useEffect(() => {
    if (!needsTemplates) return;
    console.log(
      `[tpl-buttons] templates loaded: ${templatesQuery.data?.length ?? 0}, matchers: ${templateMatchers.length}, querying: ${templatesQuery.isFetching}`
    );
  }, [
    needsTemplates,
    templatesQuery.data,
    templateMatchers.length,
    templatesQuery.isFetching,
  ]);
  const resolveButtonsForMessage = useCallback(
    (m: Message) => {
      if (m.buttons && m.buttons.length > 0) return m.buttons;
      if (m.templateName) {
        const direct = templateButtonsFor(
          templatesQuery.data,
          m.templateName,
          m.templateLanguage
        );
        if (direct) return direct;
      }
      if (
        m.channel === "whatsapp" &&
        m.senderId === "agent" &&
        m.text &&
        templateMatchers.length > 0
      ) {
        const matched = matchTemplateByBody(templateMatchers, m.text);
        if (matched) {
          console.log(
            `[tpl-buttons] body-match HIT for msg ${m.id}: template "${matched.name}" (${matched.language})`
          );
          return buttonsFromTemplate(matched);
        }
        // Log the first-line head so you can compare it against the
        // template bodies in the cache when no match wins.
        console.log(
          `[tpl-buttons] body-match MISS for msg ${m.id}: text starts with "${m.text.slice(0, 60).replace(/\n/g, "\\n")}…"`
        );
      }
      return undefined;
    },
    [templatesQuery.data, templateMatchers]
  );

  // Meta WhatsApp 24h policy: once the customer has been silent for >24h
  // the agent can only re-engage by sending a Meta-approved template.
  // We surface this as a sticky "Ventana de 24h expirada" banner above
  // the chat AND lock the composer so the agent can't accidentally send
  // a free-form message that WhatsApp would reject.
  const isWhatsApp24hWindowExpired = useMemo(() => {
    if (conversation.source !== "whatsapp") return false;
    // While the message history is still loading, `conversation.messages`
    // is empty — so the inbound scan below would find nothing and wrongly
    // report the 24h window as expired (showing the banner + locking the
    // composer). Hold off until the history has hydrated.
    if (isLoadingHistory) return false;
    // Walk backward to find the most recent INBOUND message (sender
    // is the contact, not "agent" / "system"). System events and
    // outbound messages don't reset Meta's 24h window.
    let lastInboundIso: string | null = null;
    for (let i = conversation.messages.length - 1; i >= 0; i--) {
      const m = conversation.messages[i];
      if (m.systemEvent) continue;
      if (m.senderId !== "agent" && m.senderId !== "system") {
        lastInboundIso = m.date ?? null;
        break;
      }
    }
    // No inbound has ever arrived → treat as expired (a brand-new
    // conversation can't be opened with a free-form message anyway).
    if (!lastInboundIso) return true;
    const lastInboundMs = new Date(lastInboundIso).getTime();
    if (!Number.isFinite(lastInboundMs)) return true;
    return Date.now() - lastInboundMs > 24 * 60 * 60 * 1000;
  }, [conversation.source, conversation.messages, isLoadingHistory]);

  // Two surfaces drive scheduling now: a small entry Popover (quick
  // text-message scheduling + button to open the rich dialog) and the
  // rich WhatsApp template dialog itself.
  const [isScheduleOpen, setIsScheduleOpen] = useState(false);
  const [isBotOpen, setIsBotOpen] = useState(false);
  const [isTemplateDialogOpen, setIsTemplateDialogOpen] = useState(false);
  const [quickScheduleOptionId, setQuickScheduleOptionId] = useState<ScheduleOptionId>("manana_9am");
  const [quickCustomDatetime, setQuickCustomDatetime] = useState(defaultLocalDatetime);

  // "Plantillas rápidas" — sourced from the GHL templates/snippets store
  // (read-only). The list is the single source of truth in GHL; the SPA
  // doesn't create/edit/delete here. `category` maps to the snippet
  // folder so the category sidebar still works.
  const [messageTemplates, setMessageTemplates] = useState<
    { id: string; title: string; text: string; category: string; attachments: string[] }[]
  >([]);
  const [isTemplateMenuOpen, setIsTemplateMenuOpen] = useState(false);
  const [templateSearch, setTemplateSearch] = useState("");
  // Active category in the Plantillas rápidas popover sidebar.
  // "" / "Todas" means "no filter — show every template".
  const [templateCategory, setTemplateCategory] = useState<string>("");

  // Internal-note "@" mention picker. Only opens on the internal channel —
  // outbound channels don't get a roster popup because the recipient is the
  // lead, not a staff user. `mentionAnchor` is the index of the `@` in the
  // current `inputText`; we use it to replace `@<partial>` on selection.
  const [isMentionMenuOpen, setIsMentionMenuOpen] = useState(false);
  const [mentionSearch, setMentionSearch] = useState("");
  const [mentionAnchor, setMentionAnchor] = useState<number | null>(null);
  const [mentionSelectedIdx, setMentionSelectedIdx] = useState(0);

  // Hydrate from the backend once on mount. Failures fall back to an
  // empty list and the agent can still create new templates — they'll
  // appear once the backend recovers and the user reopens the popover.
  useEffect(() => {
    let cancelled = false;
    api.templates
      .list({ type: "sms" })
      .then((res) => {
        if (cancelled) return;
        setMessageTemplates(
          res.templates.map((t) => ({
            id: t.id,
            title: t.name,
            text: t.body,
            category: t.category ?? "",
            attachments: t.attachments ?? [],
          }))
        );
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("[templates] load failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // While true, keep the thread pinned to the very bottom as its height grows
  // (e.g. images/video/audio finish loading AFTER the initial jump, which would
  // otherwise leave the view stranded above the last message). Turned off as
  // soon as the agent scrolls up to read history; reset to true per conversation.
  const pinBottomRef = useRef(true);
  // Scroll management refs — no state needed, mutations happen outside render.
  const initialScrollDoneRef = useRef(false);
  const prevFirstMessageIdRef = useRef<string | undefined>(undefined);
  const scrollHeightBeforeRef = useRef(0);
  const scrollTopBeforeRef = useRef(0);
  // Guards against firing onLoadOlderMessages twice before isLoadingOlderMessages updates.
  const requestedOlderRef = useRef(false);
  // Set the moment the agent sends a message from THIS composer, so the next
  // appended message scrolls the thread to the bottom unconditionally — even if
  // the agent had scrolled up. Inbound messages keep the "only if near bottom"
  // behaviour so reading history isn't interrupted.
  const forceScrollOnSendRef = useRef(false);

  // When the conversation changes, reset all scroll-state refs so the new
  // conversation always starts with a jump-to-bottom (branch 1 in the
  // useLayoutEffect below). Without this, switching conversations can
  // accidentally trigger the "prepend restore" path.
  useLayoutEffect(() => {
    initialScrollDoneRef.current = false;
    prevFirstMessageIdRef.current = undefined;
    requestedOlderRef.current = false;
    // New conversation always starts pinned to the bottom.
    pinBottomRef.current = true;
  }, [conversation.id]);

  // Keep the thread glued to the bottom while its height changes from async
  // media (images/video/audio loading after the initial jump). Without this the
  // first jump-to-bottom can land above the last message once those finish
  // loading. We stop pinning the moment the agent scrolls up (see onScroll).
  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (pinBottomRef.current && !isLoadingHistory) {
        el.scrollTop = el.scrollHeight;
      }
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, [conversation.id, isLoadingHistory]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || conversation.messages.length === 0) return;
    // While history is loading the message list is rendered `hidden` (see the
    // skeleton branch), so it has zero height — jumping "to bottom" now would
    // land at the top and never correct itself. Wait until loading finishes;
    // `isLoadingHistory` is in the deps so this re-runs the moment the real
    // messages become visible, and the initial jump-to-bottom fires then.
    if (isLoadingHistory) return;

    const firstId = conversation.messages[0]?.id;

    if (!initialScrollDoneRef.current) {
      // First paint with messages — jump to bottom without animation.
      el.scrollTop = el.scrollHeight;
      initialScrollDoneRef.current = true;
      prevFirstMessageIdRef.current = firstId;
      return;
    }

    if (firstId !== prevFirstMessageIdRef.current) {
      // Older messages were prepended — restore the previous scroll position so
      // the user stays at the same spot they were reading.
      const diff = el.scrollHeight - scrollHeightBeforeRef.current;
      el.scrollTop = scrollTopBeforeRef.current + diff;
      prevFirstMessageIdRef.current = firstId;
      return;
    }

    // New message appended. If the agent just sent it from this composer, jump
    // to the bottom so they see their own message regardless of where they had
    // scrolled. Otherwise (an inbound message), only follow when already near
    // the bottom so reading older history isn't interrupted.
    if (forceScrollOnSendRef.current) {
      forceScrollOnSendRef.current = false;
      el.scrollTop = el.scrollHeight;
      return;
    }
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 150) {
      el.scrollTop = el.scrollHeight;
    }
  }, [conversation.id, conversation.messages.length, isLoadingHistory]);

  // Reset the guard when the parent signals loading is done.
  useEffect(() => {
    if (!isLoadingOlderMessages) requestedOlderRef.current = false;
  }, [isLoadingOlderMessages]);

  // Smooth-scroll the chat to a message by id and briefly highlight it
  // so the agent can spot the target after the scroll lands. Used by the
  // pinned-message banners — clicking one jumps to the original message.
  // The ring fade is driven by a one-shot CSS animation class added for
  // ~1.5s. If the target isn't currently in the rendered list (older
  // history not yet hydrated) we fall back to a noop — pin banners
  // store a snapshot, so the user still sees the content above.
  const scrollToPinnedMessage = useCallback((messageId: string) => {
    if (typeof document === "undefined") return;
    const root = scrollRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(messageId)}"]`
    );
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-amber-400/70", "rounded-lg");
    window.setTimeout(() => {
      el.classList.remove("ring-2", "ring-amber-400/70", "rounded-lg");
    }, 1500);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Append ALL chosen files so the agent can pick several at once (and add
    // more in a second pick before sending).
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) {
      setSelectedFiles((prev) => [...prev, ...files]);
    }
    // Reset input value so the same file can be selected again if removed
    if (e.target) {
      e.target.value = '';
    }
  };

  const handleRemoveFile = () => {
    setSelectedFiles([]);
    setReplyingToMessage(null);
  };
  // Remove a single staged file by index.
  const removeFileAt = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const stopRecordingCleanup = useCallback(() => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
    setIsRecording(false);
    setIsRecordingPaused(false);
    setRecordingDuration(0);
  }, []);

  // Pause / resume an in-progress recording. MediaRecorder.pause() stops
  // capturing without finalizing, so resume() continues the same take; we just
  // freeze/restart the duration timer to match.
  const pauseRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    recorder.pause();
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setIsRecordingPaused(true);
  }, []);

  const resumeRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "paused") return;
    recorder.resume();
    recordingTimerRef.current = setInterval(
      () => setRecordingDuration((d) => d + 1),
      1000
    );
    setIsRecordingPaused(false);
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")
        ? "audio/ogg;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "";
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.start(250);
      setIsRecording(true);
      setIsRecordingPaused(false);
      setRecordingDuration(0);
      recordingTimerRef.current = setInterval(
        () => setRecordingDuration((d) => d + 1),
        1000
      );
    } catch {
      toast({
        title: "Micrófono no disponible",
        description: "Permite el acceso al micrófono en tu navegador.",
        variant: "destructive",
      });
    }
  }, [toast]);

  const cancelRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    audioChunksRef.current = [];
    stopRecordingCleanup();
  }, [stopRecordingCleanup]);

  const pendingVoiceNoteRef = useRef(false);

  const stopAndSendRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;

    recorder.onstop = () => {
      const chunks = audioChunksRef.current;
      if (chunks.length === 0) {
        stopRecordingCleanup();
        return;
      }
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/ogg" });
      // WhatsApp voice notes and Green API both accept Ogg/Opus (and M4A/AAC),
      // but Green API picks the outgoing file type from the fileName EXTENSION,
      // and `.webm` — what Chrome falls back to when it can't record an Ogg
      // container — is NOT in Green API's supported list. The recorded
      // opus/aac audio itself is fine; only the container label needs fixing.
      // So map the recorded mime to an extension both sides accept: .ogg for
      // opus (Chrome's webm + Firefox's ogg), .m4a for Safari's mp4/aac.
      const recMime = (recorder.mimeType || "").toLowerCase();
      const isMp4 =
        recMime.includes("mp4") || recMime.includes("aac") || recMime.includes("m4a");
      const ext = isMp4 ? "m4a" : "ogg";
      const outType = isMp4 ? "audio/mp4" : "audio/ogg";
      const file = new File([blob], `voice-note-${Date.now()}.${ext}`, {
        type: outType,
      });
      audioChunksRef.current = [];
      stopRecordingCleanup();
      pendingVoiceNoteRef.current = true;
      // Voice note replaces the staged set (sent immediately on its own).
      setSelectedFiles([file]);
    };
    recorder.stop();
  }, [stopRecordingCleanup]);

  // Auto-submit when a voice note file is staged
  useEffect(() => {
    if (pendingVoiceNoteRef.current && selectedFiles.length > 0) {
      pendingVoiceNoteRef.current = false;
      const form = document.querySelector<HTMLFormElement>("[data-chat-form]");
      form?.requestSubmit();
    }
  }, [selectedFiles]);

  // Cleanup on unmount (e.g. switching conversations)
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const [isUploading, setIsUploading] = useState(false);
  // File shown in the full-screen viewer modal — used for both staged (blob URL)
  // and sent (proxied URL) attachments. `url` is already final (not re-proxied).
  // `rawUrl` is the original public URL (sent attachments only) — needed by the
  // Office Online viewer, which fetches the document from its own servers and
  // can't read our auth-gated proxy or local blob URLs.
  const [viewerFile, setViewerFile] = useState<
    { url: string; name: string; mime?: string; rawUrl?: string } | null
  >(null);
  // Open the viewer for a staged file (reusing its preview blob URL, or making
  // one on demand for non-previewable types so the modal can still offer it).
  const openStagedViewer = (idx: number) => {
    const f = selectedFiles[idx];
    if (!f) return;
    setViewerFile({
      url: filePreviews[idx] ?? URL.createObjectURL(f),
      name: f.name,
      mime: f.type,
    });
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!(inputText.trim() || selectedFiles.length > 0 || templateAttachments.length > 0)) return;
    if (isUploading) return;

    // Pre-flight EVERY staged file against the channel's media matrix (Twilio
    // MMS for SMS, Meta/WhatsApp's supported types for whatsapp). The
    // downstream provider rejections are opaque, so catching violations locally
    // is the only way to tell the agent WHY a file won't go through.
    for (const file of selectedFiles) {
      const reason = await validateAttachmentForChannel(file, activeChannel);
      if (reason) {
        toast({
          title: `Archivo no compatible con el canal: ${file.name}`,
          description: reason,
          variant: "destructive",
        });
        return;
      }
    }

    // Upload all staged files (in order) so each can be sent as its own message.
    const uploadedAttachments: NonNullable<Message["attachment"]>[] = [];
    if (selectedFiles.length > 0) {
      setIsUploading(true);
      try {
        for (const file of selectedFiles) {
          // Upload to GHL's conversation-attachment endpoint first. Pass
          // the active conversation id so the resulting URL is one GHL's
          // send-message handler recognises as proper media — library
          // URLs make GHL fall through to a text-only Meta payload and
          // get 400'd with "text.body is required".
          const uploaded = await api.uploads.create(file, conversation.id);
          const mime = uploaded.mimeType || file.type || "";
          const type: NonNullable<Message["attachment"]>["type"] = mime.startsWith("image/")
            ? "image"
            : mime.startsWith("video/")
              ? "video"
              : mime.startsWith("audio/")
                ? "audio"
                : "file";
          uploadedAttachments.push({ type, url: uploaded.url, name: uploaded.name });
        }
      } catch (err) {
        toast({
          title: "No se pudo subir el archivo",
          description: (err as Error).message || "Inténtalo de nuevo.",
          variant: "destructive",
        });
        setIsUploading(false);
        return;
      }
      setIsUploading(false);
    }

    let mentions: string[] = [];
    if (activeChannel === "internal") {
      // Prefer roster-aware matching when we have a user list — names can
      // contain spaces ("Ana Martínez"), which the legacy \w+ regex would
      // truncate to the first word. We scan longest names first so a
      // mention of "Ana Martínez" isn't mis-captured as just "Ana".
      if (users.length > 0) {
        const sorted = [...users].sort((a, b) => b.name.length - a.name.length);
        const seen = new Set<string>();
        for (const u of sorted) {
          if (!u.name) continue;
          if (inputText.includes(`@${u.name}`) && !seen.has(u.name)) {
            mentions.push(u.name);
            seen.add(u.name);
          }
        }
      }
      if (mentions.length === 0) {
        // Fallback: no roster (or no name matched) — capture single-word
        // tokens so the existing "Asignado a @Foo" footer still works.
        const mentionRegex = /@(\w+)/g;
        const matches = inputText.match(mentionRegex);
        if (matches) mentions = matches.map((m) => m.substring(1));
      }
    }

    // Carry the quoted-message context ("Responder") into the send so the
    // outgoing bubble shows what it's replying to.
    const replyTo = replyingToMessage
      ? {
          id: replyingToMessage.id,
          text:
            replyingToMessage.text ||
            (replyingToMessage.attachment
              ? `Archivo ${replyingToMessage.attachment.type}`
              : "Mensaje"),
          sender:
            replyingToMessage.senderId === currentUser.id
              ? currentUser.name
              : conversation.participant.name,
        }
      : undefined;
    // All attachments to send: the agent's staged files first, then any files a
    // picked template carries (GHL snippet "attach files"). The first goes out
    // with the text; the rest are sent as their own messages so each renders in
    // its own bubble (mirrors how multi-file sends arrive on the wire).
    const allAttachments = [...uploadedAttachments, ...templateAttachments];
    let primaryAttachment = allAttachments.shift();
    const extraAttachments = allAttachments;

    // Agent is sending — scroll the thread to their new message once it lands.
    forceScrollOnSendRef.current = true;
    onSendMessage(inputText, primaryAttachment, activeChannel, mentions.length > 0 ? mentions : undefined, activeReminder || undefined, replyTo);
    for (const extra of extraAttachments) {
      onSendMessage("", extra, activeChannel, undefined, undefined, undefined);
    }
    setInputText("");
    handleRemoveFile();
    setTemplateAttachments([]);
    // Do not clear activeReminder here, let it stay until user closes it
  };


  // Insert an emoji at the textarea's caret position (or append when there's
  // no caret yet). Mirrors the cursor-aware pattern in `insertTemplate` so the
  // picker behaves the same as quick-replies.
  const insertEmoji = (emoji: string) => {
    const textarea = document.querySelector('textarea');
    const cursorPosition = textarea?.selectionStart ?? inputText.length;
    const before = inputText.substring(0, cursorPosition);
    const after = inputText.substring(cursorPosition);
    const newText = before + emoji + after;
    setInputText(newText);
    setTimeout(() => {
      textarea?.focus();
      const next = cursorPosition + emoji.length;
      try {
        textarea?.setSelectionRange(next, next);
      } catch {
        /* ignore — textarea may have been unmounted */
      }
    }, 0);
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInputText(value);

    const cursorPosition = e.target.selectionStart;
    const textBeforeCursor = value.substring(0, cursorPosition);

    // Slash-trigger for "Plantillas rápidas".
    const slashMatch = textBeforeCursor.match(/(?:^|\s)\/([^\s]*)$/);
    if (slashMatch) {
      setIsTemplateMenuOpen(true);
      setTemplateSearch(slashMatch[1]);
    } else {
      setIsTemplateMenuOpen(false);
    }

    // At-trigger for internal-note mentions. Anchored at start-of-line or
    // after whitespace so an email address (`foo@bar`) doesn't fire it.
    // The capture group allows spaces inside the query so multi-word names
    // ("Ana Mart…") can be searched without the menu closing on the space.
    if (activeChannel === "internal" && users.length > 0) {
      const atMatch = textBeforeCursor.match(/(?:^|\s)@([^\n@]{0,40})$/);
      if (atMatch) {
        const anchor = cursorPosition - atMatch[1].length - 1;
        setIsMentionMenuOpen(true);
        setMentionSearch(atMatch[1]);
        setMentionAnchor(anchor);
        setMentionSelectedIdx(0);
      } else if (isMentionMenuOpen) {
        setIsMentionMenuOpen(false);
        setMentionAnchor(null);
      }
    } else if (isMentionMenuOpen) {
      setIsMentionMenuOpen(false);
      setMentionAnchor(null);
    }
  };

  // Replace `@<partial>` (from `mentionAnchor` to the current caret) with
  // `@<full name> ` and close the picker. The textarea may have been moved
  // since the menu opened, so we re-read the caret rather than trusting the
  // stale `mentionSearch.length` math.
  const insertMention = (user: AgentUser) => {
    if (mentionAnchor === null) {
      setIsMentionMenuOpen(false);
      return;
    }
    const textarea = document.querySelector<HTMLTextAreaElement>(
      'textarea[data-composer="true"]'
    );
    const caret = textarea?.selectionStart ?? mentionAnchor + 1 + mentionSearch.length;
    const before = inputText.substring(0, mentionAnchor);
    const after = inputText.substring(caret);
    const insertion = `@${user.name} `;
    const next = before + insertion + after;
    setInputText(next);
    setIsMentionMenuOpen(false);
    setMentionAnchor(null);
    setMentionSearch("");

    setTimeout(() => {
      textarea?.focus();
      const pos = before.length + insertion.length;
      try {
        textarea?.setSelectionRange(pos, pos);
      } catch {
        /* textarea unmounted */
      }
    }, 0);
  };

  // Roster filtered by what the user has typed after `@`. Match is
  // case/accent-tolerant via `localeCompare`-style normalization so typing
  // "ana mart" still surfaces "Ana Martínez".
  const filteredMentionUsers = useMemo(() => {
    if (!isMentionMenuOpen) return [] as AgentUser[];
    const q = mentionSearch.trim().toLowerCase();
    if (!q) return users.slice(0, 8);
    const norm = (s: string) =>
      s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const needle = norm(q);
    return users.filter((u) => norm(u.name).includes(needle)).slice(0, 8);
  }, [isMentionMenuOpen, mentionSearch, users]);

  const insertTemplate = (templateText: string, attachments?: string[]) => {
    // Stage any files the template carries so they're sent with the body.
    // Append rather than replace so picking a second template doesn't drop
    // the first one's files (de-duped by URL).
    if (attachments && attachments.length > 0) {
      setTemplateAttachments((prev) => {
        const seen = new Set(prev.map((a) => a.url));
        const fresh = attachments
          .filter((u) => !seen.has(u))
          .map((u) => attachmentFromTemplateUrl(u));
        return [...prev, ...fresh];
      });
    }
    const textarea = document.querySelector('textarea');
    const cursorPosition = textarea?.selectionStart || inputText.length;
    const textBeforeCursor = inputText.substring(0, cursorPosition);
    const textAfterCursor = inputText.substring(cursorPosition);
    
    const match = textBeforeCursor.match(/(?:^|\s)\/([^\s]*)$/);
    if (match) {
      const slashIndex = textBeforeCursor.lastIndexOf('/' + match[1]);
      const prefix = textBeforeCursor.substring(0, slashIndex);
      const newText = prefix + (prefix.length > 0 && !prefix.endsWith(' ') ? ' ' : '') + templateText + textAfterCursor;
      setInputText(newText);
    } else {
      setInputText(inputText + templateText);
    }
    setIsTemplateMenuOpen(false);
    
    setTimeout(() => {
      textarea?.focus();
    }, 10);
  };

  return (
    <div className="flex h-full flex-1 flex-col min-w-0 bg-background">
      {/* Header */}
      <div className="flex h-[68px] items-center justify-between gap-2 border-b bg-card/50 px-4 py-3 backdrop-blur-sm overflow-hidden">
        <div className="flex items-center gap-3 min-w-0 shrink">
          {onOpenMobileNav && (
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden h-8 w-8 rounded-full shrink-0"
              onClick={onOpenMobileNav}
              aria-label="Abrir navegación"
            >
              <Menu className="h-5 w-5" />
            </Button>
          )}
          {onOpenChatList && (
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden h-8 w-8 rounded-full shrink-0"
              onClick={onOpenChatList}
              aria-label="Ver lista de conversaciones"
            >
              <Inbox className="h-5 w-5" />
            </Button>
          )}
          <ChannelAvatar
            name={conversation.participant.name}
            src={conversation.participant.avatar}
            status={conversation.participant.status}
            className="h-10 w-10 shrink-0"
          />
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-semibold text-foreground truncate">
                {conversation.participant.name}
              </span>
            </div>
            <span className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5 min-w-0">
              <span className="capitalize font-medium truncate">{conversation.source}</span>
              <span className="h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
              <span className="truncate">{conversation.recipientNumber}</span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1 sm:gap-2 min-w-0 overflow-x-auto -mx-1 px-1 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {/* Status Dropdown */}
          <Popover open={isStagesOpen} onOpenChange={setIsStagesOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className="h-9 text-[13px] font-medium border-slate-200 bg-slate-50 hover:bg-slate-100 focus:ring-0 w-[110px] sm:w-[120px] shrink-0 rounded-full px-3 shadow-none text-slate-700 dark:bg-muted/50 dark:border-border dark:text-foreground transition-colors mr-1 justify-between">
                <div className="flex items-center gap-2 truncate">
                  {/* Resolve the stage exactly like the conversation-list badge
                      (ChatSidebar): fall back to the first pipeline stage when
                      the conversation has no explicit stage yet, so the header
                      and the list always show the same thing. */}
                  <div className={cn("h-2 w-2 shrink-0 rounded-full", stages.find(s => s.id === (conversation.stage || stages[0]?.id))?.color || "bg-slate-500")} />
                  <span className="truncate">{stages.find(s => s.id === (conversation.stage || stages[0]?.id))?.label || "Estado"}</span>
                </div>
                <ChevronDown className="h-4 w-4 shrink-0 opacity-50 ml-1" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-2 rounded-xl" align="start">
              <div className="space-y-1">
                {stages.map((stage) => (
                  <div key={stage.id} className="flex items-center gap-1">
                    <div
                      className="flex flex-1 items-center px-2 py-1.5 text-sm rounded-md hover:bg-accent cursor-pointer"
                      onClick={() => {
                        onUpdateStage?.(conversation.id, stage.id);
                        setIsStagesOpen(false);
                      }}
                    >
                      <div className="flex items-center gap-2 truncate">
                        {(conversation.stage || stages[0]?.id) === stage.id && <Check className="h-4 w-4 shrink-0" />}
                        <div className={cn("h-2 w-2 shrink-0 rounded-full", stage.color, (conversation.stage || stages[0]?.id) !== stage.id && "ml-6")} />
                        <span className="truncate">{stage.label}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="hidden xl:inline-flex h-9 w-12 rounded-full bg-emerald-50 text-emerald-600 hover:bg-emerald-100 hover:text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/20">
                <MessageCircle className="h-4 w-4" />
                <ChevronDown className="h-3 w-3 ml-0.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuCheckboxItem
                checked={messageFilters.includes("Todo")}
                // Keep the dropdown open after toggling so the agent can stack
                // several filters without reopening it between each click.
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={(c) => {
                  if (c) setMessageFilters(["Todo"]);
                  else setMessageFilters([]);
                }}
              >
                Todo
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={messageFilters.includes("Conversaciones")}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={(c) => {
                  if (c) setMessageFilters(prev => [...prev.filter(f => f !== "Todo"), "Conversaciones"]);
                  else setMessageFilters(prev => prev.filter(f => f !== "Conversaciones"));
                }}
              >
                Conversaciones
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={messageFilters.includes("Actividades")}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={(c) => {
                  if (c) setMessageFilters(prev => [...prev.filter(f => f !== "Todo"), "Actividades"]);
                  else setMessageFilters(prev => prev.filter(f => f !== "Actividades"));
                }}
              >
                Actividades
              </DropdownMenuCheckboxItem>
              
              <div className="h-px bg-muted my-1 mx-1" />
              
              <div className="p-2">
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input 
                    placeholder="Buscar" 
                    className="h-9 pl-8" 
                    value={filterSearch}
                    onChange={(e) => setFilterSearch(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                </div>
              </div>
              
              <ScrollArea className="h-[200px]">
                {[
                  "SMS", "Llamada", "WhatsApp", "Comentario interno", 
                  "Contactos", "Citas", "Oportunidades", "Pagos", 
                  "Factura", "Registros de acciones de AI"
                ].filter(opt => opt.toLowerCase().includes(filterSearch.toLowerCase())).map(opt => (
                  <DropdownMenuCheckboxItem
                    key={opt}
                    checked={messageFilters.includes(opt)}
                    onSelect={(e) => e.preventDefault()}
                    onCheckedChange={(c) => {
                      if (c) setMessageFilters(prev => [...prev.filter(f => f !== "Todo"), opt]);
                      else setMessageFilters(prev => prev.filter(f => f !== opt));
                    }}
                  >
                    {opt}
                  </DropdownMenuCheckboxItem>
                ))}
              </ScrollArea>
            </DropdownMenuContent>
          </DropdownMenu>
          {/* Call: opens the OS tel: handler. Disabled when the contact has no phone.
              Hidden below xl — also reachable from the contact sidebar.
              Temporarily hidden by request — flip SHOW_CALL_BUTTON to true to restore. */}
          {SHOW_CALL_BUTTON && (
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="hidden 2xl:inline-flex h-9 w-9 rounded-full bg-indigo-50 text-indigo-600 hover:bg-indigo-100 hover:text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400 dark:hover:bg-indigo-500/20 disabled:opacity-40"
                disabled={!conversation.participant.phone}
                onClick={() => {
                  if (conversation.participant.phone) {
                    window.location.href = `tel:${conversation.participant.phone}`;
                  }
                }}
              >
                <Phone className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {conversation.participant.phone
                ? `Llamar a ${conversation.participant.phone}`
                : "Sin número de teléfono"}
            </TooltipContent>
          </Tooltip>
          )}

          {/* Favorite: toggles isFavorite via the parent's handler (which patches
              the GHL flag store). Star fills when the conversation is favorited. */}
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-9 w-9 rounded-full bg-orange-50 text-orange-500 hover:bg-orange-100 hover:text-orange-600 dark:bg-orange-500/10 dark:text-orange-400 dark:hover:bg-orange-500/20",
                  conversation.isFavorite && "bg-orange-100 dark:bg-orange-500/20"
                )}
                onClick={() => onToggleFavorite?.(conversation.id)}
              >
                <Star
                  className={cn("h-4 w-4", conversation.isFavorite && "fill-current")}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {conversation.isFavorite ? "Quitar de favoritos" : "Marcar como favorito"}
            </TooltipContent>
          </Tooltip>

          {/* Unread toggle: shows how many unread messages the lead has sent
              (badge on the envelope) and lets the agent mark the conversation
              read (clears the badge) or unread again with a click. */}
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => {
                  if ((conversation.unreadCount ?? 0) > 0) {
                    onMarkAsRead?.(conversation.id);
                  } else {
                    onMarkAsUnread?.(conversation.id);
                  }
                }}
                className="relative inline-flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100 hover:text-blue-700 dark:bg-blue-500/10 dark:text-blue-400 dark:hover:bg-blue-500/20 transition-colors"
                aria-label={
                  (conversation.unreadCount ?? 0) > 0
                    ? "Marcar como leído"
                    : "Marcar como no leído"
                }
              >
                <Mail className="h-4 w-4" />
                {(conversation.unreadCount ?? 0) > 0 && (
                  <span className="absolute top-0 right-0 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground ring-2 ring-card">
                    {conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}
                  </span>
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {(conversation.unreadCount ?? 0) > 0
                ? `Marcar como leído (${conversation.unreadCount} sin leer)`
                : "Marcar como no leído"}
            </TooltipContent>
          </Tooltip>

          {/* Task Button — opens the dialog in create mode. When the
              dialog is closed (either by the X button or by clicking
              outside) we clear `editingTaskId` so the next open lands
              back in create mode. */}
          <Dialog
            open={isTaskDialogOpen}
            onOpenChange={(open) => {
              setIsTaskDialogOpen(open);
              if (open) {
                // User-triggered open = create mode (edit mode opens via
                // openTaskEditor, which sets the assignee itself and doesn't
                // route through here). Default the assignee to the agent's
                // real GHL id so the field isn't empty / invalid.
                if (!editingTaskId) setNewTaskAssignee(myGhlUserId ?? "");
              } else {
                setEditingTaskId(null);
                setNewTaskTitle("");
                setNewTaskDueDate("Hoy");
                setCustomDueDateTime("");
                setNewTaskAssignee(myGhlUserId ?? "");
              }
            }}
          >
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full bg-purple-50 text-purple-600 hover:bg-purple-100 hover:text-purple-700 dark:bg-purple-500/10 dark:text-purple-400 dark:hover:bg-purple-500/20">
                <CheckCircle2 className="h-4 w-4" />
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px] rounded-2xl">
              <DialogHeader>
                <DialogTitle className="text-xl font-bold">
                  {editingTaskId ? "Editar Tarea" : "Nueva Tarea"}
                </DialogTitle>
              </DialogHeader>
              <div className="grid gap-5 py-2">
                {/* Plantilla — full-width Select-styled trigger as its own
                    field, matching the new mockup. The Popover body still
                    drives the preset list (clicking a preset fills the
                    description input below). */}
                <div className="grid gap-2">
                  <Label className="text-sm font-semibold">Plantilla de tarea</Label>
                  <Popover open={templatePopoverOpen} onOpenChange={setTemplatePopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full h-10 justify-between font-normal bg-muted"
                      >
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <List className="h-4 w-4" />
                          Seleccionar plantilla
                        </span>
                        <ChevronDown className="h-4 w-4 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      className="w-[var(--radix-popover-trigger-width)] p-2"
                    >
                      <div className="space-y-1">
                        {taskPresets.length === 0 ? (
                          <div className="p-2 text-xs text-muted-foreground text-center">No hay plantillas guardadas</div>
                        ) : (
                          taskPresets.map((preset, idx) => (
                            <div key={idx} className="flex items-center gap-1">
                              {editingPresetIndex === idx ? (
                                <div className="flex flex-1 items-center gap-1">
                                  <Input
                                    value={editingPresetValue}
                                    onChange={(e) => setEditingPresetValue(e.target.value)}
                                    className="h-7 text-xs"
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        if (editingPresetValue.trim() && editingPresetValue.trim() !== preset) {
                                          const newPresets = [...taskPresets];
                                          newPresets[idx] = editingPresetValue.trim();
                                          setTaskPresets(newPresets);
                                          toast({
                                            title: "Plantilla actualizada",
                                            description: "La plantilla se ha modificado correctamente.",
                                          });
                                        }
                                        setEditingPresetIndex(null);
                                      } else if (e.key === 'Escape') {
                                        setEditingPresetIndex(null);
                                      }
                                    }}
                                  />
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                                    onClick={() => {
                                      if (editingPresetValue.trim() && editingPresetValue.trim() !== preset) {
                                        const newPresets = [...taskPresets];
                                        newPresets[idx] = editingPresetValue.trim();
                                        setTaskPresets(newPresets);
                                        toast({
                                          title: "Plantilla actualizada",
                                          description: "La plantilla se ha modificado correctamente.",
                                        });
                                      }
                                      setEditingPresetIndex(null);
                                    }}
                                  >
                                    <Check className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-muted-foreground"
                                    onClick={() => setEditingPresetIndex(null)}
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              ) : (
                                <div
                                  className="flex flex-1 items-center justify-between px-2 py-1.5 text-sm rounded-md hover:bg-accent cursor-pointer group"
                                  onClick={() => {
                                    setNewTaskTitle(preset);
                                    // Close the dropdown after picking a template.
                                    setTemplatePopoverOpen(false);
                                  }}
                                >
                                  <span className="truncate pr-2">{preset}</span>
                                  <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setEditingPresetIndex(idx);
                                        setEditingPresetValue(preset);
                                      }}
                                    >
                                      <Edit2 className="h-3 w-3" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setTaskPresets(taskPresets.filter((_, i) => i !== idx));
                                      }}
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="title" className="text-sm font-semibold">Descripción de la tarea</Label>
                  <div className="flex gap-2">
                    <Input
                      id="title"
                      value={newTaskTitle}
                      onChange={(e) => setNewTaskTitle(e.target.value)}
                      placeholder="Ej. Llamar para seguimiento..."
                      className="flex-1 h-10"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-10 w-10 shrink-0"
                      title="Guardar como plantilla"
                      disabled={!newTaskTitle.trim() || taskPresets.includes(newTaskTitle.trim())}
                      onClick={() => {
                        if (newTaskTitle.trim() && !taskPresets.includes(newTaskTitle.trim())) {
                          setTaskPresets([...taskPresets, newTaskTitle.trim()]);
                          toast({
                            title: "Plantilla guardada",
                            description: "La descripción se ha guardado como plantilla.",
                          });
                        }
                      }}
                    >
                      <BookmarkPlus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label className="text-sm font-semibold">Vencimiento</Label>
                  <Select value={newTaskDueDate} onValueChange={setNewTaskDueDate}>
                    <SelectTrigger className="h-10">
                      <SelectValue placeholder="Selecciona una fecha" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Hoy">Hoy</SelectItem>
                      <SelectItem value="Mañana">Mañana</SelectItem>
                      <SelectItem value="Próxima semana">Próxima semana</SelectItem>
                      <SelectItem value="Personalizado">Personalizado</SelectItem>
                    </SelectContent>
                  </Select>
                  {newTaskDueDate === "Personalizado" && (
                    <Input
                      type="datetime-local"
                      value={customDueDateTime}
                      onChange={(e) => setCustomDueDateTime(e.target.value)}
                      className="mt-1"
                    />
                  )}
                </div>

                <div className="grid gap-2">
                  <Label className="text-sm font-semibold">Asignado a</Label>
                  {/* Full agent roster from the bootstrap payload. The value
                      is the GHL user id so the task is actually assigned to
                      that user (sent as `assignedTo`); "Yo" is the current
                      session user, the rest are the location's other agents. */}
                  <Select value={newTaskAssignee} onValueChange={setNewTaskAssignee}>
                    <SelectTrigger className="h-10">
                      <SelectValue placeholder="Selecciona un usuario" />
                    </SelectTrigger>
                    <SelectContent>
                      {myGhlUserId && (
                        <SelectItem value={myGhlUserId}>Yo ({currentUser.name})</SelectItem>
                      )}
                      {users
                        .filter((u) => u.id && u.id !== myGhlUserId)
                        .map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter className="sm:justify-center gap-3 pt-2">
                <Button
                  variant="outline"
                  className="rounded-full px-6"
                  onClick={() => setIsTaskDialogOpen(false)}
                >
                  Cancelar
                </Button>
                <Button
                  // Block "Crear" until both the title and (when relevant) the
                  // custom datetime are filled in. Without this guard, picking
                  // "Personalizado" without filling the date sends the literal
                  // word and falls back to "tomorrow" silently — surprising.
                  className="rounded-full px-6"
                  disabled={
                    !newTaskTitle.trim() ||
                    (newTaskDueDate === "Personalizado" && !customDueDateTime)
                  }
                  onClick={() => {
                    if (!newTaskTitle.trim()) return;
                    if (newTaskDueDate === "Personalizado" && !customDueDateTime) return;

                    // Resolve the dueDate the backend will see. ISO strings
                    // are parsed via `new Date()` in `parseDueDate`, the
                    // preset labels keep their existing meanings ("Hoy" →
                    // today 5pm, "Mañana" → 9am, etc.).
                    const dueDateOut =
                      newTaskDueDate === "Personalizado"
                        ? new Date(customDueDateTime).toISOString()
                        : newTaskDueDate;

                    // Resolve the concrete ISO due instant so the optimistic
                    // row is immediately filterable by date (mirrors the
                    // backend's parseDueDate). The server echo replaces it
                    // with GHL's authoritative dueAt shortly after.
                    const dueAtOut = (() => {
                      if (newTaskDueDate === "Personalizado") {
                        return new Date(customDueDateTime).toISOString();
                      }
                      const d = new Date();
                      if (newTaskDueDate === "Hoy") d.setHours(17, 0, 0, 0);
                      else if (newTaskDueDate === "Mañana") {
                        d.setDate(d.getDate() + 1);
                        d.setHours(9, 0, 0, 0);
                      } else if (newTaskDueDate.toLowerCase().includes("semana")) {
                        d.setDate(d.getDate() + 7);
                      } else {
                        d.setDate(d.getDate() + 1);
                      }
                      return d.toISOString();
                    })();

                    // Friendly label for the optimistic row's display. For a
                    // custom date, format it (Peru) instead of showing the raw
                    // ISO; presets already read well. The server echo replaces
                    // this with GHL's canonical label moments later.
                    const dueLabel =
                      newTaskDueDate === "Personalizado"
                        ? new Date(customDueDateTime).toLocaleString("es-ES", {
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: true,
                            timeZone: "America/Lima",
                          })
                        : newTaskDueDate;

                    // Edit mode: patch the existing task via onUpdateTask
                    // and bail out before the optimistic-create branch.
                    if (editingTaskId && onUpdateTask) {
                      onUpdateTask(editingTaskId, {
                        title: newTaskTitle,
                        dueDate: dueDateOut,
                      });
                      setIsTaskDialogOpen(false);
                      setEditingTaskId(null);
                      setNewTaskTitle("");
                      setNewTaskDueDate("Hoy");
                      setCustomDueDateTime("");
                      return;
                    }

                    setIsTaskDialogOpen(false);

                    // newTaskAssignee is a real GHL user id — resolve the agent
                    // from the roster so the task carries the right id (for GHL
                    // assignment) and name/avatar (for the UI label). When it's
                    // the logged-in agent, prefer their "Yo" display name.
                    const rosterUser = users.find((u) => u.id === newTaskAssignee);
                    const assigneeUser =
                      newTaskAssignee && newTaskAssignee === myGhlUserId
                        ? { id: myGhlUserId, name: currentUser.name, avatar: rosterUser?.avatar ?? currentUser.avatar }
                        : rosterUser;
                    onAddTask({
                      title: newTaskTitle,
                      dueDate: dueLabel,
                      dueAt: dueAtOut,
                      assignee: {
                        id: assigneeUser?.id,
                        name: assigneeUser?.name ?? currentUser.name,
                        avatar: assigneeUser?.avatar,
                      },
                      contact: { name: conversation.participant.name, avatar: conversation.participant.avatar },
                      status: "pending",
                      conversationId: conversation.id,
                    });

                    setNewTaskTitle("");
                    setNewTaskDueDate("Hoy");
                    setCustomDueDateTime("");
                  }}
                >
                  {editingTaskId ? "Guardar Cambios" : "Crear Tarea"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Reminder: quick presets + clear. Shows a dot indicator when a
              reminder is active. We don't wrap this in a Radix Tooltip because
              the trigger is itself a DropdownMenu (a context provider, not a
              forwardRef component) — stacking TooltipTrigger asChild on top of
              DropdownMenuTrigger asChild on the same node fails the ref
              forwarding chain. The native `title` attribute on the Button is
              good enough for the hover hint here. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="relative hidden lg:inline-flex h-9 w-9 rounded-full bg-yellow-50 text-yellow-600 hover:bg-yellow-100 hover:text-yellow-700 dark:bg-yellow-500/10 dark:text-yellow-400 dark:hover:bg-yellow-500/20"
                title={
                  conversation.activeReminder
                    ? `Recordatorio: ${conversation.activeReminder}`
                    : "Establecer recordatorio"
                }
              >
                <Bell className="h-4 w-4" />
                {conversation.activeReminder && (
                  <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-yellow-500 ring-2 ring-card" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {conversation.activeReminder && (
                <>
                  <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
                    Activo: <span className="font-medium text-foreground">{conversation.activeReminder}</span>
                  </div>
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => {
                      setActiveReminder(null);
                      onClearReminder?.(conversation.id);
                    }}
                  >
                    Quitar recordatorio
                  </DropdownMenuItem>
                  <div className="h-px bg-muted my-1 mx-1" />
                </>
              )}
              {["10 Min", "20 Min", "30 Min", "60 Min", "Personalizado"].map((time) => (
                <DropdownMenuItem
                  key={time}
                  onClick={() => {
                    setActiveReminder(time);
                    onSetReminder?.(conversation.id, time);
                  }}
                >
                  {time}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="icon"
            className="hidden lg:inline-flex h-9 w-9 rounded-full bg-rose-50 text-rose-600 hover:bg-rose-100 hover:text-rose-700 dark:bg-rose-500/10 dark:text-rose-400 dark:hover:bg-rose-500/20"
            onClick={() => setIsDeleteDialogOpen(true)}
            title="Eliminar lead"
          >
            <Trash2 className="h-4 w-4" />
          </Button>

          {onToggleContactSidebar && (
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-9 w-9 shrink-0 rounded-full ml-1", isContactSidebarOpen ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted")}
              onClick={onToggleContactSidebar}
              title="Alternar panel de contacto"
            >
              <PanelRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Tasks Banner */}
      {tasks.filter(t => t.conversationId === conversation.id && t.status === "pending").map(task => (
        <div key={task.id} className="flex items-center justify-between bg-purple-50/80 px-4 py-2 text-sm text-purple-800 dark:bg-purple-500/10 dark:text-purple-200 border-b border-purple-100 dark:border-purple-500/20">
          <div className="flex items-center gap-2 font-medium">
            <button onClick={() => onToggleTask(task.id)} className="text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-300">
              <Circle className="h-4 w-4" />
            </button>
            <span>{task.title}</span>
            <div className="flex items-center gap-1.5 ml-2">
              <Badge variant="outline" className="text-[10px] h-5 px-1.5 font-medium border-purple-200 dark:border-purple-500/30 bg-white/50 dark:bg-black/20 flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {task.dueDate}
              </Badge>
              <Badge variant="outline" className="text-[10px] h-5 px-1.5 font-medium border-purple-200 dark:border-purple-500/30 bg-white/50 dark:bg-black/20 flex items-center gap-1">
                <UserIcon className="h-3 w-3" />
                {task.assignee.name}
              </Badge>
            </div>
          </div>
          {onUpdateTask && (
            <Button
              variant="ghost"
              size="icon"
              title="Editar tarea"
              className="h-7 w-7 rounded-md border border-purple-200 text-purple-700 hover:bg-purple-100 hover:text-purple-900 dark:border-purple-500/40 dark:text-purple-200 dark:hover:bg-purple-500/20"
              onClick={() => openTaskEditor(task)}
            >
              <Edit2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      ))}

      {/* Reminder Banner */}
      {activeReminder && (
        <div className="flex items-center justify-between bg-yellow-100/80 px-4 py-2 text-sm text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-200 border-b border-yellow-200 dark:border-yellow-500/30">
          <div className="flex items-center gap-2 font-medium">
            <Bell className="h-4 w-4" />
            <span>Recordatorio configurado para: {activeReminder}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {/* Edit pencil opens the same time picker the bell-icon in
                the header uses. Selecting a value calls onSetReminder
                which patches the backend; "Personalizado" is treated
                as a label today (no datetime input here — matches the
                header dropdown's behaviour). */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Editar recordatorio"
                  className="h-7 w-7 rounded-md border border-yellow-300 text-yellow-800 hover:bg-yellow-200 dark:border-yellow-500/40 dark:text-yellow-200 dark:hover:bg-yellow-500/30"
                >
                  <Edit2 className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
                  Activo: <span className="font-medium text-foreground">{activeReminder}</span>
                </div>
                <div className="h-px bg-muted my-1 mx-1" />
                {["10 Min", "20 Min", "30 Min", "60 Min", "Personalizado"].map((time) => (
                  <DropdownMenuItem
                    key={time}
                    onClick={() => {
                      setActiveReminder(time);
                      onSetReminder?.(conversation.id, time);
                    }}
                  >
                    {time}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="icon"
              title="Quitar recordatorio"
              className="h-6 w-6 rounded-full hover:bg-yellow-200 dark:hover:bg-yellow-500/30 text-yellow-800 dark:text-yellow-200"
              onClick={() => {
                setActiveReminder(null);
                onClearReminder?.(conversation.id);
              }}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}

      {/* Scheduled Messages Banner — one row per pending schedule.
          Shows the message body (or template body) plus a relative
          "Mañana a las 9:00 AM" badge so the agent can read it at a
          glance, with an X to cancel. Matches image 8 of the spec. */}
      {conversation.scheduledMessages?.map(msg => (
        <div key={msg.id} className="flex items-center justify-between bg-emerald-50/80 px-4 py-2 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200 border-b border-emerald-200 dark:border-emerald-500/30">
          <div className="flex items-center gap-2 font-medium overflow-hidden">
            <Clock className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span className="truncate max-w-[200px] sm:max-w-[400px] text-xs font-normal opacity-80">
              {msg.templateName ? `Plantilla: ${msg.templateName}` : `"${msg.text}"`}
            </span>
            <Badge variant="outline" className="text-[10px] h-5 px-1.5 font-medium border-emerald-200 dark:border-emerald-500/30 bg-white/50 dark:bg-black/20 shrink-0">
              {formatScheduleLabel(msg.scheduledFor)}
            </Badge>
          </div>
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-6 w-6 rounded-full hover:bg-emerald-200 dark:hover:bg-emerald-500/30 text-emerald-800 dark:text-emerald-200 shrink-0"
            onClick={() => onCancelScheduledMessage?.(conversation.id, msg.id)}
            title="Cancelar envío"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ))}

      {/* Pinned message banners ("cintillos superiores"). One row per
          pinned snapshot. Clicking a banner smoothly scrolls the chat
          to the original message and briefly flashes it; the X button
          unpins just that entry. */}
      {(conversation.pinnedMessages ?? []).map((pin) => (
        <div
          key={pin.id}
          className="flex items-center gap-3 border-b border-amber-200/70 bg-amber-50/80 px-4 py-2 text-sm dark:border-amber-500/30 dark:bg-amber-500/10"
        >
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-3 text-left transition-colors hover:bg-amber-100/40 dark:hover:bg-amber-500/10 rounded-md px-1 -mx-1 py-0.5 -my-0.5"
            onClick={() => scrollToPinnedMessage(pin.id)}
            title="Ir al mensaje"
          >
            <Pin className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-300">
                <span>Mensaje fijado</span>
                {pin.senderName && (
                  <>
                    <span className="opacity-50">·</span>
                    <span className="font-normal normal-case opacity-80">{pin.senderName}</span>
                  </>
                )}
                {pin.channel === "internal" && (
                  <Badge variant="outline" className="ml-1 h-4 border-amber-300/60 bg-amber-100/60 px-1 text-[9px] font-medium text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                    interno
                  </Badge>
                )}
              </div>
              <div className="truncate text-[13px] text-amber-900 dark:text-amber-100">
                {pin.text || "(sin contenido)"}
              </div>
            </div>
          </button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 rounded-full text-amber-800 hover:bg-amber-200/70 dark:text-amber-200 dark:hover:bg-amber-500/20"
            onClick={() => onUnpinMessage?.(conversation.id, pin.id)}
            title="Desfijar mensaje"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}

      {/* WhatsApp template dialog. Always mounted at the panel
          level (not inside the composer Popover) so the
          "Reabrir chat" button can open it even when the composer
          is replaced by the 24h-expired lock placeholder. */}
      <ScheduleMessageDialog
        open={isTemplateDialogOpen}
        onOpenChange={setIsTemplateDialogOpen}
        conversation={conversation}
        channel={activeChannel === "internal" ? "whatsapp" : activeChannel}
        onSubmit={async (payload) => {
          onScheduleMessage?.(
            conversation.id,
            payload.text,
            payload.scheduledFor,
            payload.channel,
            payload.templateId
              ? {
                  id: payload.templateId,
                  name: payload.templateName,
                  language: payload.templateLanguage,
                }
              : undefined
          );
        }}
        onSendNow={
          onSendTemplateNow
            ? async (payload) => {
                // Agent is sending a template — scroll to it once it lands.
                forceScrollOnSendRef.current = true;
                await onSendTemplateNow(
                  conversation.id,
                  payload.text,
                  payload.channel,
                  {
                    id: payload.templateId,
                    name: payload.templateName,
                    language: payload.templateLanguage,
                    buttons: payload.buttons,
                    attachment: payload.attachment,
                    templateMedia: payload.templateMedia,
                  }
                );
              }
            : undefined
        }
      />

      {/* WhatsApp 24h-window expired banner. Sticky at the top of the
          chat so the agent can't miss it. The "Reabrir chat" button
          opens the same WhatsApp template dialog used for normal
          scheduling — sending an approved template is the only Meta-
          sanctioned way to re-open a conversation past 24h. */}
      {isWhatsApp24hWindowExpired && (
        <div className="flex items-center justify-between gap-3 border-b border-amber-200/70 bg-amber-50/80 px-4 py-2.5 dark:border-amber-500/30 dark:bg-amber-500/10">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-200/70 dark:bg-amber-500/20">
              <Clock className="h-3.5 w-3.5 text-amber-700 dark:text-amber-300" />
            </div>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-amber-900 dark:text-amber-100">
                Ventana de 24h expirada
              </div>
              <div className="text-[11px] text-amber-800/80 dark:text-amber-200/80">
                Usa una plantilla para contactar al cliente
              </div>
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            className="h-8 shrink-0 gap-1.5 rounded-full bg-emerald-100 text-emerald-700 hover:bg-emerald-200 border border-emerald-300/60 shadow-none dark:bg-emerald-500/20 dark:text-emerald-200 dark:border-emerald-500/30"
            onClick={() => {
              // Force the WhatsApp channel before opening so the
              // template dialog filters templates correctly even if
              // the agent had switched to Internal / SMS / Email
              // tabs (the dialog reads `channel` from props at open
              // time and templates are scoped per channel).
              setActiveChannel("whatsapp");
              setIsTemplateDialogOpen(true);
            }}
          >
            <MessageCircle className="h-3.5 w-3.5" />
            Reabrir chat
          </Button>
        </div>
      )}

      {/* Messages Area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4"
        onScroll={(e) => {
          const t = e.currentTarget;
          // Stop auto-pinning to the bottom once the agent scrolls up to read
          // history; resume when they return near the bottom. (Programmatic
          // bottom-scrolls leave us near the bottom, so they keep pinning on.)
          const distanceFromBottom = t.scrollHeight - t.scrollTop - t.clientHeight;
          pinBottomRef.current = distanceFromBottom < 80;
          if (!hasOlderMessages || isLoadingOlderMessages || !onLoadOlderMessages || requestedOlderRef.current) return;
          if (t.scrollTop < 100) {
            requestedOlderRef.current = true;
            scrollHeightBeforeRef.current = t.scrollHeight;
            scrollTopBeforeRef.current = t.scrollTop;
            onLoadOlderMessages();
          }
        }}
      >
        {isLoadingHistory && (
          // Skeleton chat bubbles while the message history hydrates (shown for
          // every lead, even ones that already have a few WS messages — the
          // partial thread is hidden below until the full history arrives). Each
          // bubble mimics a real message: shimmer text lines + a timestamp,
          // tinted like inbound (left) / outbound (right) messages.
          <div className="space-y-2 py-2">
            {[
              { me: false, lines: ["w-40", "w-52"] },
              { me: true, lines: ["w-56", "w-28"] },
              { me: false, lines: ["w-44"] },
              { me: true, lines: ["w-60", "w-48", "w-24"] },
              { me: false, lines: ["w-36", "w-52"] },
              { me: true, lines: ["w-44"] },
            ].map((b, i) => (
              <div
                key={i}
                className={cn(
                  "flex items-end gap-2",
                  b.me ? "justify-end" : "justify-start"
                )}
              >
                {!b.me && (
                  <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                )}
                <div
                  className={cn(
                    "max-w-[70%] rounded-2xl px-3.5 py-2.5",
                    b.me
                      ? "bg-primary/10 rounded-br-md"
                      : "bg-muted rounded-bl-md"
                  )}
                >
                  <div className="space-y-2">
                    {b.lines.map((w, j) => (
                      <Skeleton
                        key={j}
                        className={cn("h-3 rounded bg-foreground/10", w)}
                      />
                    ))}
                  </div>
                  <div className="mt-2 flex justify-end">
                    <Skeleton className="h-2 w-8 rounded bg-foreground/10" />
                  </div>
                </div>
                {b.me && (
                  <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                )}
              </div>
            ))}
          </div>
        )}
        {isLoadingOlderMessages && (
          // Skeleton bubbles prepended while older history loads on scroll-up.
          <div className="space-y-2 py-2">
            {[
              { me: false, lines: ["w-44"] },
              { me: true, lines: ["w-56", "w-24"] },
              { me: false, lines: ["w-36", "w-48"] },
            ].map((b, i) => (
              <div
                key={i}
                className={cn(
                  "flex items-end gap-2",
                  b.me ? "justify-end" : "justify-start"
                )}
              >
                {!b.me && (
                  <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                )}
                <div
                  className={cn(
                    "max-w-[70%] rounded-2xl px-3.5 py-2.5",
                    b.me
                      ? "bg-primary/10 rounded-br-md"
                      : "bg-muted rounded-bl-md"
                  )}
                >
                  <div className="space-y-2">
                    {b.lines.map((w, j) => (
                      <Skeleton
                        key={j}
                        className={cn("h-3 rounded bg-foreground/10", w)}
                      />
                    ))}
                  </div>
                </div>
                {b.me && (
                  <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                )}
              </div>
            ))}
          </div>
        )}
        {!isLoadingHistory && !hasOlderMessages && conversation.messages.length > 0 && (
          <div className="flex justify-center py-2 text-[11px] text-muted-foreground/40">
            Inicio del historial
          </div>
        )}
        {/* Hidden while history loads so only the skeleton shows (the partial
            thread reappears once the full history arrives). */}
        <div ref={contentRef} className={cn("flex flex-col gap-0.5 py-4", isLoadingHistory && "hidden")}>
          {visibleMessages.length === 0 && conversation.messages.length > 0 && (
            <div className="flex justify-center py-6 text-xs text-muted-foreground/70">
              Ningún mensaje coincide con los filtros seleccionados
            </div>
          )}
          {visibleMessages.map((message, index) => {
            // Day-change separator: emit a "Hoy" / "Ayer" / "DD Mmm YYYY"
            // pill before any message whose day differs from the previous
            // one's. Messages without a resolvable date get no separator
            // (they collapse into whatever group the surrounding messages
            // form).
            const prevMessage = visibleMessages[index - 1];
            const prevDay = dayKey(prevMessage?.date);
            const curDay = dayKey(message.date);
            const dateSeparator =
              curDay && curDay !== prevDay ? (
                <div key={`day-${curDay}-${message.id}`} className="flex w-full items-center gap-3 my-3">
                  <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700/60" />
                  <span className="px-3 py-1 text-[11px] font-medium text-slate-500 dark:text-slate-400 bg-slate-100/80 dark:bg-slate-800/60 rounded-full select-none">
                    {formatDateLabel(message.date)}
                  </span>
                  <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700/60" />
                </div>
              ) : null;

            // GHL emits this literal body when the inbound WhatsApp message
            // type (sticker, location, contact card, ephemeral, etc.) is not
            // processable by GHL. Render it as a subtle system notice so it
            // doesn't look like a broken chat bubble.
            if (
              !message.attachment &&
              typeof message.text === "string" &&
              /message type (is currently |)not supported/i.test(message.text)
            ) {
              return (
                <React.Fragment key={message.id}>
                  {dateSeparator}
                  <div className="flex justify-center w-full my-1">
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground/50 italic px-3 py-1 bg-muted/30 rounded-full border border-muted/50 select-none">
                      <AlertCircle className="h-3 w-3 shrink-0" />
                      Tipo de mensaje no compatible
                    </span>
                  </div>
                </React.Fragment>
              );
            }

            if (message.systemEvent && message.systemEvent.type === "opportunity_moved") {
              const ev = message.systemEvent;
              // Funnel-to-funnel transfers are rendered with the
              // pipeline shown alongside the stage on each side, so the
              // reader can see *both* the embudo change and the etapa
              // change in one line.
              const isFunnelMove = Boolean(ev.previousPipeline);
              return (
                <React.Fragment key={message.id}>
                  {dateSeparator}
                  <div className="flex items-center justify-center gap-3 my-8">
                    <div className="flex-1 h-px bg-border/40" />
                    <div className="flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-muted/60 border border-border/30 select-none whitespace-nowrap">
                      <ArrowRight className="h-[11px] w-[11px] text-muted-foreground/60 shrink-0" />
                      <span className="text-[11px] text-muted-foreground/70 font-medium">{ev.opportunityName}</span>
                      <span className="text-[11px] text-muted-foreground/50">movido</span>
                      <span className="text-[11px] text-muted-foreground/60 font-medium line-through decoration-muted-foreground/30">
                        {isFunnelMove ? `${ev.previousPipeline} / ${ev.oldStage}` : ev.oldStage}
                      </span>
                      <span className="text-[11px] text-muted-foreground/50">→</span>
                      <span className="text-[11px] text-foreground/70 font-semibold">
                        {isFunnelMove ? `${ev.pipeline} / ${ev.newStage}` : ev.newStage}
                      </span>
                      {ev.user && (
                        <>
                          <span className="text-[11px] text-muted-foreground/40 mx-0.5">·</span>
                          <span className="text-[11px] text-muted-foreground/50">{ev.user}</span>
                        </>
                      )}
                      <span className="text-[11px] text-muted-foreground/40 mx-0.5">·</span>
                      <span className="text-[11px] text-muted-foreground/50">{message.timestamp}</span>
                    </div>
                    <div className="flex-1 h-px bg-border/40" />
                  </div>
                </React.Fragment>
              );
            }

            if (message.systemEvent && message.systemEvent.type === "conversation_taken") {
              // Three readable variations depending on what GHL gave us:
              //   - prev empty + new set        → "Asignado a X"
              //   - prev set   + new empty      → "Sin asignar (antes X)"
              //   - prev set   + new set        → "Asignación: X → Y"
              const ev = message.systemEvent;
              const prev = ev.previousAssignedToName;
              const now = ev.assignedToName;
              return (
                <React.Fragment key={message.id}>
                  {dateSeparator}
                  <div className="flex w-full items-center gap-3 my-2">
                    <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700/60" />
                    <div className="inline-flex flex-wrap items-center justify-center gap-1.5 rounded-full bg-slate-100/80 dark:bg-slate-800/60 px-3 py-1.5 text-[11px] text-slate-500 dark:text-slate-400 shadow-sm">
                      <UserIcon className="h-3 w-3 text-slate-400 dark:text-slate-500" />
                      {!prev && now && (
                        <>
                          <span>Asignado a</span>
                          <span className="font-semibold text-slate-700 dark:text-slate-200">{now}</span>
                        </>
                      )}
                      {prev && !now && (
                        <>
                          <span>Sin asignar</span>
                          <span className="opacity-60">(antes</span>
                          <span className="line-through opacity-70">{prev}</span>
                          <span className="opacity-60">)</span>
                        </>
                      )}
                      {prev && now && (
                        <>
                          <span>Asignación:</span>
                          <span className="line-through opacity-70">{prev}</span>
                          <ArrowRight className="h-3 w-3 text-slate-400 dark:text-slate-500" />
                          <span className="font-semibold text-slate-700 dark:text-slate-200">{now}</span>
                        </>
                      )}
                      {ev.user && (
                        <>
                          <span className="opacity-40">·</span>
                          <span>{ev.user}</span>
                        </>
                      )}
                      <span className="opacity-40">·</span>
                      <span>{message.timestamp}</span>
                    </div>
                    <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700/60" />
                  </div>
                </React.Fragment>
              );
            }

            if (message.systemEvent && message.systemEvent.type === "opportunity_activity") {
              const ev = message.systemEvent;
              const actionLabel =
                ev.action === "created"
                  ? "creada"
                  : ev.action === "deleted"
                    ? "eliminada"
                    : "actualizada";
              // Render GHL's historical opportunity activity (incl. the
              // opportunities transferred/imported from GHL) in the same
              // rich move-event style: arrow + bold name + funnel stage.
              // PREFER the stage GHL recorded ON THIS event (`stageName`) so the
              // thread preserves the history/evolution of stage changes. Only
              // fall back to the conversation's current stage for older events
              // that didn't carry one (so a funnel still shows).
              const activityStageId = ev.stageId || conversation.stage;
              const stageLabel =
                ev.stageName ??
                (activityStageId
                  ? stages.find((s) => s.id === activityStageId)?.label ?? activityStageId
                  : null);
              const name = ev.opportunityName || conversation.participant.name;
              return (
                <React.Fragment key={message.id}>
                  {dateSeparator}
                  <div className="flex items-center justify-center gap-3 my-8">
                    <div className="flex-1 h-px bg-border/40" />
                    <div className="flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-muted/60 border border-border/30 select-none whitespace-nowrap">
                      <ArrowRight className="h-[11px] w-[11px] text-muted-foreground/60 shrink-0" />
                      <span className="text-[11px] text-muted-foreground/70 font-medium">{name}</span>
                      <span className="text-[11px] text-muted-foreground/50">{actionLabel}</span>
                      {stageLabel && ev.action !== "deleted" && (
                        <>
                          <span className="text-[11px] text-muted-foreground/50">en</span>
                          <span className="text-[11px] text-foreground/70 font-semibold">{stageLabel}</span>
                        </>
                      )}
                      {ev.user && (
                        <>
                          <span className="text-[11px] text-muted-foreground/40 mx-0.5">·</span>
                          <span className="text-[11px] text-muted-foreground/50">{ev.user}</span>
                        </>
                      )}
                      <span className="text-[11px] text-muted-foreground/40 mx-0.5">·</span>
                      <span className="text-[11px] text-muted-foreground/50">{message.timestamp}</span>
                    </div>
                    <div className="flex-1 h-px bg-border/40" />
                  </div>
                </React.Fragment>
              );
            }

            const isMe = message.senderId === currentUser.id;
            // WhatsApp-style inline meta: for plain text bubbles, tuck the time
            // + options onto the LAST text line (absolute, bottom-right) instead
            // of giving them their own row — saves a full line of height per
            // message. Internal notes (extra footer) and attachment-only bubbles
            // keep the normal stacked layout to avoid overlap.
            const inlineMeta = Boolean(message.text) && message.channel !== "internal";
            // Consecutive grouping considers the resolved agent identity too,
            // so two back-to-back outbound messages from different agents
            // each get their own avatar header instead of being collapsed.
            // Treat a day-change separator as a soft reset so the first
            // message of a new day gets its own avatar header.
            const isConsecutive =
              prevMessage &&
              !dateSeparator &&
              prevMessage.senderId === message.senderId &&
              prevMessage.senderName === message.senderName &&
              !prevMessage.systemEvent;
            // Prefer the per-message agent info (populated server-side from
            // GHL's userId on each outbound message). Fall back to the
            // logged-in currentUser when the backend hasn't resolved it yet
            // or the message was just sent from this session.
            // Outbound bubbles show the contact's assigned user (Owner),
            // regardless of who actually sent each message. AI bot messages keep
            // the dedicated bot avatar. When there's no owner, fall back to the
            // resolved sender, then the current user. Empty photo → initials.
            const outboundName = message.aiBot
              ? "Asistente IA"
              : ownerUser?.name ?? message.senderName ?? currentUser.name;
            const outboundAvatar = message.aiBot
              ? undefined
              : ownerUser
                ? ownerUser.avatar
                : message.senderAvatar ?? currentUser.avatar;
            const outboundInitials = nameInitials(outboundName);

            return (
              <React.Fragment key={message.id}>
                {dateSeparator}
                <div
                  data-message-id={message.id}
                  className={cn(
                    "flex w-full items-end gap-2 group scroll-mt-24",
                    isMe ? "justify-end" : "justify-start",
                    // Tight vertical spacing: same-sender runs sit nearly flush;
                    // a sender change gets a touch more breathing room.
                    isConsecutive ? "mt-0" : "mt-1.5"
                  )}
                >
                {!isMe && (
                  <div className={cn(isConsecutive ? "invisible" : "visible", "shrink-0")}>
                    {/* ChannelAvatar already renders a hover tooltip with the name. */}
                    <ChannelAvatar
                      name={conversation.participant.name}
                      src={conversation.participant.avatar}
                      className="h-8 w-8"
                    />
                  </div>
                )}

                <div
                  className={cn(
                    "relative flex max-w-[75%] flex-col gap-1 sm:max-w-[65%]",
                    isMe ? "items-end" : "items-start"
                  )}
                >
                  <div
                    className={cn(
                      "relative shadow-sm transition-all animate-in fade-in slide-in-from-bottom-2",
                      message.channel === "internal"
                        ? "bg-[#FFF4CC] text-[#78350F] dark:bg-amber-900/40 dark:text-amber-200 rounded-[18px] px-3.5 py-1.5 text-[15px] font-medium inline-block"
                        : isMe
                        ? "bg-primary text-primary-foreground rounded-[18px] px-3.5 py-1.5 text-[15px]"
                        : "bg-muted text-foreground rounded-[18px] px-3.5 py-1.5 text-[15px]",
                      !message.text && message.attachment && (message.attachment.type === "image" || message.attachment.type === "video") ? "bg-transparent p-0 shadow-none" : ""
                    )}
                  >
                    {/* Quoted message ("Responder") — shown at the top of
                        the bubble, WhatsApp-style. Colors adapt to the
                        outbound (colored) vs inbound (muted) bubble. */}
                    {message.replyTo && (
                      <div
                        className={cn(
                          "mb-1.5 rounded-md border-l-2 px-2 py-1 text-[12px]",
                          isMe
                            ? "border-primary-foreground/60 bg-primary-foreground/10"
                            : "border-primary/60 bg-foreground/5"
                        )}
                      >
                        <div className={cn("font-semibold truncate", isMe ? "text-primary-foreground/90" : "text-foreground/80")}>
                          {message.replyTo.sender}
                        </div>
                        <div className={cn("line-clamp-2", isMe ? "text-primary-foreground/70" : "text-muted-foreground")}>
                          {message.replyTo.text}
                        </div>
                      </div>
                    )}
                    {message.attachment && (
                      <div className={cn("mb-1 overflow-hidden rounded-lg", message.text ? "mt-1" : "")}>
                        {message.attachment.type === "image" ? (
                          <ImageLightbox
                            src={message.attachment.url}
                            alt={message.attachment.name}
                            className="block w-full"
                          >
                            <img
                              src={message.attachment.url}
                              alt={message.attachment.name}
                              className="w-full max-h-[300px] rounded-lg object-cover transition-transform group-hover:scale-[1.02]"
                            />
                          </ImageLightbox>
                        ) : (message.attachment.type === "video") ? (
                          <VideoThumbnail
                            src={message.attachment.url}
                            name={message.attachment.name}
                          />
                        ) : (message.attachment.type === "audio") ? (
                          <AudioPlayer
                            src={proxyMediaUrl(message.attachment.url)}
                            variant={isMe ? "light" : "dark"}
                            fallbackDuration={message.attachment.duration}
                          />
                        ) : (message.attachment.type === "file" || message.attachment.type === "document") &&
                          /\.pdf(\?|#|$)/i.test(message.attachment.name || message.attachment.url || "") ? (
                          // PDF preview: first page via the browser's viewer,
                          // click to open the full document. A footer shows the
                          // name + download.
                          <div
                            className={cn(
                              "overflow-hidden rounded-lg border",
                              isMe ? "border-primary-foreground/20" : "border-border"
                            )}
                          >
                            <button
                              type="button"
                              onClick={() =>
                                setViewerFile({
                                  url: proxyMediaUrl(message.attachment!.url),
                                  name: message.attachment!.name,
                                  rawUrl: message.attachment!.url,
                                })
                              }
                              aria-label={`Ver ${message.attachment.name}`}
                              className="relative block h-64 w-full bg-white"
                            >
                              <iframe
                                src={`${proxyMediaUrl(message.attachment.url)}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
                                title={message.attachment.name}
                                className="pointer-events-none h-full w-full border-0"
                              />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setViewerFile({
                                  url: proxyMediaUrl(message.attachment!.url),
                                  name: message.attachment!.name,
                                  rawUrl: message.attachment!.url,
                                })
                              }
                              className={cn(
                                "flex w-full items-center gap-2 p-2.5 text-sm transition-colors",
                                isMe
                                  ? "bg-primary-foreground/10 text-primary-foreground hover:bg-primary-foreground/20"
                                  : "bg-background text-foreground hover:bg-accent/60"
                              )}
                            >
                              <FileIcon className="h-4 w-4 shrink-0" />
                              <span className="truncate flex-1 text-left font-medium">{message.attachment.name}</span>
                              <Search className="h-4 w-4 shrink-0 opacity-70" />
                            </button>
                          </div>
                        ) : (message.attachment.type === "file" || message.attachment.type === "document") ? (
                          <button
                            type="button"
                            onClick={() =>
                              setViewerFile({
                                url: proxyMediaUrl(message.attachment!.url),
                                name: message.attachment!.name,
                                  rawUrl: message.attachment!.url,
                              })
                            }
                            aria-label={`Ver ${message.attachment.name}`}
                            className={cn(
                              "flex w-full items-center gap-2 rounded-lg border p-3 transition-colors",
                              isMe
                                ? "bg-primary-foreground/10 border-primary-foreground/20 text-primary-foreground hover:bg-primary-foreground/20"
                                : "bg-background border-border text-foreground hover:bg-accent/60"
                            )}
                          >
                            <FileIcon className="h-5 w-5 shrink-0" />
                            <div className="flex min-w-0 flex-1 flex-col overflow-hidden text-left">
                              <span className="truncate text-sm font-medium">{message.attachment.name}</span>
                              {message.attachment.size && (
                                <span className="text-[10px] opacity-70">{message.attachment.size}</span>
                              )}
                            </div>
                            <Search className="h-4 w-4 shrink-0 opacity-70" />
                          </button>
                        ) : message.attachment.type === "link" ? (
                          <a href={message.attachment.url} target="_blank" rel="noopener noreferrer" className={cn(
                            "flex flex-col overflow-hidden rounded-lg border bg-background text-foreground hover:bg-accent/80 transition-colors max-w-xs sm:max-w-sm",
                            isMe ? "border-primary-foreground/20 mt-1" : "border-border mt-1"
                          )}>
                            {message.attachment.image && (
                              <div className="h-32 w-full overflow-hidden bg-muted shrink-0">
                                <img src={message.attachment.image} alt={message.attachment.name} className="h-full w-full object-cover" />
                              </div>
                            )}
                            <div className="flex flex-col p-3 gap-1">
                              <span className="font-semibold text-sm line-clamp-1">{message.attachment.name}</span>
                              {message.attachment.description && (
                                <span className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{message.attachment.description}</span>
                              )}
                              <div className="flex items-center gap-1.5 mt-1 text-[10px] text-muted-foreground">
                                <LinkIcon className="h-3 w-3 shrink-0" />
                                <span className="truncate">{message.attachment.url}</span>
                              </div>
                            </div>
                          </a>
                        ) : null}
                      </div>
                    )}
                    {message.text && (
                      <span className="whitespace-pre-wrap leading-snug">
                        {message.channel === "internal" && message.mentions && message.mentions.length > 0
                          ? renderTextWithMentions(message.text, message.mentions)
                          : linkifyText(
                              substituteTemplateVars(
                                message.text,
                                conversation.participant?.name
                              ),
                              isMe
                            )}
                        {/* Reserve room on the last line for the inline time +
                            options so they don't overlap the final words. */}
                        {inlineMeta && (
                          <span
                            aria-hidden
                            className="inline-block w-[4.25rem] select-none"
                          />
                        )}
                      </span>
                    )}

                    {/* Open Graph preview card for the first URL in the text. */}
                    {message.text && firstHttpUrl(message.text) && (
                      <LinkPreview url={firstHttpUrl(message.text)!} />
                    )}

                    {bubbleHasNoVisibleContent(message) && (
                      <div className="flex items-center gap-3 min-w-[180px] py-1">
                        <Mic className="h-5 w-5 shrink-0 opacity-70" />
                        <span className="text-sm italic opacity-80">Mensaje de voz</span>
                      </div>
                    )}

                    {message.channel === "internal" && (message.mentions?.length || message.reminder) ? (
                      <div className="flex items-center gap-3 mt-2 pt-2 border-t border-amber-200/50 dark:border-amber-500/30 text-xs text-amber-700 dark:text-amber-400 font-medium">
                        {message.mentions && message.mentions.length > 0 && (
                          <div className="flex items-center gap-1">
                            <UserIcon className="h-3.5 w-3.5" />
                            <span>Asignado a @{message.mentions[0]}</span>
                          </div>
                        )}
                        {message.reminder && (
                          <div className="flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" />
                            <span>{message.reminder}</span>
                          </div>
                        )}
                      </div>
                    ) : null}

                    {/* Time + options inside the bubble (WhatsApp-style),
                        bottom-right — for both inbound and outbound. */}
                    <div
                      className={cn(
                        "flex items-center gap-1 select-none",
                        // Inline (WhatsApp-style) on text bubbles: pin to the
                        // bottom-right corner over the reserved space. Otherwise
                        // keep it on its own trailing row.
                        inlineMeta
                          ? "absolute bottom-1.5 right-3"
                          : "justify-end -mt-1",
                        // Internal notes sit on a yellow bubble, so the
                        // white "isMe" time would be invisible — use the
                        // bubble's dark amber instead.
                        message.channel === "internal"
                          ? "text-amber-800/70 dark:text-amber-200/70"
                          : isMe
                            ? "text-primary-foreground/70"
                            : "text-muted-foreground"
                      )}
                    >
                      <span className="text-[11px] leading-none">{message.timestamp}</span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className={cn(
                              "-mr-1 flex items-center justify-center rounded-md p-0.5 leading-none opacity-80 transition-colors hover:opacity-100 data-[state=open]:opacity-100",
                              message.channel === "internal"
                                ? "hover:bg-amber-900/10 data-[state=open]:bg-amber-900/10"
                                : isMe
                                  ? "hover:bg-white/25 data-[state=open]:bg-white/25"
                                  : "hover:bg-foreground/10 data-[state=open]:bg-foreground/10"
                            )}
                            title="Opciones del mensaje"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setReplyingToMessage(message)}>
                            <Reply className="h-4 w-4 mr-2" />
                            Responder
                          </DropdownMenuItem>
                          {message.attachment?.type === "audio" && message.attachment.url && (
                            <DropdownMenuItem
                              onClick={() =>
                                onForwardAudio?.(proxyMediaUrl(message.attachment!.url))
                              }
                            >
                              <ArrowRight className="h-4 w-4 mr-2" />
                              Reenviar a…
                            </DropdownMenuItem>
                          )}
                          {(conversation.pinnedMessages ?? []).some((p) => p.id === message.id) ? (
                            <DropdownMenuItem
                              onClick={() => onUnpinMessage?.(conversation.id, message.id)}
                            >
                              <PinOff className="h-4 w-4 mr-2" />
                              Desfijar
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onClick={() =>
                                onPinMessage?.(conversation.id, {
                                  id: message.id,
                                  text: message.text,
                                  date: message.date,
                                  senderName:
                                    message.senderName ??
                                    (message.senderId === currentUser.id
                                      ? currentUser.name
                                      : conversation.participant.name),
                                  channel: message.channel,
                                })
                              }
                            >
                              <Pin className="h-4 w-4 mr-2" />
                              Fijar
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            onClick={() =>
                              toast({
                                title: "Detalles del mensaje",
                                description: `${isMe ? "Enviado" : "Recibido"} a las ${message.timestamp}`,
                              })
                            }
                          >
                            <Info className="h-4 w-4 mr-2" />
                            Ver detalles
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                  {(() => {
                    const resolved = resolveButtonsForMessage(message);
                    if (!resolved || resolved.length === 0) return null;
                    return (
                    <div className="flex flex-col gap-2 w-full mt-2">
                      {resolved.map((btn) => {
                        const buttonClasses = "flex items-center justify-center gap-2 w-full py-2.5 px-4 text-primary text-[14px] font-medium hover:bg-primary/5 dark:hover:bg-primary/20 transition-colors rounded-full border border-primary/20 dark:border-primary/30 bg-background shadow-sm";
                        // URL / PHONE_NUMBER buttons turn the pill into an
                        // anchor so the agent can preview the destination
                        // (and click through to verify it). QUICK_REPLY
                        // stays a passive button — the recipient is the
                        // one who taps it on their phone.
                        if (btn.type === "URL" && btn.url) {
                          return (
                            <a
                              key={btn.id}
                              href={btn.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={buttonClasses}
                              title={btn.url}
                            >
                              <LinkIcon className="h-3.5 w-3.5 shrink-0 opacity-70" />
                              <span className="truncate">{btn.text}</span>
                            </a>
                          );
                        }
                        if (btn.type === "PHONE_NUMBER" && btn.phoneNumber) {
                          return (
                            <a
                              key={btn.id}
                              href={`tel:${btn.phoneNumber}`}
                              className={buttonClasses}
                              title={btn.phoneNumber}
                            >
                              <Phone className="h-3.5 w-3.5 shrink-0 opacity-70" />
                              <span className="truncate">{btn.text}</span>
                            </a>
                          );
                        }
                        return (
                          <button
                            key={btn.id}
                            type="button"
                            className={buttonClasses}
                          >
                            <span className="truncate">{btn.text}</span>
                          </button>
                        );
                      })}
                    </div>
                    );
                  })()}

                </div>

                {isMe && (
                  <div className={cn(isConsecutive ? "invisible" : "visible", "shrink-0")}>
                    <Tooltip delayDuration={200}>
                      <TooltipTrigger asChild>
                        {message.aiBot ? (
                          // Conversation AI bot — dedicated AI avatar instead
                          // of any human profile photo.
                          <AiBotAvatar className="h-8 w-8 cursor-default" />
                        ) : (
                          // Real sender photo when available; otherwise the
                          // sender's initials (first letters of first + last
                          // name) — never a generated avatar, never the viewer's.
                          <Avatar className="h-8 w-8 cursor-default">
                            <AvatarImage src={outboundAvatar} alt={outboundName} />
                            <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">
                              {outboundInitials}
                            </AvatarFallback>
                          </Avatar>
                        )}
                      </TooltipTrigger>
                      <TooltipContent side="left" className="text-xs font-medium">
                        {outboundName}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                )}
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Input Area (CRM Style) */}
      <div className="border-t bg-card flex flex-col">
        {/* Channel Tabs */}
        <div className="px-4 pt-2">
          <Tabs value={activeChannel} onValueChange={(v) => setActiveChannel(v as NonNullable<Message["channel"]>)}>
            <TabsList className={cn(TAB_LIST_CLASS)}>
              {availableChannels.map((ch) => (
                <TabsTrigger
                  key={ch}
                  value={ch}
                  className={cn(
                    TAB_TRIGGER_CLASS,
                    "text-xs h-6 px-4",
                    // Internal notes keep an amber active accent (a semantic
                    // "this is a private note" cue), overriding the canonical
                    // white/slate active pill.
                    ch === "internal" &&
                      "data-[state=active]:bg-amber-100 data-[state=active]:text-amber-800 dark:data-[state=active]:bg-amber-500/20 dark:data-[state=active]:text-amber-400"
                  )}
                >
                  {CHANNEL_LABELS[ch]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        <div className="p-4 pt-2 relative">
          {replyingToMessage && (
            <div className="mb-2 flex items-center justify-between bg-muted/30 px-3 py-2 rounded-lg border text-sm animate-in fade-in slide-in-from-bottom-2">
              <div className="flex flex-col overflow-hidden border-l-2 border-primary pl-2">
                <span className="text-xs font-semibold text-primary">
                  Respondiendo a {replyingToMessage.senderId === currentUser.id ? "ti mismo" : conversation.participant.name}
                </span>
                <span className="text-xs text-muted-foreground truncate">
                  {replyingToMessage.text || (replyingToMessage.attachment ? `Archivo ${replyingToMessage.attachment.type}` : "Mensaje")}
                </span>
              </div>
              <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted" onClick={() => setReplyingToMessage(null)}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}

          {selectedFiles.length > 0 && (
            <div className="relative mb-3 space-y-2">
              {/* Uploading overlay: while files transfer, dim the staged cards
                  and show a spinner so the agent sees the send is in progress
                  (and the cards can't be edited mid-upload). */}
              {isUploading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-lg bg-background/70 backdrop-blur-[1px]">
                  <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
                  <span className="text-xs font-medium text-foreground/80">
                    Enviando archivo{selectedFiles.length > 1 ? "s" : ""}…
                  </span>
                </div>
              )}
              {selectedFiles.length > 1 && (
                <div className="flex items-center justify-between px-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    {selectedFiles.length} archivos
                  </span>
                  <button
                    type="button"
                    onClick={handleRemoveFile}
                    className="text-xs text-muted-foreground hover:text-destructive"
                  >
                    Quitar todos
                  </button>
                </div>
              )}
              {/* Horizontal, scrollable row of compact file cards. */}
              <div className="flex gap-2 overflow-x-auto pb-1">
                {selectedFiles.map((file, idx) => {
                  // File format/extension — from the name, falling back to the
                  // MIME subtype — so it's always visible even when the name is
                  // truncated.
                  const ext = (
                    file.name.includes(".")
                      ? file.name.split(".").pop() || ""
                      : (file.type.split("/")[1] || "file")
                  ).toUpperCase();
                  const isVideo = file.type.startsWith("video/");
                  const isAudio = file.type.startsWith("audio/");
                  const isPdf =
                    file.type === "application/pdf" ||
                    file.name.toLowerCase().endsWith(".pdf");
                  return (
                  <div
                    key={`${file.name}-${idx}`}
                    className="relative w-28 shrink-0 rounded-xl border bg-background p-2 shadow-sm animate-in slide-in-from-bottom-2"
                  >
                    <button
                      type="button"
                      onClick={() => removeFileAt(idx)}
                      aria-label={`Quitar ${file.name}`}
                      className="absolute right-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-background/90 text-muted-foreground shadow ring-1 ring-border backdrop-blur-sm hover:bg-destructive hover:text-destructive-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                    <div
                      className={cn(
                        "relative flex h-16 w-full items-center justify-center overflow-hidden rounded-lg bg-muted",
                        !isAudio && "cursor-pointer"
                      )}
                      onClick={!isAudio ? () => openStagedViewer(idx) : undefined}
                      title={!isAudio ? "Ver archivo" : undefined}
                    >
                      {filePreviews[idx] && isVideo ? (
                        <>
                          {/* `#t=0.1` seeks to the first frame so the browser
                              shows a real preview instead of a black poster. */}
                          <video
                            src={`${filePreviews[idx]}#t=0.1`}
                            muted
                            playsInline
                            preload="metadata"
                            className="h-full w-full object-cover"
                          />
                          <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black/55">
                              <Play className="h-3 w-3 fill-white text-white" />
                            </span>
                          </span>
                        </>
                      ) : filePreviews[idx] && isPdf ? (
                        // First-page PDF preview via the browser's built-in
                        // viewer (chrome). pointer-events-none so the card's
                        // scroll / remove button still work; toolbar hidden.
                        <div className="pointer-events-none h-full w-full overflow-hidden bg-white">
                          <iframe
                            src={`${filePreviews[idx]}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
                            title={file.name}
                            className="h-[200%] w-[200%] origin-top-left scale-50 border-0"
                          />
                        </div>
                      ) : isAudio ? (
                        // Audio preview: tap to play/pause the staged note.
                        <button
                          type="button"
                          onClick={() => togglePreviewAudio(idx)}
                          aria-label={
                            playingAudioIdx === idx ? "Pausar audio" : "Reproducir audio"
                          }
                          className="flex h-full w-full flex-col items-center justify-center gap-1 bg-primary/10 text-primary transition-colors hover:bg-primary/15"
                        >
                          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                            {playingAudioIdx === idx ? (
                              <Pause className="h-4 w-4 fill-current" />
                            ) : (
                              <Play className="ml-0.5 h-4 w-4 fill-current" />
                            )}
                          </span>
                        </button>
                      ) : filePreviews[idx] ? (
                        <img
                          src={filePreviews[idx]!}
                          alt={file.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <FileIcon className="h-7 w-7 text-muted-foreground" />
                      )}
                      {/* Format badge on the thumbnail. */}
                      <span className="absolute bottom-1 left-1 rounded bg-black/65 px-1 text-[9px] font-bold uppercase leading-tight tracking-wide text-white">
                        {ext}
                      </span>
                    </div>
                    <div className="mt-1.5 truncate text-[11px] font-medium text-foreground" title={file.name}>
                      {file.name}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {ext} · {(file.size / 1024).toFixed(1)} KB
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>
          )}

          {templateAttachments.length > 0 && (
            <div className="mb-3 space-y-2">
              {templateAttachments.map((att, idx) => (
                <div
                  key={`${att.url}-${idx}`}
                  className="flex items-center gap-3 rounded-xl border bg-background p-2 pr-4 shadow-sm animate-in slide-in-from-bottom-2"
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                    {att.type === "image" ? (
                      <img src={proxyMediaUrl(att.url)} alt={att.name} className="h-full w-full object-cover" />
                    ) : att.type === "video" ? (
                      <Video className="h-6 w-6 text-muted-foreground" />
                    ) : (
                      <FileIcon className="h-6 w-6 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex flex-1 flex-col overflow-hidden">
                    <span className="truncate text-sm font-medium text-foreground">
                      {att.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Archivo de plantilla
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive shrink-0"
                    onClick={() =>
                      setTemplateAttachments((prev) => prev.filter((_, i) => i !== idx))
                    }
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {isMentionMenuOpen && (
            <div
              className="absolute bottom-full left-4 mb-2 w-[280px] max-w-[calc(100vw-2rem)] rounded-xl border bg-card shadow-xl z-50 animate-in slide-in-from-bottom-2 fade-in overflow-hidden"
              // Catch the mousedown so the textarea's blur doesn't close the
              // menu before the click handler on a row gets to fire.
              onMouseDown={(e) => e.preventDefault()}
            >
              <div className="px-3 py-2 border-b text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Asignar a un agente
              </div>
              {filteredMentionUsers.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                  {users.length === 0
                    ? "No hay agentes disponibles."
                    : "Ningún agente coincide."}
                </div>
              ) : (
                <ScrollArea className="max-h-[280px]">
                  <div className="py-1">
                    {filteredMentionUsers.map((u, idx) => {
                      const isActive = idx === mentionSelectedIdx;
                      const initials = u.name
                        .split(/\s+/)
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((p) => p[0]?.toUpperCase() ?? "")
                        .join("");
                      return (
                        <button
                          key={u.id}
                          type="button"
                          className={cn(
                            "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors",
                            isActive ? "bg-accent" : "hover:bg-accent/60"
                          )}
                          onMouseEnter={() => setMentionSelectedIdx(idx)}
                          onClick={() => insertMention(u)}
                        >
                          <Avatar className="h-7 w-7 shrink-0">
                            {u.avatar && <AvatarImage src={u.avatar} alt={u.name} />}
                            <AvatarFallback className="text-[11px] bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">
                              {initials || "?"}
                            </AvatarFallback>
                          </Avatar>
                          <span className="truncate font-medium text-foreground">
                            {u.name}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </div>
          )}

          {isTemplateMenuOpen && (
            <div className="absolute bottom-full left-4 mb-2 w-[520px] max-w-[calc(100vw-2rem)] rounded-2xl border bg-card shadow-xl z-50 animate-in slide-in-from-bottom-2 fade-in overflow-hidden">
              {/* Two-column layout: Categorías sidebar (left) +
                  templates list (right). Matches the spec mockup for
                  section 2.1. */}
              <div className="grid grid-cols-[150px_1fr] divide-x">
                {/* Categories sidebar */}
                <div className="bg-muted/30 py-3">
                  <div className="px-4 pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Categorías
                  </div>
                  <div className="flex flex-col gap-0.5 px-2">
                    {(() => {
                      // "Todas" + deduped category list derived from the
                      // template data — empty string is the "Todas"
                      // sentinel so the sidebar always has it first.
                      const cats = [
                        "",
                        ...Array.from(
                          new Set(
                            messageTemplates
                              .map((t) => t.category)
                              .filter((c): c is string => Boolean(c))
                          )
                        ).sort(),
                      ];
                      return cats.map((cat) => {
                        const isActive = templateCategory === cat;
                        return (
                          <button
                            key={cat || "__all__"}
                            type="button"
                            className={cn(
                              "w-full rounded-md px-3 py-2 text-left text-[13px] font-medium transition-colors",
                              isActive
                                ? "bg-violet-500 text-white shadow-sm"
                                : "text-slate-700 hover:bg-accent dark:text-slate-200"
                            )}
                            onClick={() => setTemplateCategory(cat)}
                          >
                            {cat || "Todas"}
                          </button>
                        );
                      });
                    })()}
                  </div>
                </div>
                {/* Templates list */}
                <div className="flex flex-col">
                  <div className="flex items-center justify-between px-4 pt-3 pb-1">
                    <span className="text-sm font-semibold">Plantillas rápidas</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      onClick={() => setIsTemplateMenuOpen(false)}
                      title="Cerrar"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="px-3 pb-2">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        placeholder="Buscar plantilla..."
                        className="h-9 pl-9 text-sm bg-muted/50 border-none rounded-full focus-visible:ring-1 focus-visible:ring-primary"
                        value={templateSearch}
                        onChange={(e) => setTemplateSearch(e.target.value)}
                        autoFocus
                        onKeyDown={(e) => e.stopPropagation()}
                      />
                    </div>
                  </div>
                  {(() => {
                    const q = templateSearch.toLowerCase();
                    const filtered = messageTemplates.filter((t) => {
                      if (templateCategory && t.category !== templateCategory) return false;
                      if (!q) return true;
                      return (
                        t.title.toLowerCase().includes(q) ||
                        t.text.toLowerCase().includes(q)
                      );
                    });
                    if (filtered.length === 0) {
                      return (
                        <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                          No se encontraron plantillas.
                        </div>
                      );
                    }
                    return (
                      <ScrollArea className="max-h-[320px]">
                        <div className="px-2 pb-3 space-y-0.5">
                          {filtered.map((template) => (
                            <button
                              key={template.id}
                              type="button"
                              className="w-full text-left rounded-md px-3 py-2 hover:bg-accent transition-colors"
                              onClick={() => insertTemplate(template.text, template.attachments)}
                            >
                              <div className="text-[14px] font-semibold text-foreground">
                                {template.title}
                              </div>
                              <div className="text-[12px] text-muted-foreground line-clamp-2 mt-0.5">
                                {template.text}
                              </div>
                            </button>
                          ))}
                        </div>
                      </ScrollArea>
                    );
                  })()}
                </div>
              </div>
            </div>
          )}
          
          {/* Block the WhatsApp composer when Meta's 24h window has
              elapsed. The agent must switch to a different channel or
              click "Reabrir chat" in the top banner to send an
              approved template. Channels other than WhatsApp stay
              fully functional so the agent can still leave internal
              notes or send via SMS / email. */}
          {isWhatsApp24hWindowExpired && activeChannel === "whatsapp" ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-5 text-[13px] text-muted-foreground dark:border-slate-700 dark:bg-slate-800/40">
              <Clock className="h-4 w-4 opacity-60" />
              <span>Conversación bloqueada temporalmente</span>
            </div>
          ) : (
          <form
            data-chat-form
            onSubmit={handleSend}
            className={cn(
              "flex flex-col rounded-xl border focus-within:ring-1 focus-within:ring-primary focus-within:border-primary transition-all shadow-sm overflow-hidden",
              activeChannel === "internal" ? "bg-amber-50/50 dark:bg-amber-500/5 border-amber-200/50 dark:border-amber-500/20" : "bg-muted/30 dark:bg-muted/10 border-border"
            )}
          >
            {activeChannel === "email" && (
              <div className="border-b border-slate-200 dark:border-slate-700 px-3 py-2 flex items-center gap-2 bg-slate-100/50 dark:bg-slate-800">
                <span className="text-xs text-muted-foreground font-medium">Asunto:</span>
                <input type="text" className="flex-1 bg-transparent border-none outline-none text-sm" placeholder="Escribe el asunto..." />
              </div>
            )}
            
            {isRecording ? (
              <div className="flex items-center justify-between min-h-[80px] px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="relative flex h-3 w-3">
                    {!isRecordingPaused && (
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                    )}
                    <span
                      className={cn(
                        "relative inline-flex rounded-full h-3 w-3",
                        isRecordingPaused ? "bg-amber-500" : "bg-red-500"
                      )}
                    />
                  </span>
                  <span
                    className={cn(
                      "text-sm font-medium tabular-nums",
                      isRecordingPaused
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-red-600 dark:text-red-400"
                    )}
                  >
                    {String(Math.floor(recordingDuration / 60)).padStart(2, "0")}:{String(recordingDuration % 60).padStart(2, "0")}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {isRecordingPaused ? "Grabación en pausa" : "Grabando nota de voz…"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-red-500"
                    title="Cancelar grabación"
                    onClick={cancelRecording}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                  {/* Pause / resume the take without finalizing it. */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    title={isRecordingPaused ? "Reanudar grabación" : "Pausar grabación"}
                    onClick={isRecordingPaused ? resumeRecording : pauseRecording}
                  >
                    {isRecordingPaused ? (
                      <Mic className="h-4 w-4" />
                    ) : (
                      <Pause className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="h-9 px-5 gap-2 rounded-full bg-indigo-400 hover:bg-indigo-500 text-white font-medium shadow-none"
                    onClick={stopAndSendRecording}
                  >
                    <Send className="h-4 w-4" />
                    Enviar
                  </Button>
                </div>
              </div>
            ) : (
            <textarea
              data-composer="true"
              value={inputText}
              onChange={handleTextareaChange}
              onKeyDown={(e) => {
                if (isMentionMenuOpen && filteredMentionUsers.length > 0) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setMentionSelectedIdx((i) => (i + 1) % filteredMentionUsers.length);
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setMentionSelectedIdx((i) =>
                      i <= 0 ? filteredMentionUsers.length - 1 : i - 1
                    );
                    return;
                  }
                  if (e.key === "Enter" || e.key === "Tab") {
                    e.preventDefault();
                    insertMention(filteredMentionUsers[mentionSelectedIdx]);
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setIsMentionMenuOpen(false);
                    setMentionAnchor(null);
                    return;
                  }
                }
                if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }}
              placeholder={activeChannel === "internal" ? "Escribe un comentario interno..." : `Escribe un mensaje por ${CHANNEL_LABELS[activeChannel]}...`}
              className="min-h-[80px] w-full resize-none border-0 bg-transparent px-3 py-3 text-sm shadow-none focus-visible:ring-0 outline-none"
            />
            )}
            
            {/* Toolbar — hidden while recording (recording UI has its own controls) */}
            <div className={cn(
              "flex items-center justify-between border-t px-2 py-1.5",
              isRecording && "hidden",
              activeChannel === "internal" ? "bg-amber-100/50 dark:bg-amber-500/10 border-amber-200/50 dark:border-amber-500/20" : "bg-muted/50 dark:bg-muted/30 border-border"
            )}>
              <div className="flex items-center gap-1">
                {activeChannel === "email" && (
                  <>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                      <Bold className="h-4 w-4" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                      <Italic className="h-4 w-4" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                      <Underline className="h-4 w-4" />
                    </Button>
                    <div className="w-px h-4 bg-border mx-1" />
                  </>
                )}
                
                <input
                  type="file"
                  multiple
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  className="hidden"
                  accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
                />
                
                <Popover>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" title="Emoji">
                      <Smile className="h-4 w-4" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent side="top" align="start" className="w-80 p-2">
                    <div className="max-h-72 overflow-y-auto pr-1">
                      {EMOJI_SET.map((group) => (
                        <div key={group.label} className="mb-2 last:mb-0">
                          <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {group.label}
                          </div>
                          <div className="grid grid-cols-10 gap-0.5">
                            {group.emojis.map((emoji) => (
                              <button
                                key={emoji}
                                type="button"
                                onClick={() => insertEmoji(emoji)}
                                className="flex h-7 w-7 items-center justify-center rounded text-lg leading-none transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                aria-label={`Insertar ${emoji}`}
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
                {/* Spec §2.1 — toolbar has exactly five actions:
                    Emoji (above), Nota de voz, Adjuntar documento,
                    Plantillas internas (Zap), Plantillas WhatsApp
                    (MessageCircle). Anything else was removed in this
                    pass. */}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground"
                  title="Nota de voz"
                  onClick={startRecording}
                  disabled={isRecording}
                >
                  <Mic className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground"
                  title="Adjuntar documento"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Paperclip className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-8 w-8 text-muted-foreground",
                    isTemplateMenuOpen && "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300"
                  )}
                  title="Plantillas internas"
                  onClick={() => setIsTemplateMenuOpen((o) => !o)}
                >
                  <Zap className="h-4 w-4" />
                </Button>
                {/* WhatsApp templates are Meta-approved templates — they only
                    exist on WhatsApp, so this button is shown ONLY on the
                    WhatsApp channel. On other channels (SMS/Email/IG/TikTok/
                    Internal) it must not appear, otherwise WhatsApp templates
                    leak into channels that can't send them. */}
                {activeChannel === "whatsapp" && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-8 w-8 text-muted-foreground",
                      isTemplateDialogOpen && "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
                    )}
                    title="Plantillas WhatsApp"
                    onClick={() => setIsTemplateDialogOpen(true)}
                  >
                    <MessageCircle className="h-4 w-4" />
                  </Button>
                )}
              </div>
              
              <div className="flex items-center gap-2">
                {/* "Programar" entry. Two-step flow per spec section 1.5:
                    the popover surfaces a "plantilla de WhatsApp" path
                    (opens the rich template dialog) AND a quick
                    "mensaje actual" path (schedules whatever the agent
                    has typed in the composer). */}
                <Popover open={isScheduleOpen} onOpenChange={setIsScheduleOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-10 w-10 rounded-full border-slate-200 dark:border-slate-800 text-muted-foreground hover:text-foreground bg-background"
                      disabled={activeChannel === "internal"}
                      title={
                        activeChannel === "internal"
                          ? "Los comentarios internos no se pueden programar"
                          : "Programar mensaje"
                      }
                    >
                      <Clock className="h-4 w-4" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-72 p-3 space-y-3">
                    <div className="text-sm font-semibold">Programar envío</div>
                    {/* Path 1 — rich WhatsApp template dialog. Only on the
                        WhatsApp channel, since these are Meta templates. */}
                    {activeChannel === "whatsapp" && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full h-9 justify-start gap-2 text-slate-700 dark:text-slate-200"
                        onClick={() => {
                          setIsScheduleOpen(false);
                          setIsTemplateDialogOpen(true);
                        }}
                      >
                        <MessageCircle className="h-4 w-4 text-emerald-500" />
                        Programar plantilla de WhatsApp
                      </Button>
                    )}
                    {/* Path 2 — quick text-message scheduling */}
                    <div className="space-y-2 pt-1">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Programar mensaje actual
                      </div>
                      <Select
                        value={quickScheduleOptionId}
                        onValueChange={(v) => setQuickScheduleOptionId(v as ScheduleOptionId)}
                      >
                        <SelectTrigger className="h-9 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SCHEDULE_OPTIONS.map((o) => (
                            <SelectItem key={o.id} value={o.id}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {quickScheduleOptionId === "custom" && (
                        <Input
                          type="datetime-local"
                          value={quickCustomDatetime}
                          onChange={(e) => setQuickCustomDatetime(e.target.value)}
                          min={defaultLocalDatetime().slice(0, 16)}
                          className="h-9 text-sm"
                        />
                      )}
                      <Button
                        type="button"
                        size="sm"
                        className="w-full h-9 bg-violet-500 hover:bg-violet-600 text-white"
                        disabled={!inputText.trim()}
                        onClick={() => {
                          const date =
                            quickScheduleOptionId === "custom"
                              ? new Date(quickCustomDatetime)
                              : resolveScheduleOption(quickScheduleOptionId);
                          if (!date || isNaN(date.getTime())) {
                            toast({
                              title: "Fecha inválida",
                              description: "Selecciona una fecha y hora válida.",
                              variant: "destructive",
                            });
                            return;
                          }
                          onScheduleMessage?.(
                            conversation.id,
                            inputText.trim(),
                            date.toISOString(),
                            activeChannel
                          );
                          setInputText("");
                          setIsScheduleOpen(false);
                          toast({
                            title: "Mensaje programado",
                            description: `Se enviará el ${formatPeruDateTime(date)}`,
                          });
                        }}
                      >
                        Programar mensaje de texto
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
                {/* AI bot Activo/Pausado control. Mirrors GHL's native
                    "Bot de IA de chats" panel: pick a status and the backend
                    fires the GHL workflow that flips the Conversation AI bot
                    plus writes the durable tag mirror. */}
                <Popover open={isBotOpen} onOpenChange={setIsBotOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="relative h-10 w-10 rounded-full border-slate-200 dark:border-slate-800 text-muted-foreground hover:text-foreground bg-background"
                      title="Bot de IA de chats"
                    >
                      <Sparkles className="h-4 w-4" />
                      <span
                        className={`absolute top-2 right-2 h-2 w-2 rounded-full border-[1.5px] border-background ${
                          (conversation.botStatus ?? "active") === "paused"
                            ? "bg-amber-500"
                            : "bg-green-400"
                        }`}
                      />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-72 p-4 space-y-3">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <Sparkles className="h-4 w-4 text-violet-500" />
                      Bot de IA de chats
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      Bot asignado:{" "}
                      <span className="font-medium text-slate-700 dark:text-slate-200">
                        AI Dental
                      </span>
                    </div>
                    <Select
                      value={conversation.botStatus ?? "active"}
                      onValueChange={(v) =>
                        onSetBotStatus?.(conversation.id, v as "active" | "paused")
                      }
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Activo</SelectItem>
                        <SelectItem value="paused">Pausado</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="flex items-center gap-2 rounded-lg bg-slate-50 dark:bg-slate-800 px-3 py-2">
                      <span
                        className={`h-2 w-2 rounded-full ${
                          (conversation.botStatus ?? "active") === "active"
                            ? "bg-emerald-500"
                            : "bg-amber-500"
                        }`}
                      />
                      <span className="text-xs text-slate-600 dark:text-slate-300">
                        {(conversation.botStatus ?? "active") === "active"
                          ? "El bot está activo y responderá automáticamente."
                          : "El bot está en pausa y no responderá."}
                      </span>
                    </div>
                  </PopoverContent>
                </Popover>
                {/* WhatsApp template dialog used to be mounted here
                    but the composer is replaced by the lock
                    placeholder when WhatsApp + 24h-expired, which
                    would unmount the dialog and break the
                    "Reabrir chat" flow. It's now mounted once at the
                    top of the chat panel — see below. */}

                <Button
                  type="submit"
                  size="sm"
                  disabled={
                    isUploading ||
                    (!inputText.trim() && selectedFiles.length === 0 && templateAttachments.length === 0)
                  }
                  className="h-9 px-5 gap-2 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium shadow-none disabled:opacity-50"
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Enviando…
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      Enviar
                    </>
                  )}
                </Button>
              </div>
            </div>
          </form>
          )}
        </div>
      </div>


      {/* Lead deletion confirmation */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar lead?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará permanentemente a{" "}
              <span className="font-semibold text-foreground">
                {conversation.participant.name}
              </span>{" "}
              y todos sus datos de GoHighLevel. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async (e) => {
                e.preventDefault();
                setIsDeleting(true);
                try {
                  await onDeleteLead?.();
                } finally {
                  setIsDeleting(false);
                  setIsDeleteDialogOpen(false);
                }
              }}
            >
              {isDeleting ? "Eliminando…" : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* File viewer modal — opens when a staged or sent file is clicked. */}
      <Dialog
        open={viewerFile !== null}
        onOpenChange={(open) => !open && setViewerFile(null)}
      >
        <DialogContent className="max-w-4xl w-[95vw] h-[90vh] p-0 gap-0 overflow-hidden flex flex-col">
          {viewerFile && (() => {
            const { url, name, mime, rawUrl } = viewerFile;
            const lower = (name || url || "").toLowerCase();
            const m = (mime || "").toLowerCase();
            const isPdf = m === "application/pdf" || /\.pdf(\?|#|$)/.test(lower);
            const isImage =
              m.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/.test(lower);
            const isVideo =
              m.startsWith("video/") || /\.(mp4|webm|ogg|mov|3gp)(\?|#|$)/.test(lower);
            const isAudio =
              m.startsWith("audio/") || /\.(mp3|ogg|m4a|aac|amr|wav)(\?|#|$)/.test(lower);
            // Office docs (Word/Excel/PowerPoint) can't render in-browser, but
            // Microsoft's hosted viewer can — it needs a PUBLIC url (rawUrl),
            // which we only have for SENT attachments, not staged blobs.
            const isOffice = /\.(docx?|xlsx?|pptx?)(\?|#|$)/.test(lower);
            const officeViewerUrl =
              isOffice && rawUrl
                ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(rawUrl)}`
                : null;
            return (
              <>
                <DialogHeader className="flex flex-row items-center justify-between gap-3 border-b px-4 py-3 space-y-0">
                  <DialogTitle className="truncate text-sm font-medium">{name}</DialogTitle>
                  <a
                    href={url}
                    download={name}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mr-6 flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"
                  >
                    <Download className="h-3.5 w-3.5" /> Descargar
                  </a>
                </DialogHeader>
                <div className="flex-1 min-h-0 bg-muted/30">
                  {isPdf ? (
                    <iframe src={url} title={name} className="h-full w-full border-0 bg-white" />
                  ) : isImage ? (
                    <div className="flex h-full w-full items-center justify-center p-4">
                      <img src={url} alt={name} className="max-h-full max-w-full object-contain" />
                    </div>
                  ) : isVideo ? (
                    <div className="flex h-full w-full items-center justify-center bg-black p-2">
                      <video src={url} controls autoPlay className="max-h-full max-w-full" />
                    </div>
                  ) : isAudio ? (
                    <div className="flex h-full w-full items-center justify-center p-6">
                      <audio src={url} controls autoPlay className="w-full max-w-md" />
                    </div>
                  ) : officeViewerUrl ? (
                    <iframe
                      src={officeViewerUrl}
                      title={name}
                      className="h-full w-full border-0 bg-white"
                    />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
                      <FileIcon className="h-12 w-12" />
                      <p className="text-sm">No se puede previsualizar este tipo de archivo.</p>
                      <a
                        href={url}
                        download={name}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                      >
                        <Download className="h-4 w-4" /> Descargar archivo
                      </a>
                    </div>
                  )}
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
