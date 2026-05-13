import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChannelAvatar } from "./ChannelAvatar";
import { ImageLightbox } from "./ImageLightbox";
import { VideoLightbox } from "./VideoLightbox";
import { AudioPlayer } from "./AudioPlayer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { Phone, Video, Info, Paperclip, Smile, Send, X, FileIcon, FileText, Tags, Tag, DollarSign, Image as ImageIcon, Bold, Italic, Underline, Link as LinkIcon, List, Clock, MessageCircle, Star, Mail, Trash2, ChevronDown, Bell, User as UserIcon, CheckSquare, CheckCircle2, Circle, BookmarkPlus, Edit2, Check, PanelRight, Search, CornerUpLeft, ArrowRight, Play, Reply, AlertCircle, MoreHorizontal, Menu, Inbox, Mic, Zap, Contact, Waypoints, Delete, Download, Pin, PinOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Conversation, Message, User, Task } from "./types";
import { cn } from "@/lib/utils";
import { proxyMediaUrl, api } from "@/lib/api";

interface ChatMessageAreaProps {
  conversation: Conversation;
  currentUser: User;
  tasks: Task[];
  onAddTask: (task: Omit<Task, "id">) => void;
  onToggleTask: (id: string) => void;
  onSendMessage: (text: string, attachment?: Message["attachment"], channel?: Message["channel"], mentions?: string[], reminder?: string, replyTo?: Message["replyTo"]) => void;
  onScheduleMessage?: (
    conversationId: string,
    text: string,
    date: string,
    channel?: Message["channel"],
    template?: { id: string; name?: string }
  ) => void;
  onCancelScheduledMessage?: (conversationId: string, messageId: string) => void;
  onUpdateStage?: (id: string, stage: Conversation["stage"]) => void;
  onClearReminder?: (id: string) => void;
  onSetReminder?: (id: string, reminder: string) => void;
  onToggleFavorite?: (id: string) => void;
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
    <VideoLightbox src={proxied} alt={name}>
      <div className="relative">
        {posterFailed ? (
          <div className="flex min-h-[130px] min-w-[220px] flex-col items-center justify-center gap-2 rounded-lg bg-slate-800 px-6 py-5">
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
            className="max-h-[250px] max-w-full rounded-lg object-cover bg-black transition-transform group-hover:scale-[1.02]"
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
const RENDERABLE_ATTACHMENT_TYPES: ReadonlySet<NonNullable<Message["attachment"]>["type"]> = new Set([
  "image",
  "video",
  "audio",
  "file",
  "document",
  "link",
]);

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
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((today.getTime() - that.getTime()) / (24 * 3600 * 1000));
  if (diffDays === 0) return "Hoy";
  if (diffDays === 1) return "Ayer";
  return `${d.getDate()} ${MONTHS_ES[d.getMonth()]} ${d.getFullYear()}`;
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

export function ChatMessageArea({
  conversation,
  currentUser,
  tasks,
  onAddTask,
  onToggleTask,
  onSendMessage,
  onScheduleMessage,
  onCancelScheduledMessage,
  onUpdateStage,
  onClearReminder,
  onSetReminder,
  onToggleFavorite,
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
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
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
  const [isTaskDialogOpen, setIsTaskDialogOpen] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDueDate, setNewTaskDueDate] = useState("Hoy");
  // Captured by the datetime-local input when "Personalizado" is the chosen
  // preset. Shape is "YYYY-MM-DDTHH:mm" — `new Date(value)` parses it as
  // local time, then we hand the ISO string to the backend.
  const [customDueDateTime, setCustomDueDateTime] = useState("");
  const [newTaskAssignee, setNewTaskAssignee] = useState(currentUser.name);
  const [taskPresets, setTaskPresets] = useState<string[]>(["Llamar para seguimiento", "Enviar cotización", "Agendar reunión"]);
  const [editingPresetIndex, setEditingPresetIndex] = useState<number | null>(null);
  const [editingPresetValue, setEditingPresetValue] = useState("");
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

  // Meta WhatsApp 24h policy: once the customer has been silent for >24h
  // the agent can only re-engage by sending a Meta-approved template.
  // We surface this as a sticky "Ventana de 24h expirada" banner above
  // the chat AND lock the composer so the agent can't accidentally send
  // a free-form message that WhatsApp would reject.
  const isWhatsApp24hWindowExpired = useMemo(() => {
    if (conversation.source !== "whatsapp") return false;
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
  }, [conversation.source, conversation.messages]);

  // Two surfaces drive scheduling now: a small entry Popover (quick
  // text-message scheduling + button to open the rich dialog) and the
  // rich WhatsApp template dialog itself.
  const [isScheduleOpen, setIsScheduleOpen] = useState(false);
  const [isTemplateDialogOpen, setIsTemplateDialogOpen] = useState(false);
  const [quickScheduleOptionId, setQuickScheduleOptionId] = useState<ScheduleOptionId>("manana_9am");
  const [quickCustomDatetime, setQuickCustomDatetime] = useState(defaultLocalDatetime);

  // "Plantillas rápidas" — agent's local canned messages. Now backed
  // by Prisma/SQLite per-location on the backend so they survive
  // reloads + restarts. State here is a hydrated cache; every CRUD
  // op hits `/api/quick-templates/…` and reconciles the cache from
  // the response.
  const [messageTemplates, setMessageTemplates] = useState<
    { id: string; title: string; text: string; category: string }[]
  >([]);
  const [isTemplateMenuOpen, setIsTemplateMenuOpen] = useState(false);
  const [templateSearch, setTemplateSearch] = useState("");
  // Active category in the Plantillas rápidas popover sidebar.
  // "" / "Todas" means "no filter — show every template".
  const [templateCategory, setTemplateCategory] = useState<string>("");

  // Hydrate from the backend once on mount. Failures fall back to an
  // empty list and the agent can still create new templates — they'll
  // appear once the backend recovers and the user reopens the popover.
  useEffect(() => {
    let cancelled = false;
    api.quickTemplates
      .list()
      .then((res) => {
        if (cancelled) return;
        setMessageTemplates(
          res.templates.map((t) => ({
            id: t.id,
            title: t.title,
            text: t.body,
            category: t.category,
          }))
        );
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("[quick-templates] load failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const [manageTemplateSearch, setManageTemplateSearch] = useState("");
  const [isManageTemplatesOpen, setIsManageTemplatesOpen] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [editingTemplateTitle, setEditingTemplateTitle] = useState("");
  const [editingTemplateText, setEditingTemplateText] = useState("");
  const [editingTemplateCategory, setEditingTemplateCategory] = useState("General");

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Scroll management refs — no state needed, mutations happen outside render.
  const initialScrollDoneRef = useRef(false);
  const prevFirstMessageIdRef = useRef<string | undefined>(undefined);
  const scrollHeightBeforeRef = useRef(0);
  const scrollTopBeforeRef = useRef(0);
  // Guards against firing onLoadOlderMessages twice before isLoadingOlderMessages updates.
  const requestedOlderRef = useRef(false);

  // When the conversation changes, reset all scroll-state refs so the new
  // conversation always starts with a jump-to-bottom (branch 1 in the
  // useLayoutEffect below). Without this, switching conversations can
  // accidentally trigger the "prepend restore" path.
  useLayoutEffect(() => {
    initialScrollDoneRef.current = false;
    prevFirstMessageIdRef.current = undefined;
    requestedOlderRef.current = false;
  }, [conversation.id]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || conversation.messages.length === 0) return;

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

    // New message appended — scroll to bottom only if already near the bottom.
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 150) {
      el.scrollTop = el.scrollHeight;
    }
  }, [conversation.id, conversation.messages.length]);

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
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      if (file.type.startsWith("image/")) {
        setPreviewUrl(URL.createObjectURL(file));
      } else {
        setPreviewUrl(null);
      }
    }
    // Reset input value so the same file can be selected again if removed
    if (e.target) {
      e.target.value = '';
    }
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    setReplyingToMessage(null);
  };

  const [isUploading, setIsUploading] = useState(false);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!(inputText.trim() || selectedFile)) return;
    if (isUploading) return;

    let attachment: Message["attachment"] | undefined;
    if (selectedFile) {
      setIsUploading(true);
      try {
        // Upload to GHL's conversation-attachment endpoint first. Pass
        // the active conversation id so the resulting URL is one GHL's
        // send-message handler recognises as proper media — library
        // URLs make GHL fall through to a text-only Meta payload and
        // get 400'd with "text.body is required".
        const uploaded = await api.uploads.create(selectedFile, conversation.id);
        const mime = uploaded.mimeType || selectedFile.type || "";
        const type: NonNullable<Message["attachment"]>["type"] = mime.startsWith("image/")
          ? "image"
          : mime.startsWith("video/")
            ? "video"
            : mime.startsWith("audio/")
              ? "audio"
              : "file";
        attachment = { type, url: uploaded.url, name: uploaded.name };
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
      const mentionRegex = /@(\w+)/g;
      const matches = inputText.match(mentionRegex);
      if (matches) {
        mentions = matches.map(m => m.substring(1));
      }
    }

    onSendMessage(inputText, attachment, activeChannel, mentions.length > 0 ? mentions : undefined, activeReminder || undefined);
    setInputText("");
    handleRemoveFile();
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

    // Check if the cursor is right after a word starting with /
    const cursorPosition = e.target.selectionStart;
    const textBeforeCursor = value.substring(0, cursorPosition);
    const match = textBeforeCursor.match(/(?:^|\s)\/([^\s]*)$/);

    if (match) {
      setIsTemplateMenuOpen(true);
      setTemplateSearch(match[1]);
    } else {
      setIsTemplateMenuOpen(false);
    }
  };

  const insertTemplate = (templateText: string) => {
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

        <div className="flex items-center gap-1 sm:gap-2 min-w-0 overflow-x-auto -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {/* Status Dropdown */}
          <Popover open={isStagesOpen} onOpenChange={setIsStagesOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className="h-9 text-[13px] font-medium border-slate-200 bg-slate-50 hover:bg-slate-100 focus:ring-0 w-[110px] sm:w-[120px] shrink-0 rounded-full px-3 shadow-none text-slate-700 dark:bg-muted/50 dark:border-border dark:text-foreground transition-colors mr-1 justify-between">
                <div className="flex items-center gap-2 truncate">
                  <div className={cn("h-2 w-2 shrink-0 rounded-full", stages.find(s => s.id === conversation.stage)?.color || "bg-slate-500")} />
                  <span className="truncate">{stages.find(s => s.id === conversation.stage)?.label || "Estado"}</span>
                </div>
                <ChevronDown className="h-4 w-4 shrink-0 opacity-50 ml-1" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-2 rounded-xl" align="start">
              <div className="space-y-1">
                {stages.map((stage, idx) => (
                  <div key={stage.id} className="flex items-center gap-1 group">
                    {editingStageId === stage.id ? (
                      <div className="flex flex-1 items-center gap-1">
                        <Input
                          value={editingStageName}
                          onChange={(e) => setEditingStageName(e.target.value)}
                          className="h-8 text-sm"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              if (editingStageName.trim() && editingStageName.trim() !== stage.label) {
                                setStages(stages.map(s => s.id === stage.id ? { ...s, label: editingStageName.trim() } : s));
                                toast({ title: "Estado actualizado" });
                              }
                              setEditingStageId(null);
                            } else if (e.key === 'Escape') {
                              setEditingStageId(null);
                            }
                          }}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 shrink-0"
                          onClick={() => {
                            if (editingStageName.trim() && editingStageName.trim() !== stage.label) {
                              setStages(stages.map(s => s.id === stage.id ? { ...s, label: editingStageName.trim() } : s));
                              toast({ title: "Estado actualizado" });
                            }
                            setEditingStageId(null);
                          }}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground shrink-0"
                          onClick={() => setEditingStageId(null)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <div 
                        className="flex flex-1 items-center justify-between px-2 py-1.5 text-sm rounded-md hover:bg-accent cursor-pointer"
                        onClick={() => {
                          onUpdateStage?.(conversation.id, stage.id);
                          setIsStagesOpen(false);
                        }}
                      >
                        <div className="flex items-center gap-2 truncate">
                          {conversation.stage === stage.id && <Check className="h-4 w-4 shrink-0" />}
                          <div className={cn("h-2 w-2 shrink-0 rounded-full", stage.color, conversation.stage !== stage.id && "ml-6")} />
                          <span className="truncate">{stage.label}</span>
                        </div>
                        <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-7 w-7 text-muted-foreground hover:text-foreground shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (idx > 0) {
                                const newStages = [...stages];
                                [newStages[idx - 1], newStages[idx]] = [newStages[idx], newStages[idx - 1]];
                                setStages(newStages);
                              }
                            }}
                            disabled={idx === 0}
                          >
                            <ChevronDown className="h-3 w-3 rotate-180" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-7 w-7 text-muted-foreground hover:text-foreground shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (idx < stages.length - 1) {
                                const newStages = [...stages];
                                [newStages[idx + 1], newStages[idx]] = [newStages[idx], newStages[idx + 1]];
                                setStages(newStages);
                              }
                            }}
                            disabled={idx === stages.length - 1}
                          >
                            <ChevronDown className="h-3 w-3" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-7 w-7 text-muted-foreground hover:text-foreground shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingStageId(stage.id);
                              setEditingStageName(stage.label);
                            }}
                          >
                            <Edit2 className="h-3 w-3" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              setStages(stages.filter(s => s.id !== stage.id));
                            }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                <Button 
                  variant="ghost" 
                  className="w-full justify-start text-xs text-muted-foreground mt-2 h-8"
                  onClick={(e) => {
                    e.stopPropagation();
                    const newId = `stage_${Date.now()}`;
                    setStages([...stages, { id: newId, label: "Nuevo Estado", color: "bg-slate-500" }]);
                    setEditingStageId(newId);
                    setEditingStageName("Nuevo Estado");
                  }}
                >
                  + Añadir estado
                </Button>
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
              Hidden below xl — also reachable from the contact sidebar. */}
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

          {/* Email: opens the OS mailto: handler. Disabled when the contact has no email.
              Hidden below xl — also reachable from the contact sidebar. */}
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="hidden 2xl:inline-flex h-9 w-9 rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100 hover:text-blue-700 dark:bg-blue-500/10 dark:text-blue-400 dark:hover:bg-blue-500/20 disabled:opacity-40"
                disabled={!conversation.participant.email}
                onClick={() => {
                  if (conversation.participant.email) {
                    window.location.href = `mailto:${conversation.participant.email}`;
                  }
                }}
              >
                <Mail className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {conversation.participant.email
                ? `Enviar email a ${conversation.participant.email}`
                : "Sin dirección de email"}
            </TooltipContent>
          </Tooltip>

          {/* Task Button */}
          <Dialog open={isTaskDialogOpen} onOpenChange={setIsTaskDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full bg-purple-50 text-purple-600 hover:bg-purple-100 hover:text-purple-700 dark:bg-purple-500/10 dark:text-purple-400 dark:hover:bg-purple-500/20">
                <CheckCircle2 className="h-4 w-4" />
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Nueva Tarea</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="title">Descripción de la tarea</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8 text-xs font-normal bg-background">
                          <List className="h-3.5 w-3.5 mr-1.5" />
                          Seleccionar plantilla
                          <ChevronDown className="h-3.5 w-3.5 ml-2 text-muted-foreground" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent align="end" className="w-[300px] p-2">
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
                                    onClick={() => setNewTaskTitle(preset)}
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
                  <div className="flex gap-2">
                    <Input
                      id="title"
                      value={newTaskTitle}
                      onChange={(e) => setNewTaskTitle(e.target.value)}
                      placeholder="Ej. Llamar para seguimiento..."
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
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
                  <Label>Vencimiento</Label>
                  <Select value={newTaskDueDate} onValueChange={setNewTaskDueDate}>
                    <SelectTrigger>
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
                  <Label>Asignado a</Label>
                  {/* Single-option select. Without `users.readonly` scope on
                      the GHL token we don't have a real user roster, so we
                      can't offer assignment to specific GHL users — the
                      backend would receive a name, not a user id, and GHL
                      would silently drop it. Defaulting to "Yo" mirrors how
                      the agent's own session would assign the task. */}
                  <Select value={newTaskAssignee} onValueChange={setNewTaskAssignee}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona un usuario" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={currentUser.name}>Yo ({currentUser.name})</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsTaskDialogOpen(false)}>Cancelar</Button>
                <Button
                  // Block "Crear" until both the title and (when relevant) the
                  // custom datetime are filled in. Without this guard, picking
                  // "Personalizado" without filling the date sends the literal
                  // word and falls back to "tomorrow" silently — surprising.
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

                    setIsTaskDialogOpen(false);

                    onAddTask({
                      title: newTaskTitle,
                      dueDate: dueDateOut,
                      assignee: { name: newTaskAssignee },
                      contact: { name: conversation.participant.name, avatar: conversation.participant.avatar },
                      status: "pending",
                      conversationId: conversation.id,
                    });

                    setNewTaskTitle("");
                    setNewTaskDueDate("Hoy");
                    setCustomDueDateTime("");
                  }}
                >
                  Crear Tarea
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
        </div>
      ))}

      {/* Reminder Banner */}
      {activeReminder && (
        <div className="flex items-center justify-between bg-yellow-100/80 px-4 py-2 text-sm text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-200 border-b border-yellow-200 dark:border-yellow-500/30">
          <div className="flex items-center gap-2 font-medium">
            <Bell className="h-4 w-4" />
            <span>Recordatorio configurado para: {activeReminder}</span>
          </div>
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-6 w-6 rounded-full hover:bg-yellow-200 dark:hover:bg-yellow-500/30 text-yellow-800 dark:text-yellow-200"
            onClick={() => {
              setActiveReminder(null);
              onClearReminder?.(conversation.id);
            }}
          >
            <X className="h-3 w-3" />
          </Button>
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
              ? { id: payload.templateId, name: payload.templateName }
              : undefined
          );
        }}
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
          if (!hasOlderMessages || isLoadingOlderMessages || !onLoadOlderMessages || requestedOlderRef.current) return;
          if (e.currentTarget.scrollTop < 100) {
            requestedOlderRef.current = true;
            scrollHeightBeforeRef.current = e.currentTarget.scrollHeight;
            scrollTopBeforeRef.current = e.currentTarget.scrollTop;
            onLoadOlderMessages();
          }
        }}
      >
        {isLoadingOlderMessages && (
          <div className="flex justify-center py-3 text-xs text-muted-foreground">
            Cargando mensajes anteriores…
          </div>
        )}
        {!hasOlderMessages && conversation.messages.length > 0 && (
          <div className="flex justify-center py-2 text-[11px] text-muted-foreground/40">
            Inicio del historial
          </div>
        )}
        <div className="flex flex-col gap-4 py-4">
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
                  <div className="flex w-full items-center gap-3 my-2">
                    <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700/60" />
                    <div className="inline-flex flex-wrap items-center justify-center gap-1.5 rounded-full bg-slate-100/80 dark:bg-slate-800/60 px-3 py-1.5 text-[11px] text-slate-500 dark:text-slate-400 shadow-sm">
                      <ArrowRight className="h-3 w-3 text-slate-400 dark:text-slate-500" />
                      <span className="font-semibold text-slate-700 dark:text-slate-200">{ev.opportunityName}</span>
                      <span>movido</span>
                      {isFunnelMove ? (
                        <>
                          <span className="line-through opacity-70">
                            {ev.previousPipeline} / {ev.oldStage}
                          </span>
                          <ArrowRight className="h-3 w-3 text-slate-400 dark:text-slate-500" />
                          <span className="font-semibold text-slate-700 dark:text-slate-200">
                            {ev.pipeline} / {ev.newStage}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="line-through opacity-70">{ev.oldStage}</span>
                          <ArrowRight className="h-3 w-3 text-slate-400 dark:text-slate-500" />
                          <span className="font-semibold text-slate-700 dark:text-slate-200">{ev.newStage}</span>
                          {ev.pipeline && (
                            <span className="opacity-60">en {ev.pipeline}</span>
                          )}
                        </>
                      )}
                      <span className="opacity-40">·</span>
                      <span>{ev.user}</span>
                      <span className="opacity-40">·</span>
                      <span>{message.timestamp}</span>
                    </div>
                    <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700/60" />
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
              return (
                <React.Fragment key={message.id}>
                  {dateSeparator}
                  <div className="flex w-full items-center gap-3 my-2">
                    <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700/60" />
                    <div className="inline-flex flex-wrap items-center justify-center gap-1.5 rounded-full bg-slate-100/80 dark:bg-slate-800/60 px-3 py-1.5 text-[11px] text-slate-500 dark:text-slate-400 shadow-sm">
                      <Waypoints className="h-3 w-3 text-slate-400 dark:text-slate-500" />
                      <span>Oportunidad</span>
                      {ev.opportunityName && (
                        <span className="font-semibold text-slate-700 dark:text-slate-200">
                          {ev.opportunityName}
                        </span>
                      )}
                      <span>{actionLabel}</span>
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

            const isMe = message.senderId === currentUser.id;
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
            const outboundName = message.senderName ?? currentUser.name;
            const outboundAvatar = message.senderAvatar ?? currentUser.avatar;

            return (
              <React.Fragment key={message.id}>
                {dateSeparator}
                <div
                  data-message-id={message.id}
                  className={cn(
                    "flex w-full items-end gap-2 group scroll-mt-24",
                    isMe ? "justify-end" : "justify-start",
                    isConsecutive ? "mt-1" : "mt-4"
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

                {isMe && (
                  <div className="mb-5 shrink-0">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full text-muted-foreground hover:bg-muted">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setReplyingToMessage(message)}>
                          <Reply className="h-4 w-4 mr-2" />
                          Responder
                        </DropdownMenuItem>
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
                                  (message.senderId === currentUser.id ? currentUser.name : conversation.participant.name),
                                channel: message.channel,
                              })
                            }
                          >
                            <Pin className="h-4 w-4 mr-2" />
                            Fijar
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => toast({ title: "Detalles del mensaje", description: `Enviado a las ${message.timestamp}` })}>
                          <Info className="h-4 w-4 mr-2" />
                          Ver detalles
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
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
                      "shadow-sm transition-all animate-in fade-in slide-in-from-bottom-2",
                      message.channel === "internal"
                        ? "bg-[#FFF4CC] text-[#78350F] dark:bg-amber-900/40 dark:text-amber-200 rounded-[24px] px-5 py-2.5 text-[15px] font-medium inline-block"
                        : isMe
                        ? "bg-primary text-primary-foreground rounded-[24px] px-5 py-3 text-[15px]"
                        : "bg-muted text-foreground rounded-[24px] px-5 py-3 text-[15px]",
                      !message.text && message.attachment && (message.attachment.type === "image" || message.attachment.type === "video") ? "bg-transparent p-0 shadow-none" : ""
                    )}
                  >
                    {message.attachment && (
                      <div className={cn("mb-1 overflow-hidden rounded-lg", message.text ? "mt-1" : "")}>
                        {message.attachment.type === "image" ? (
                          <ImageLightbox
                            src={message.attachment.url}
                            alt={message.attachment.name}
                          >
                            <img
                              src={message.attachment.url}
                              alt={message.attachment.name}
                              className="max-h-[250px] max-w-full rounded-lg object-cover transition-transform group-hover:scale-[1.02]"
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
                        ) : (message.attachment.type === "file" || message.attachment.type === "document") ? (
                          <a
                            href={proxyMediaUrl(message.attachment.url)}
                            download={message.attachment.name}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Descargar ${message.attachment.name}`}
                            className={cn(
                              "flex items-center gap-2 rounded-lg border p-3 transition-colors",
                              isMe
                                ? "bg-primary-foreground/10 border-primary-foreground/20 text-primary-foreground hover:bg-primary-foreground/20"
                                : "bg-background border-border text-foreground hover:bg-accent/60"
                            )}
                          >
                            <FileIcon className="h-5 w-5 shrink-0" />
                            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                              <span className="truncate text-sm font-medium">{message.attachment.name}</span>
                              {message.attachment.size && (
                                <span className="text-[10px] opacity-70">{message.attachment.size}</span>
                              )}
                            </div>
                            <Download className="h-4 w-4 shrink-0 opacity-70" />
                          </a>
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
                    {message.text && <span className="whitespace-pre-wrap leading-relaxed">{message.text}</span>}

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
                  </div>

                  {message.buttons && message.buttons.length > 0 && (
                    <div className="flex flex-col gap-2 w-full mt-2">
                      {message.buttons.map((btn) => (
                        <button 
                          key={btn.id}
                          className={cn(
                            "flex items-center justify-center gap-2 w-full py-2.5 px-4 text-primary dark:text-primary-foreground text-[14px] font-medium hover:bg-primary/5 dark:hover:bg-primary/20 transition-colors rounded-full border border-primary/20 dark:border-primary/30 bg-background shadow-sm"
                          )}
                        >
                          <span className="truncate">{btn.text}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  <div className={cn(
                    "flex items-center gap-1.5 mt-1",
                    isMe ? "justify-end" : "justify-start"
                  )}>
                    <span className="text-[12px] text-muted-foreground flex items-center gap-1 font-medium">
                      <Clock className="h-3.5 w-3.5 opacity-70" />
                      {message.timestamp}
                    </span>
                  </div>
                </div>

                {!isMe && (
                  <div className="mb-5 shrink-0">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full text-muted-foreground hover:bg-muted">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem onClick={() => setReplyingToMessage(message)}>
                          <Reply className="h-4 w-4 mr-2" />
                          Responder
                        </DropdownMenuItem>
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
                                  (message.senderId === currentUser.id ? currentUser.name : conversation.participant.name),
                                channel: message.channel,
                              })
                            }
                          >
                            <Pin className="h-4 w-4 mr-2" />
                            Fijar
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => toast({ title: "Detalles del mensaje", description: `Recibido a las ${message.timestamp}` })}>
                          <Info className="h-4 w-4 mr-2" />
                          Ver detalles
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}

                {isMe && (
                  <div className={cn(isConsecutive ? "invisible" : "visible", "shrink-0")}>
                    <Tooltip delayDuration={200}>
                      <TooltipTrigger asChild>
                        <Avatar className="h-8 w-8 cursor-default">
                          <AvatarImage src={outboundAvatar} alt={outboundName} />
                          <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">
                            {outboundName.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
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
            <TabsList className="h-8 bg-muted/50">
              {availableChannels.map((ch) => (
                <TabsTrigger
                  key={ch}
                  value={ch}
                  className={cn(
                    "text-xs h-6 px-4",
                    ch === "internal"
                      ? "data-[state=active]:bg-amber-100 data-[state=active]:text-amber-800 dark:data-[state=active]:bg-amber-500/20 dark:data-[state=active]:text-amber-400"
                      : "data-[state=active]:bg-slate-200 data-[state=active]:text-slate-800 dark:data-[state=active]:bg-slate-700 dark:data-[state=active]:text-slate-200"
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

          {selectedFile && (
            <div className="mb-3 flex items-center gap-3 rounded-xl border bg-background p-2 pr-4 shadow-sm animate-in slide-in-from-bottom-2">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                {previewUrl ? (
                  <img src={previewUrl} alt="Preview" className="h-full w-full object-cover" />
                ) : (
                  <FileIcon className="h-6 w-6 text-muted-foreground" />
                )}
              </div>
              <div className="flex flex-1 flex-col overflow-hidden">
                <span className="truncate text-sm font-medium text-foreground">
                  {selectedFile.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {(selectedFile.size / 1024).toFixed(1)} KB
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive shrink-0"
                onClick={handleRemoveFile}
              >
                <X className="h-4 w-4" />
              </Button>
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
                      className="h-7 w-7 text-muted-foreground"
                      onClick={() => {
                        setIsManageTemplatesOpen(true);
                        setIsTemplateMenuOpen(false);
                      }}
                      title="Gestionar plantillas"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
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
                              onClick={() => insertTemplate(template.text)}
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
            onSubmit={handleSend}
            className={cn(
              "flex flex-col rounded-xl border focus-within:ring-1 focus-within:ring-primary focus-within:border-primary transition-all shadow-sm overflow-hidden",
              activeChannel === "internal" ? "bg-amber-50/50 dark:bg-amber-500/5 border-amber-200/50 dark:border-amber-500/20" : "bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700"
            )}
          >
            {activeChannel === "email" && (
              <div className="border-b border-slate-200 dark:border-slate-700 px-3 py-2 flex items-center gap-2 bg-slate-100/50 dark:bg-slate-800">
                <span className="text-xs text-muted-foreground font-medium">Asunto:</span>
                <input type="text" className="flex-1 bg-transparent border-none outline-none text-sm" placeholder="Escribe el asunto..." />
              </div>
            )}
            
            <textarea
              value={inputText}
              onChange={handleTextareaChange}
              onKeyDown={(e) => {
                // Enter sends; Shift+Enter inserts a newline; skip while an
                // IME (Korean/Japanese/Chinese) composition is active so
                // confirming a candidate doesn't fire a send.
                if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }}
              placeholder={activeChannel === "internal" ? "Escribe un comentario interno..." : `Escribe un mensaje por ${CHANNEL_LABELS[activeChannel]}...`}
              className="min-h-[80px] w-full resize-none border-0 bg-transparent px-3 py-3 text-sm shadow-none focus-visible:ring-0 outline-none"
            />
            
            {/* Toolbar */}
            <div className={cn(
              "flex items-center justify-between border-t px-2 py-1.5",
              activeChannel === "internal" ? "bg-amber-100/50 dark:bg-amber-500/10 border-amber-200/50 dark:border-amber-500/20" : "bg-slate-100/50 dark:bg-slate-800 border-slate-200 dark:border-slate-700"
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
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  className="hidden"
                  accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
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
                  onClick={() => toast({ title: "Nota de voz", description: "La grabación de notas de voz se habilitará próximamente." })}
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
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-8 w-8 text-muted-foreground",
                    isTemplateDialogOpen && "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
                  )}
                  title="Plantillas WhatsApp"
                  onClick={() => {
                    // Force WhatsApp channel before opening so the
                    // dialog fetches the right template type, even if
                    // the agent had switched to Internal/SMS/Email.
                    if (activeChannel === "internal") setActiveChannel("whatsapp");
                    setIsTemplateDialogOpen(true);
                  }}
                >
                  <MessageCircle className="h-4 w-4" />
                </Button>
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
                      variant="ghost"
                      size="sm"
                      className="h-9 px-4 gap-2 text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-full font-medium dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 transition-colors"
                      disabled={activeChannel === "internal"}
                      title={
                        activeChannel === "internal"
                          ? "Los comentarios internos no se pueden programar"
                          : "Programar mensaje"
                      }
                    >
                      <Clock className="h-4 w-4" />
                      Programar
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-72 p-3 space-y-3">
                    <div className="text-sm font-semibold">Programar envío</div>
                    {/* Path 1 — rich WhatsApp template dialog */}
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
                            description: `Se enviará el ${date.toLocaleString("es-ES")}`,
                          });
                        }}
                      >
                        Programar mensaje de texto
                      </Button>
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
                  disabled={!inputText.trim() && !selectedFile}
                  className="h-9 px-5 gap-2 rounded-full bg-indigo-400 hover:bg-indigo-500 text-white font-medium shadow-none"
                >
                  <Send className="h-4 w-4" />
                  Enviar
                </Button>
              </div>
            </div>
          </form>
          )}
        </div>
      </div>

      {/* Templates Management Dialog */}
      <Dialog open={isManageTemplatesOpen} onOpenChange={setIsManageTemplatesOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Gestionar Plantillas Rápidas</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            {editingTemplateId ? (
              <div className="flex flex-col gap-3 rounded-lg border p-4 bg-muted/30 animate-in fade-in slide-in-from-bottom-2">
                <div className="space-y-1.5">
                  <Label>Título (Comando)</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">/</span>
                    <Input 
                      value={editingTemplateTitle}
                      onChange={(e) => setEditingTemplateTitle(e.target.value)}
                      placeholder="Ej: saludo"
                      className="h-9 pl-6 font-medium"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Categoría</Label>
                  <Input
                    value={editingTemplateCategory}
                    onChange={(e) => setEditingTemplateCategory(e.target.value)}
                    placeholder="General / Ventas / Soporte / …"
                    className="h-9"
                    list="template-category-suggestions"
                  />
                  <datalist id="template-category-suggestions">
                    {Array.from(new Set(messageTemplates.map((t) => t.category).filter(Boolean))).map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>
                <div className="space-y-1.5">
                  <Label>Contenido del mensaje</Label>
                  <textarea
                    value={editingTemplateText}
                    onChange={(e) => setEditingTemplateText(e.target.value)}
                    className="min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
                    placeholder="Escribe el contenido de la plantilla..."
                  />
                </div>
                <div className="flex justify-end gap-2 mt-2">
                  <Button variant="outline" size="sm" onClick={() => setEditingTemplateId(null)}>
                    Cancelar
                  </Button>
                  <Button size="sm" onClick={async () => {
                    if (!editingTemplateTitle.trim() || !editingTemplateText.trim()) return;
                    const category = editingTemplateCategory.trim() || "General";
                    try {
                      if (editingTemplateId === 'new') {
                        // Persist to the backend FIRST so the id we
                        // hold in state is the real durable id (so a
                        // subsequent edit/delete targets the right
                        // row).
                        const saved = await api.quickTemplates.create({
                          title: editingTemplateTitle.trim(),
                          body: editingTemplateText.trim(),
                          category,
                        });
                        setMessageTemplates((prev) => [...prev, {
                          id: saved.id,
                          title: saved.title,
                          text: saved.body,
                          category: saved.category,
                        }]);
                      } else {
                        const saved = await api.quickTemplates.update(editingTemplateId!, {
                          title: editingTemplateTitle.trim(),
                          body: editingTemplateText.trim(),
                          category,
                        });
                        setMessageTemplates((prev) => prev.map((t) =>
                          t.id === saved.id ? {
                            id: saved.id,
                            title: saved.title,
                            text: saved.body,
                            category: saved.category,
                          } : t
                        ));
                      }
                      setEditingTemplateId(null);
                      toast({ title: editingTemplateId === 'new' ? "Plantilla creada" : "Plantilla actualizada" });
                    } catch (err) {
                      toast({
                        title: "No se pudo guardar",
                        description: (err as Error)?.message ?? String(err),
                        variant: "destructive",
                      });
                    }
                  }}>
                    Guardar
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar plantillas guardadas..."
                    className="pl-9 h-9 bg-background"
                    value={manageTemplateSearch}
                    onChange={(e) => setManageTemplateSearch(e.target.value)}
                  />
                </div>
                <ScrollArea className="max-h-[300px] border rounded-md bg-card">
                  <div className="p-2 space-y-1">
                    {messageTemplates
                      .filter(t => t.title.toLowerCase().includes(manageTemplateSearch.toLowerCase()) || t.text.toLowerCase().includes(manageTemplateSearch.toLowerCase()))
                      .map(template => (
                      <div key={template.id} className="flex items-start justify-between gap-2 p-2 hover:bg-accent rounded-md group transition-colors">
                        <div className="flex flex-col flex-1 min-w-0">
                          <span className="font-semibold text-sm truncate text-primary">/{template.title}</span>
                          <span className="text-xs text-muted-foreground line-clamp-2 mt-0.5 leading-relaxed">{template.text}</span>
                        </div>
                        <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0 bg-background/50 backdrop-blur-sm rounded-md shadow-sm border p-0.5">
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-muted" onClick={() => {
                            setEditingTemplateId(template.id);
                            setEditingTemplateTitle(template.title);
                            setEditingTemplateText(template.text);
                            setEditingTemplateCategory(template.category || "General");
                          }}>
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                          <div className="w-px h-4 bg-border mx-0.5" />
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive/70 hover:text-destructive hover:bg-destructive/10" onClick={async () => {
                            // Optimistic local removal — re-add on
                            // server failure so the agent's view stays
                            // consistent with the DB.
                            const snapshot = messageTemplates;
                            setMessageTemplates((prev) => prev.filter((t) => t.id !== template.id));
                            try {
                              await api.quickTemplates.remove(template.id);
                              toast({ title: "Plantilla eliminada" });
                            } catch (err) {
                              setMessageTemplates(snapshot);
                              toast({
                                title: "No se pudo eliminar",
                                description: (err as Error)?.message ?? String(err),
                                variant: "destructive",
                              });
                            }
                          }}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                    {messageTemplates.filter(t => t.title.toLowerCase().includes(manageTemplateSearch.toLowerCase()) || t.text.toLowerCase().includes(manageTemplateSearch.toLowerCase())).length === 0 && (
                      <div className="p-8 text-center flex flex-col items-center justify-center gap-2">
                        <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                          <FileText className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <span className="text-sm font-medium text-foreground">No se encontraron plantillas</span>
                        <span className="text-xs text-muted-foreground max-w-[200px]">
                          {manageTemplateSearch ? "No hay resultados para tu búsqueda." : "Crea tu primera plantilla para responder más rápido."}
                        </span>
                      </div>
                    )}
                  </div>
                </ScrollArea>
                <Button variant="outline" className="w-full border-dashed bg-muted/30 hover:bg-muted/50 text-muted-foreground hover:text-foreground" onClick={() => {
                  setEditingTemplateId('new');
                  setEditingTemplateTitle('');
                  setEditingTemplateText('');
                  setEditingTemplateCategory('General');
                }}>
                  <span className="mr-2">+</span> Crear nueva plantilla
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

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
    </div>
  );
}
