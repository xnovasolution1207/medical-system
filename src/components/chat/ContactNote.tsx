import { useEffect, useRef, useState, useCallback } from "react";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  Undo2,
  Redo2,
  Save,
  Check,
  Loader2,
  Palette,
  Paperclip,
  X,
  FileIcon,
} from "lucide-react";
import { api, ContactNoteData, proxyMediaUrl } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// Sticky-note color themes: [trigger swatch, body bg, toolbar bg, border, text].
const NOTE_COLORS: Record<
  string,
  { swatch: string; body: string; bar: string; border: string; text: string }
> = {
  yellow: { swatch: "#FACC15", body: "bg-[#FFFBEB] dark:bg-amber-900/15", bar: "bg-amber-100/60 dark:bg-amber-900/25", border: "border-amber-200/70 dark:border-amber-500/30", text: "text-amber-950 dark:text-amber-100" },
  green: { swatch: "#4ADE80", body: "bg-[#F0FDF4] dark:bg-emerald-900/15", bar: "bg-emerald-100/60 dark:bg-emerald-900/25", border: "border-emerald-200/70 dark:border-emerald-500/30", text: "text-emerald-950 dark:text-emerald-100" },
  blue: { swatch: "#60A5FA", body: "bg-[#EFF6FF] dark:bg-blue-900/15", bar: "bg-blue-100/60 dark:bg-blue-900/25", border: "border-blue-200/70 dark:border-blue-500/30", text: "text-blue-950 dark:text-blue-100" },
  pink: { swatch: "#F472B6", body: "bg-[#FDF2F8] dark:bg-pink-900/15", bar: "bg-pink-100/60 dark:bg-pink-900/25", border: "border-pink-200/70 dark:border-pink-500/30", text: "text-pink-950 dark:text-pink-100" },
  orange: { swatch: "#FB923C", body: "bg-[#FFF7ED] dark:bg-orange-900/15", bar: "bg-orange-100/60 dark:bg-orange-900/25", border: "border-orange-200/70 dark:border-orange-500/30", text: "text-orange-950 dark:text-orange-100" },
  purple: { swatch: "#A78BFA", body: "bg-[#F5F3FF] dark:bg-violet-900/15", bar: "bg-violet-100/60 dark:bg-violet-900/25", border: "border-violet-200/70 dark:border-violet-500/30", text: "text-violet-950 dark:text-violet-100" },
};

// A persistent free-form "Nota" for a contact: rich text (B/U/I/S, lists,
// undo/redo) + a sticky color + file attachments. Autosaves on blur and via the
// Save button; loads on contact change.
export function ContactNote({ contactId }: { contactId: string }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  const [empty, setEmpty] = useState(true);
  const [color, setColor] = useState<string>("yellow");
  const [attachments, setAttachments] = useState<
    NonNullable<ContactNoteData["attachments"]>
  >([]);
  // Latest persisted snapshot (string) to skip no-op saves.
  const lastSavedRef = useRef<string>("");
  const theme = NOTE_COLORS[color] ?? NOTE_COLORS.yellow;

  const snapshot = useCallback(
    (): ContactNoteData => ({
      html: editorRef.current?.innerHTML ?? "",
      color,
      attachments,
    }),
    [color, attachments]
  );

  // Load the note whenever the contact changes.
  useEffect(() => {
    if (!contactId) return;
    let cancelled = false;
    setLoading(true);
    api.contacts
      .getNote(contactId)
      .then((r) => {
        if (cancelled) return;
        const note = r.note ?? { html: "", color: "yellow", attachments: [] };
        const html = note.html ?? "";
        setColor(note.color || "yellow");
        setAttachments(note.attachments ?? []);
        if (editorRef.current) editorRef.current.innerHTML = html;
        setEmpty(!html.replace(/<[^>]*>/g, "").trim());
        lastSavedRef.current = JSON.stringify({
          html,
          color: note.color || "yellow",
          attachments: note.attachments ?? [],
        });
      })
      .catch(() => {
        if (!cancelled && editorRef.current) editorRef.current.innerHTML = "";
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  const exec = useCallback((command: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false);
    if (editorRef.current) setEmpty(!editorRef.current.innerText.trim());
  }, []);

  const save = useCallback(
    async (next?: Partial<ContactNoteData>) => {
      if (!contactId) return;
      const data: ContactNoteData = { ...snapshot(), ...next };
      const serialized = JSON.stringify(data);
      if (serialized === lastSavedRef.current) return;
      setSaving(true);
      try {
        await api.contacts.saveNote(contactId, data);
        lastSavedRef.current = serialized;
        setSavedTick(true);
        window.setTimeout(() => setSavedTick(false), 1500);
      } catch {
        /* keep the text; agent can retry */
      } finally {
        setSaving(false);
      }
    },
    [contactId, snapshot]
  );

  const pickColor = (c: string) => {
    setColor(c);
    void save({ color: c });
  };

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || !contactId) return;
    setUploading(true);
    try {
      const added: NonNullable<ContactNoteData["attachments"]> = [];
      for (const file of Array.from(files)) {
        const up = await api.contacts.uploadNoteAttachment(contactId, file);
        added.push({ url: up.url, name: up.name, type: up.type });
      }
      const nextAttachments = [...attachments, ...added];
      setAttachments(nextAttachments);
      void save({ attachments: nextAttachments });
    } catch {
      /* swallow — best effort */
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeAttachment = (url: string) => {
    const next = attachments.filter((a) => a.url !== url);
    setAttachments(next);
    void save({ attachments: next });
  };

  const ToolbarButton = ({
    onClick,
    title,
    children,
  }: {
    onClick: () => void;
    title: string;
    children: React.ReactNode;
  }) => (
    <button
      type="button"
      title={title}
      aria-label={title}
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-black/5 dark:hover:bg-white/10",
        theme.text,
        "opacity-70 hover:opacity-100"
      )}
    >
      {children}
    </button>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Nota</h3>
        <div className="flex items-center gap-0.5">
          {/* Color */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                title="Color de la nota"
                aria-label="Color de la nota"
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Palette className="h-4 w-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-auto p-2">
              <div className="flex gap-1.5">
                {Object.entries(NOTE_COLORS).map(([key, c]) => (
                  <button
                    key={key}
                    type="button"
                    aria-label={key}
                    onClick={() => pickColor(key)}
                    className={cn(
                      "h-6 w-6 rounded-full border transition-transform hover:scale-110",
                      color === key ? "ring-2 ring-offset-1 ring-foreground/40" : "border-black/10"
                    )}
                    style={{ backgroundColor: c.swatch }}
                  />
                ))}
              </div>
            </PopoverContent>
          </Popover>
          {/* Attach */}
          <button
            type="button"
            title="Adjuntar archivo"
            aria-label="Adjuntar archivo"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => onFiles(e.target.files)}
          />
          {/* Save */}
          <button
            type="button"
            onClick={() => save()}
            disabled={saving}
            title="Guardar nota"
            aria-label="Guardar nota"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : savedTick ? (
              <Check className="h-4 w-4 text-emerald-600" />
            ) : (
              <Save className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      <div className={cn("overflow-hidden rounded-lg border", theme.border, theme.body)}>
        <div className={cn("flex flex-wrap items-center gap-0.5 border-b px-1.5 py-1", theme.border, theme.bar)}>
          <ToolbarButton onClick={() => exec("bold")} title="Negrita"><Bold className="h-3.5 w-3.5" /></ToolbarButton>
          <ToolbarButton onClick={() => exec("underline")} title="Subrayado"><Underline className="h-3.5 w-3.5" /></ToolbarButton>
          <ToolbarButton onClick={() => exec("italic")} title="Cursiva"><Italic className="h-3.5 w-3.5" /></ToolbarButton>
          <ToolbarButton onClick={() => exec("strikeThrough")} title="Tachado"><Strikethrough className="h-3.5 w-3.5" /></ToolbarButton>
          <span className="mx-1 h-4 w-px bg-current opacity-15" />
          <ToolbarButton onClick={() => exec("insertUnorderedList")} title="Lista"><List className="h-3.5 w-3.5" /></ToolbarButton>
          <ToolbarButton onClick={() => exec("insertOrderedList")} title="Lista numerada"><ListOrdered className="h-3.5 w-3.5" /></ToolbarButton>
          <span className="mx-1 h-4 w-px bg-current opacity-15" />
          <ToolbarButton onClick={() => exec("undo")} title="Deshacer"><Undo2 className="h-3.5 w-3.5" /></ToolbarButton>
          <ToolbarButton onClick={() => exec("redo")} title="Rehacer"><Redo2 className="h-3.5 w-3.5" /></ToolbarButton>
        </div>

        <div className="relative">
          {empty && !loading && (
            <span className="pointer-events-none absolute left-3 top-2 text-sm opacity-40">
              Escribe una nota…
            </span>
          )}
          <div
            ref={editorRef}
            contentEditable={!loading}
            suppressContentEditableWarning
            onInput={(e) => setEmpty(!(e.currentTarget as HTMLDivElement).innerText.trim())}
            onBlur={() => save()}
            className={cn(
              "min-h-[96px] w-full px-3 py-2 text-sm leading-relaxed outline-none",
              theme.text,
              "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
            )}
          />
        </div>

        {attachments.length > 0 && (
          <div className={cn("space-y-1 border-t px-2 py-1.5", theme.border)}>
            {attachments.map((a) => (
              <div
                key={a.url}
                className="group flex items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-black/5 dark:hover:bg-white/10"
              >
                {a.type?.startsWith("image/") ? (
                  <img
                    src={proxyMediaUrl(a.url)}
                    alt={a.name}
                    className="h-7 w-7 shrink-0 rounded object-cover"
                  />
                ) : (
                  <FileIcon className={cn("h-4 w-4 shrink-0", theme.text)} />
                )}
                <a
                  href={proxyMediaUrl(a.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn("flex-1 truncate hover:underline", theme.text)}
                  title={a.name}
                >
                  {a.name}
                </a>
                <button
                  type="button"
                  onClick={() => removeAttachment(a.url)}
                  className="opacity-0 transition-opacity group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                  aria-label={`Quitar ${a.name}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
