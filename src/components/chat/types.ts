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

export type MessageButton = {
  id: string;
  text: string;
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
      };
};

export type ScheduledMessage = {
  id: string;
  text: string;
  scheduledFor: string;
  channel: "sms" | "email" | "whatsapp" | "internal";
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
