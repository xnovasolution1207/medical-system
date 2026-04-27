export type User = {
  id: string;
  name: string;
  avatar?: string;
  status: "online" | "offline" | "busy" | "away";
  email?: string;
  phone?: string;
  tags?: string[];
  assignedTo?: string;
  dnd?: {
    email: boolean;
    sms: boolean;
    whatsapp: boolean;
    calls: boolean;
  };
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
  systemEvent?: {
    type: "opportunity_moved";
    opportunityName: string;
    oldStage: string;
    newStage: string;
    pipeline: string;
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
  stage: string;
  recipientNumber: string;
  lastMessage: string;
  unreadCount: number;
  timestamp: string;
  messages: Message[];
  isFavorite?: boolean;
  activeReminder?: string;
  scheduledMessages?: ScheduledMessage[];
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
