import { Conversation, User, Task } from "./types";

export const currentUser: User = {
  id: "u1",
  name: "Agente de Ventas",
  status: "online",
};

const firstNames = ["Juan", "María", "Pedro", "Lucía", "Carlos", "Ana", "Luis", "Elena", "Diego", "Carmen", "Jorge", "Laura", "Miguel", "Sofía", "David", "Valeria", "Fernando", "Isabella", "Ricardo", "Camila", "Andrés", "Valentina", "Roberto", "Daniela", "Hugo", "Mariana", "Alejandro", "Gabriela", "Emilio", "Julieta"];
const lastNames = ["García", "Martínez", "López", "González", "Pérez", "Rodríguez", "Sánchez", "Ramírez", "Cruz", "Flores", "Gómez", "Díaz", "Reyes", "Morales", "Ortiz", "Castillo"];
const sources: ("whatsapp" | "instagram" | "messenger" | "tiktok")[] = ["whatsapp", "instagram", "messenger", "tiktok"];
const stages: string[] = ["caliente", "tibio", "agendado", "frio"];

const avatars = {
  whatsapp: "https://upload.wikimedia.org/wikipedia/commons/6/6b/WhatsApp.svg",
  instagram: "https://upload.wikimedia.org/wikipedia/commons/e/e7/Instagram_logo_2016.svg",
  messenger: "https://upload.wikimedia.org/wikipedia/commons/b/be/Facebook_Messenger_logo_2020.svg",
  tiktok: "https://upload.wikimedia.org/wikipedia/commons/3/34/Ionicons_logo-tiktok.svg"
};

const messageTemplates = [
  "¿Tienen envíos a domicilio?",
  "Me interesa el producto que publicaron hoy.",
  "¿Cuál es el precio de la promoción?",
  "Quiero agendar una cita para mañana.",
  "Gracias, lo reviso y les aviso. Si tengo dudas les escribo más tarde.",
  "¿Aceptan tarjeta de crédito o solo transferencia?",
  "¡Excelente servicio! Muchas gracias por la atención tan rápida.",
  "Necesito más información sobre los planes mensuales, por favor.",
  "¿Tienen sucursales en Monterrey o solo tienda en línea?",
  "Ya realicé el pago, envío comprobante en un momento.",
  "¿A qué hora cierran hoy? Quiero pasar a recoger mi pedido.",
  "Me encantó el video de TikTok, ¿cómo puedo comprar el producto que mostraron?",
  "Hola, vi su anuncio en Facebook y me gustaría saber más.",
  "¿Tienen disponibilidad para este fin de semana?",
  "¿Cuánto tarda en llegar si pido hoy mismo?",
  "Me gustaría una demostración del software antes de comprar.",
  "¿Tienen alguna promoción por el Buen Fin?",
  "Hola, ¿pueden enviarme el catálogo completo por PDF?",
  "¿El precio ya incluye IVA?",
  "Quiero cancelar mi pedido, ¿cuál es el proceso?"
];

const generateConversations = (count: number): Conversation[] => {
  const conversations: Conversation[] = [];

  for (let i = 0; i < count; i++) {
    const source = sources[Math.floor(Math.random() * sources.length)];
    const stage = stages[Math.floor(Math.random() * stages.length)];
    const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
    const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
    const lastMessage = messageTemplates[Math.floor(Math.random() * messageTemplates.length)];
    const unreadCount = Math.random() > 0.6 ? Math.floor(Math.random() * 5) + 1 : 0;
    
    let recipientNumber = "";
    if (source === "whatsapp") recipientNumber = `+52 55 ${Math.floor(1000 + Math.random() * 9000)} ${Math.floor(1000 + Math.random() * 9000)}`;
    else if (source === "instagram") recipientNumber = `@cuenta_oficial`;
    else if (source === "tiktok") recipientNumber = `@tienda_tiktok`;
    else recipientNumber = "Página Principal";

    const hour = Math.floor(Math.random() * 12) + 1;
    const minute = Math.floor(Math.random() * 60).toString().padStart(2, "0");
    const ampm = Math.random() > 0.5 ? "AM" : "PM";
    const timestamp = `${hour}:${minute} ${ampm}`;

    conversations.push({
      id: `c_gen_${i}`,
      participant: {
        id: `u_gen_${i}`,
        name: `${firstName} ${lastName}`,
        status: Math.random() > 0.7 ? "online" : Math.random() > 0.5 ? "offline" : "busy",
      },
      source,
      stage,
      recipientNumber,
      lastMessage,
      unreadCount,
      timestamp,
      messages: [
        {
          id: `m_gen_${i}_1`,
          senderId: `u_gen_${i}`,
          text: lastMessage,
          timestamp,
          isRead: unreadCount === 0,
        }
      ],
    });
  }

  return conversations;
};

// Start with the specific ones for context, then add the generated ones
export const mockConversations: Conversation[] = [
  {
    id: "c_showcase",
    participant: {
      id: "u_showcase",
      name: "Demo de Mensajes",
      status: "online",
      email: "demo@example.com",
      phone: "+52 55 9999 8888",
      tags: ["Demo", "VIP"],
      assignedTo: "Agente de Ventas",
      dnd: { email: false, sms: false, whatsapp: false, calls: false }
    },
    source: "whatsapp",
    stage: "caliente",
    recipientNumber: "+52 55 9999 8888",
    lastMessage: "Este es un showcase de todos los tipos de mensajes.",
    unreadCount: 1,
    timestamp: "Ahora",
    messages: [
      { id: "ms1", senderId: "u_showcase", text: "Hola, este es un mensaje normal.", timestamp: "10:00 AM", isRead: true, channel: "whatsapp" },
      { id: "ms2", senderId: "u1", text: "¿Qué opción prefieres?", timestamp: "10:01 AM", isRead: true, channel: "whatsapp", buttons: [{id:"b1", text:"Opción A"}, {id:"b2", text:"Opción B"}] },
      { id: "ms3", senderId: "u_showcase", text: "Prefiero la opción A.", timestamp: "10:02 AM", isRead: true, channel: "whatsapp", replyTo: { id: "ms2", text: "¿Qué opción prefieres?", sender: "Agente de Ventas" } },
      { id: "ms4", senderId: "u_showcase", text: "", timestamp: "10:03 AM", isRead: true, channel: "whatsapp", attachment: { type: "audio", url: "#", name: "Audio", duration: "0:45" } },
      { id: "ms4_1", senderId: "u1", text: "", timestamp: "10:03 AM", isRead: true, channel: "whatsapp", attachment: { type: "audio", url: "#", name: "Audio", duration: "1:12" } },
      { id: "ms5", senderId: "u1", text: "", timestamp: "10:04 AM", isRead: true, channel: "whatsapp", attachment: { type: "image", url: "https://vibe.filesafe.space/1775496773503715528/assets/5eea1bd8-c4c4-4bc7-9c38-84553493817e.png", name: "image.jpg" } },
      { id: "ms6", senderId: "u1", text: "Aquí tienes el comprobante de la transferencia.", timestamp: "10:05 AM", isRead: true, channel: "whatsapp", attachment: { type: "image", url: "https://vibe.filesafe.space/1775496773503715528/assets/2902d8d5-9441-440f-8151-cd394837185b.png", name: "receipt.jpg" } },
      { id: "ms7", senderId: "u1", text: "Este mensaje falló al enviarse por falta de conexión.", timestamp: "10:06 AM", isRead: true, channel: "whatsapp", status: "error" },
      { id: "ms8", senderId: "u_showcase", text: "También puedes responder a cualquier mensaje pasando el ratón sobre él y haciendo clic en la flecha de responder.", timestamp: "10:07 AM", isRead: false, channel: "whatsapp" },
      { id: "ms9", senderId: "u1", text: "Aquí tienes el documento que solicitaste.", timestamp: "10:08 AM", isRead: true, channel: "whatsapp", attachment: { type: "document", url: "#", name: "Reporte_Mensual.pdf", size: "1.2 MB" } },
      { id: "ms10", senderId: "u_showcase", text: "Gracias, te envío también mi currículum.", timestamp: "10:09 AM", isRead: false, channel: "whatsapp", attachment: { type: "document", url: "#", name: "Curriculum_Vitae.pdf", size: "850 KB" } },
      { id: "ms11", senderId: "u1", text: "Mira este artículo interesante sobre nuestro nuevo diseño:", timestamp: "10:10 AM", isRead: true, channel: "whatsapp", attachment: { type: "link", url: "https://vibe.us", name: "Vibe - Modern Design System", description: "Explora nuestra nueva biblioteca de componentes y sistema de diseño para crear interfaces hermosas y accesibles.", image: "https://vibe.filesafe.space/1775496773503715528/assets/84d33131-c7a8-4f52-998d-238e0870bd7b.jpg" } },
      { 
        id: "ms12", 
        senderId: "system", 
        text: "", 
        timestamp: "Hace 2 horas", 
        isRead: true, 
        channel: "internal",
        systemEvent: {
          type: "opportunity_moved",
          opportunityName: "Mariel HP.",
          oldStage: "Leads Nuevos",
          newStage: "Calientes",
          pipeline: "Clientes Potenciales",
          user: "Agente de Ventas"
        }
      },
      { 
        id: "ms13", 
        senderId: "system", 
        text: "", 
        timestamp: "Hace 1 hora", 
        isRead: true, 
        channel: "internal",
        systemEvent: {
          type: "opportunity_moved",
          opportunityName: "Carlos M.",
          oldStage: "Calientes",
          newStage: "Agendados",
          pipeline: "Ventas B2B",
          user: "María González"
        }
      },
      { 
        id: "ms14", 
        senderId: "system", 
        text: "", 
        timestamp: "Hace 15 minutos", 
        isRead: true, 
        channel: "internal",
        systemEvent: {
          type: "opportunity_moved",
          opportunityName: "Empresa XYZ",
          oldStage: "En Negociación",
          newStage: "Cerrado Ganado",
          pipeline: "Ventas Corporativas",
          user: "Carlos López"
        }
      },
      { 
        id: "ms15", 
        senderId: "system", 
        text: "", 
        timestamp: "Hace 9 minutos", 
        isRead: true, 
        channel: "internal",
        systemEvent: {
          type: "opportunity_moved",
          opportunityName: "Proyecto Alpha",
          oldStage: "Propuesta Enviada",
          newStage: "En Revisión",
          pipeline: "Servicios",
          user: "Agente de Ventas"
        }
      }
    ]
  },
  {
    id: "c1",
    participant: {
      id: "u2",
      name: "Carlos Mendoza",
      status: "online",
      email: "carlos.mendoza@example.com",
      phone: "+52 55 1234 5678",
      tags: ["VIP", "Nuevo Lead", "Interesado"],
      assignedTo: "Agente de Ventas",
      dnd: { email: false, sms: false, whatsapp: false, calls: false }
    },
    source: "whatsapp",
    stage: "caliente",
    recipientNumber: "+52 55 1234 5678",
    lastMessage: "¿A dónde puedo transferir para cerrar la compra del paquete premium que me comentaste?",
    unreadCount: 2,
    timestamp: "10:42 AM",
    activeReminder: "20 Min",
    messages: [
      {
        id: "m1",
        senderId: "u2",
        text: "Hola, vi su anuncio en Facebook",
        timestamp: "10:30 AM",
        isRead: true,
        channel: "whatsapp"
      },
      {
        id: "m2",
        senderId: "u1",
        text: "¡Hola Carlos! Claro, ¿en qué producto estás interesado?",
        timestamp: "10:35 AM",
        isRead: true,
        channel: "whatsapp"
      },
      {
        id: "m3",
        senderId: "u2",
        text: "Me interesa el paquete premium. ¿Tienen disponibilidad?",
        timestamp: "10:40 AM",
        isRead: true,
        channel: "whatsapp"
      },
      {
        id: "m4",
        senderId: "u1",
        text: "Hola!\n\n¿Cómo estás? Es un gusto saludarte.\n\nTe escribimos para confirmar tu cita programada para el día de mañana en nuestra sede de San Miguel.\n\n**Quedamos atentos a tu confirmación.**\n\nTu sonrisa, nuestro orgullo",
        timestamp: "10:41 AM",
        isRead: true,
        channel: "whatsapp",
        buttons: [
          { id: "b1", text: "Confirmo mi cita" },
          { id: "b2", text: "Deseo reprogramar" }
        ]
      },
      {
        id: "m5",
        senderId: "u2",
        text: "¿A dónde puedo transferir para cerrar la compra del paquete premium que me comentaste?",
        timestamp: "10:42 AM",
        isRead: false,
        channel: "whatsapp"
      },
    ],
  },
  {
    id: "c2",
    participant: {
      id: "u3",
      name: "Ana Sofía",
      status: "offline",
      email: "ana.sofia@example.com",
      phone: "+52 55 8765 4321",
      tags: ["Agendado"],
      assignedTo: "Agente de Ventas",
      dnd: { email: false, sms: false, whatsapp: false, calls: false }
    },
    source: "instagram",
    stage: "agendado",
    recipientNumber: "@nuestra_cuenta",
    lastMessage: "Perfecto, nos vemos mañana en la videollamada. Tendré listas mis preguntas.",
    unreadCount: 0,
    timestamp: "Ayer",
    messages: [
      {
        id: "m5",
        senderId: "u3",
        text: "Me gustaría agendar una demostración.",
        timestamp: "Ayer 2:00 PM",
        isRead: true,
        channel: "instagram"
      },
      {
        id: "m6",
        senderId: "u1",
        text: "¡Con gusto! Tenemos espacio mañana a las 4 PM. ¿Te queda bien?",
        timestamp: "Ayer 2:15 PM",
        isRead: true,
        channel: "instagram"
      },
      {
        id: "m7",
        senderId: "u3",
        text: "Perfecto, nos vemos mañana en la videollamada. Tendré listas mis preguntas.",
        timestamp: "Ayer 2:20 PM",
        isRead: true,
        channel: "instagram"
      },
    ],
  },
  {
    id: "c3",
    participant: {
      id: "u4",
      name: "Luis Torres",
      status: "busy",
      email: "luis.torres@example.com",
      phone: "+52 55 1111 2222",
      tags: ["B2B", "Seguimiento"],
      assignedTo: "Agente de Ventas",
      dnd: { email: false, sms: false, whatsapp: false, calls: false }
    },
    source: "messenger",
    stage: "tibio",
    recipientNumber: "Página Principal",
    lastMessage: "Voy a revisarlo con mi socio y les aviso en cuanto tengamos una decisión.",
    unreadCount: 1,
    timestamp: "9:15 AM",
    messages: [
      {
        id: "m8",
        senderId: "u4",
        text: "Voy a revisarlo con mi socio y les aviso en cuanto tengamos una decisión.",
        timestamp: "9:15 AM",
        isRead: false,
        channel: "messenger"
      },
    ],
  },
  {
    id: "c4",
    participant: {
      id: "u5",
      name: "Valeria Ruiz",
      status: "online",
      email: "valeria.ruiz@example.com",
      phone: "+52 55 3333 4444",
      tags: ["TikTok Lead"],
      assignedTo: "Agente de Ventas",
      dnd: { email: false, sms: false, whatsapp: false, calls: false }
    },
    source: "tiktok",
    stage: "caliente",
    recipientNumber: "@tienda_tiktok",
    lastMessage: "¡Me encantó el video que subieron hoy! ¿Cómo puedo comprar el producto que mostraron al final?",
    unreadCount: 3,
    timestamp: "10:50 AM",
    messages: [
      {
        id: "m9",
        senderId: "u5",
        text: "¡Hola!",
        timestamp: "10:48 AM",
        isRead: false,
        channel: "tiktok"
      },
      {
        id: "m10",
        senderId: "u5",
        text: "¡Me encantó el video que subieron hoy! ¿Cómo puedo comprar el producto que mostraron al final?",
        timestamp: "10:50 AM",
        isRead: false,
        channel: "tiktok"
      },
    ],
  },
  ...generateConversations(35)
];

const generateTasks = (): Task[] => {
  const tasks: Task[] = [];
  const categories = [
    { date: "Hoy, 10:00 AM", status: "pending" },
    { date: "Ayer, 15:30 PM", status: "pending" },
    { date: "Mañana, 09:00 AM", status: "pending" },
    { date: "Hoy, 11:00 AM", status: "completed" },
  ];

  let idCounter = 1;
  categories.forEach((cat) => {
    for (let i = 0; i < 10; i++) {
      const contactName = `${firstNames[Math.floor(Math.random() * firstNames.length)]} ${lastNames[Math.floor(Math.random() * lastNames.length)]}`;
      const assigneeName = i % 2 === 0 ? "Agente de Ventas" : "María González";
      const assigneeAvatar = i % 2 === 0 ? undefined : "https://i.pravatar.cc/150?u=a2";
      
      const titles = [
        "Llamar para seguimiento de cotización",
        "Enviar propuesta comercial actualizada",
        "Revisar documentos enviados por el cliente",
        "Confirmar asistencia a la reunión",
        "Preparar demo del producto",
        "Actualizar datos de facturación",
        "Enviar catálogo de nueva temporada",
        "Responder dudas técnicas",
        "Verificar pago recibido",
        "Agendar llamada de onboarding"
      ];
      
      tasks.push({
        id: `t${idCounter++}`,
        title: titles[i % titles.length],
        dueDate: cat.date,
        assignee: { name: assigneeName, avatar: assigneeAvatar },
        contact: { name: contactName },
        status: cat.status as "pending" | "completed",
        conversationId: `c_gen_${Math.floor(Math.random() * 35)}`,
      });
    }
  });

  return tasks;
};

export const mockTasks: Task[] = generateTasks();