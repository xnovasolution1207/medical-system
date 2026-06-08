// Canonical pill-style tab classes, shared by every TabsList / TabsTrigger in
// the app so the inbox filter tabs (No leídos / Todos / …), the composer
// channel tabs (WhatsApp / Comentarios Interno / …), and the contact-sidebar
// document tabs (Imagen / Doc / …) all look identical. Pair TAB_LIST_CLASS on
// the <TabsList> with TAB_TRIGGER_CLASS on each <TabsTrigger>, layering any
// context-specific layout (flex-1, grid sizing, font size) on top via cn().
//
// Shape: rounded-full track + pills. Active: white pill in light mode,
// slate-600 in dark, with a subtle shadow. Inactive: muted slate text.
export const TAB_LIST_CLASS =
  "bg-slate-100 dark:bg-black/20 rounded-full p-1 h-auto";

export const TAB_TRIGGER_CLASS =
  "rounded-full py-1.5 font-medium text-slate-500 dark:text-slate-400 transition-all " +
  "data-[state=active]:bg-white dark:data-[state=active]:bg-slate-600 " +
  "data-[state=active]:text-slate-900 dark:data-[state=active]:text-white " +
  "data-[state=active]:shadow-sm";
