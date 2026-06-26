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
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

// A persistent free-form "Nota" for a contact, shown in the right panel.
// Rich-text via contentEditable + execCommand (B/U/I/S, lists, undo/redo).
// Autosaves on blur and via the Save button; loads on contact change.
export function ContactNote({ contactId }: { contactId: string }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  const [empty, setEmpty] = useState(true);
  // The last value we persisted — to skip no-op saves on blur.
  const lastSavedRef = useRef<string>("");

  // Load the note whenever the contact changes.
  useEffect(() => {
    if (!contactId) return;
    let cancelled = false;
    setLoading(true);
    api.contacts
      .getNote(contactId)
      .then((r) => {
        if (cancelled) return;
        const html = r.note ?? "";
        lastSavedRef.current = html;
        if (editorRef.current) editorRef.current.innerHTML = html;
        setEmpty(!html.replace(/<[^>]*>/g, "").trim());
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
    // execCommand is deprecated but still the simplest cross-browser way to
    // format a contentEditable region; adequate for a note field.
    document.execCommand(command, false);
    if (editorRef.current) {
      setEmpty(!editorRef.current.innerText.trim());
    }
  }, []);

  const save = useCallback(async () => {
    if (!contactId || !editorRef.current) return;
    const html = editorRef.current.innerHTML;
    if (html === lastSavedRef.current) return;
    setSaving(true);
    try {
      await api.contacts.saveNote(contactId, html);
      lastSavedRef.current = html;
      setSavedTick(true);
      window.setTimeout(() => setSavedTick(false), 1500);
    } catch {
      /* keep the text in the editor; the agent can retry */
    } finally {
      setSaving(false);
    }
  }, [contactId]);

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
      // onMouseDown (not onClick) so the editor keeps its selection.
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      className="flex h-7 w-7 items-center justify-center rounded text-amber-900/70 transition-colors hover:bg-amber-900/10 hover:text-amber-900"
    >
      {children}
    </button>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Nota</h3>
        <button
          type="button"
          onClick={save}
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

      <div className="overflow-hidden rounded-lg border border-amber-200/70 bg-[#FFFBEB] dark:border-amber-500/30 dark:bg-amber-900/15">
        <div className="flex flex-wrap items-center gap-0.5 border-b border-amber-200/70 bg-amber-100/60 px-1.5 py-1 dark:border-amber-500/30 dark:bg-amber-900/25">
          <ToolbarButton onClick={() => exec("bold")} title="Negrita">
            <Bold className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton onClick={() => exec("underline")} title="Subrayado">
            <Underline className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton onClick={() => exec("italic")} title="Cursiva">
            <Italic className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton onClick={() => exec("strikeThrough")} title="Tachado">
            <Strikethrough className="h-3.5 w-3.5" />
          </ToolbarButton>
          <span className="mx-1 h-4 w-px bg-amber-900/15" />
          <ToolbarButton onClick={() => exec("insertUnorderedList")} title="Lista">
            <List className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton onClick={() => exec("insertOrderedList")} title="Lista numerada">
            <ListOrdered className="h-3.5 w-3.5" />
          </ToolbarButton>
          <span className="mx-1 h-4 w-px bg-amber-900/15" />
          <ToolbarButton onClick={() => exec("undo")} title="Deshacer">
            <Undo2 className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton onClick={() => exec("redo")} title="Rehacer">
            <Redo2 className="h-3.5 w-3.5" />
          </ToolbarButton>
        </div>

        <div className="relative">
          {empty && !loading && (
            <span className="pointer-events-none absolute left-3 top-2 text-sm text-amber-900/40">
              Escribe una nota…
            </span>
          )}
          <div
            ref={editorRef}
            contentEditable={!loading}
            suppressContentEditableWarning
            onInput={(e) =>
              setEmpty(!(e.currentTarget as HTMLDivElement).innerText.trim())
            }
            onBlur={save}
            className={cn(
              "min-h-[96px] w-full px-3 py-2 text-sm leading-relaxed text-amber-950 outline-none dark:text-amber-100",
              "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
            )}
          />
        </div>
      </div>
    </div>
  );
}
