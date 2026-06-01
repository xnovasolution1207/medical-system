// One family / dependent link, from the perspective of the lead in the
// right-rail sidebar. `id` is the FamilyRelation row id used to remove
// the link; `contactId` is the related GHL contact's id (so a future
// iteration can open that lead by clicking the chip).
export type FamilyMember = {
  id: string;
  contactId: string;
  name: string;
  phone?: string;
  relationship: "hijo" | "padre" | "esposo" | "hermano" | "otro";
};

export type User = {
  id: string;
  name: string;
  avatar?: string;
  status: "online" | "offline" | "busy" | "away";
  email?: string;
  phone?: string;
  tags?: string[];
  assignedTo?: string;
  // GHL user ids that watch this contact. Local-only on the backend (see
  // followersStore). Always present (possibly empty) so consumers don't have
  // to handle `undefined`.
  followers?: string[];
  // Family / dependent links — local-only, populated by fetchLeadBundle
  // for the active contact only. Undefined when the bootstrap is loading
  // or the contact has no links yet.
  familyMembers?: FamilyMember[];
  dnd?: {
    email: boolean;
    sms: boolean;
    whatsapp: boolean;
    calls: boolean;
  };
};

// Staff/agent picker entry — populated from the backend bootstrap payload's
// `users` array. Used by the Propietario / Seguidores dropdowns.
export type AgentUser = {
  id: string;
  name: string;
  avatar?: string;
};

// Location-level tag library entry — populates the "Etiquetas"
// autocomplete in ContactSidebar. Comes from the bootstrap payload.
export type TagSummary = {
  id: string;
  name: string;
};

export type MessageButton = {
  id: string;
  text: string;
  // Meta WhatsApp button type. QUICK_REPLY renders as a plain action
  // pill; URL / PHONE_NUMBER turn the pill into an anchor so the agent
  // can preview what the recipient will tap. Anything else falls back
  // to the QUICK_REPLY rendering.
  type?: "QUICK_REPLY" | "URL" | "PHONE_NUMBER" | "COPY_CODE" | "OTP" | string;
  url?: string;
  phoneNumber?: string;
};

export type Message = {
  id: string;
  // Echo of the optimistic id the SPA assigned when it sent this message.
  // Lets the listener dedupe an optimistic insert against the real WS / HTTP
  // echo of the same message even though the server-assigned `id` differs.
  clientId?: string;
  senderId: string;
  // Resolved from GHL's per-message userId (only on outbound messages). When
  // present the UI renders this agent's avatar/name instead of the generic
  // logged-in currentUser — so a shared inbox shows who actually sent what.
  senderName?: string;
  senderAvatar?: string;
  text: string;
  timestamp: string;
  // Raw ISO timestamp from GHL's `dateAdded`. The SPA uses this to group
  // messages by day for the "Hoy" / "Ayer" / "DD Mmm YYYY" separators.
  date?: string;
  isRead: boolean;
  channel?: "sms" | "email" | "whatsapp" | "instagram" | "messenger" | "tiktok" | "internal";
  status?: "sent" | "delivered" | "read" | "error";
  attachment?: {
    type: "image" | "video" | "file" | "audio" | "document" | "link";
    url: string;
    name: string;
    duration?: string;
    size?: string;
    description?: string;
    image?: string;
  };
  replyTo?: {
    id: string;
    text: string;
    sender: string;
  };
  mentions?: string[];
  reminder?: string;
  // For outbound WhatsApp messages sent as Meta-approved templates,
  // these identify which template the bubble came from. Set by the
  // backend's decorateMessages (see backend/src/store/sentTemplates.ts)
  // for messages that have been reconciled with a SentTemplate row,
  // and by the SPA's optimistic-send when the agent fires a template
  // through the schedule dialog. ChatMessageArea uses this to derive
  // `buttons` from the React Query templates cache when none are
  // attached yet.
  templateName?: string;
  templateLanguage?: string;
  buttons?: MessageButton[];
  systemEvent?:
    | {
        type: "opportunity_moved";
        opportunityName: string;
        oldStage: string;
        newStage: string;
        pipeline: string;
        // Set only when the move crossed pipelines (funnel-to-funnel).
        previousPipeline?: string;
        user: string;
      }
    | {
        type: "conversation_taken";
        // Empty string when unassigned.
        assignedToName: string;
        // Empty string when there was no previous owner.
        previousAssignedToName: string;
        // Empty string when GHL didn't tell us who triggered the change.
        user: string;
      }
    | {
        // GHL's bare TYPE_ACTIVITY_OPPORTUNITY entries — public API
        // returns just "Opportunity created/updated" without the
        // from→to detail shown in GHL's own UI. Rendered as a compact
        // pill so the agent at least sees the activity timeline.
        type: "opportunity_activity";
        action: "created" | "updated" | "deleted";
        opportunityName?: string;
        user: string;
      };
};

export type ScheduledMessage = {
  id: string;
  text: string;
  scheduledFor: string;
  channel: "sms" | "email" | "whatsapp" | "internal";
  // When the schedule was bound to a saved GHL template (mandatory for
  // WhatsApp once the 24h window has lapsed), the SPA records the id
  // and a friendly name so the banner can show "📝 Plantilla: <name>"
  // instead of the bland body text.
  templateId?: string;
  templateName?: string;
};

// Saved GHL location template / snippet ("plantilla"). Surfaced by the
// scheduling dialog as a dropdown. For WhatsApp templates sourced
// from Meta's /message_templates, `whatsappDetail` carries the full
// approval status / category / quality / structured component data
// so the dialog can render a faithful preview.
export type MessageTemplate = {
  id: string;
  name: string;
  type: "sms" | "whatsapp" | "email" | string;
  body: string;
  // BCP-47 tag ("es", "es_MX", "en_US"). Only set for Meta WhatsApp
  // templates — GHL snippets omit it. Forwarded to the schedule call
  // so the dispatcher knows which language to invoke on Meta.
  language?: string;
  whatsappDetail?: WhatsAppTemplateDetail;
};

// Mirror of backend `WhatsAppTemplateDetail` (see
// backend/src/types/domain.ts). Kept in sync manually — there is no
// shared package between frontend and backend.
export type WhatsAppTemplateDetail = {
  status?: string;
  category?: string;
  qualityScore?: {
    score?: string;
    reasons?: string[];
    date?: number;
  };
  rejectedReason?: string;
  previousCategory?: string;
  correctCategory?: string;
  parameterFormat?: string;
  messageSendTtlSeconds?: number;
  libraryTemplateName?: string;
  ctaUrlLinkTrackingOptedOut?: boolean;
  idInPartner?: string;
  components: WhatsAppTemplateComponent[];
};

export type WhatsAppTemplateComponent = {
  type: string;
  format?: string;
  text?: string;
  example?: {
    headerText?: string[];
    headerHandle?: string[];
    bodyText?: string[][];
    headerTextNamedParams?: Array<{ paramName: string; example: string }>;
    bodyTextNamedParams?: Array<{ paramName: string; example: string }>;
  };
  buttons?: WhatsAppTemplateButton[];
  addSecurityRecommendation?: boolean;
  codeExpirationMinutes?: number;
};

export type WhatsAppTemplateButton = {
  type: string;
  text?: string;
  url?: string;
  phoneNumber?: string;
  example?: string[];
  flowId?: string;
  flowAction?: string;
  navigateScreen?: string;
  otpType?: string;
  autofillText?: string;
  packageName?: string;
  signatureHash?: string;
  zeroTapTermsAccepted?: boolean;
};

export type Conversation = {
  id: string;
  contactId?: string;
  participant: User;
  source: "whatsapp" | "instagram" | "messenger" | "tiktok" | "sms" | "email";
  stage?: string;
  recipientNumber: string;
  lastMessage: string;
  unreadCount: number;
  // Display-only formatted time ("01:48 PM"). Use `lastMessageAt` (ISO) for
  // any date-range comparison.
  timestamp: string;
  // ISO timestamp of the last message — drives the date-range filter
  // (Hoy / Ayer / Esta Semana / …). May be missing for stub / never-messaged
  // conversations.
  lastMessageAt?: string;
  // Direction of the most recent message — drives the
  // "Dirección del último mensaje" advanced filter.
  lastMessageDirection?: "inbound" | "outbound";
  messages: Message[];
  isFavorite?: boolean;
  // Local archive flag. Archived conversations are hidden from the inbox
  // until the user unarchives them. GHL has no native archived bit, so
  // this resets on backend restart (lives in the in-memory flagsStore).
  isArchived?: boolean;
  activeReminder?: string;
  scheduledMessages?: ScheduledMessage[];
  // Stack of pinned messages ("cintillos superiores"). Local-only —
  // not modelled by GHL. Each entry renders as its own banner above
  // the message list and is clickable to scroll to the message.
  pinnedMessages?: Array<{
    id: string;
    text: string;
    date?: string;
    senderName?: string;
    channel?: string;
    pinnedAt: number;
  }>;
  messagesHasMore?: boolean;
  messagesOldestId?: string;
  // AI bot (Conversation AI) state for the contact. "paused" hides the
  // bot's auto-replies; toggled via the Activo/Pausado control in the
  // composer, which fires the GHL bot-status workflow.
  botStatus?: "active" | "paused";
};

export type Pipeline = {
  id: string;
  name: string;
  stages: { id: string; label: string; color: string }[];
};

export type Opportunity = {
  id: string;
  name: string;
  pipelineId: string;
  stageId: string;
  contactId: string;
  monetaryValue?: number;
  status: "open" | "won" | "lost" | "abandoned";
  source: string;
  date: string;
  assignedTo?: string;
};

export type FilterCondition = {
  id: string;
  field: string;
  operator: string;
  value: string;
};

export type SavedView = {
  id: string;
  name: string;
  filters: FilterCondition[];
  logic: "AND" | "OR";
};

export type Task = {
  id: string;
  title: string;
  dueDate: string;
  assignee: {
    name: string;
    avatar?: string;
  };
  contact: {
    name: string;
    avatar?: string;
  };
  status: "pending" | "completed";
  conversationId: string;
};

export type LeadBundle = {
  contactId: string;
  contact: User;
  conversation: Conversation | null;
  tasks: Task[];
};
