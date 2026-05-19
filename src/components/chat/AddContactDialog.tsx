import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

// Shared "Agregar contacto" modal. Originally lived inlined in
// OpportunitiesView; ChatSidebar's "+ Agregar contacto" entry now
// reuses the same surface so a contact created from either place
// captures the full set of fields (name/phone/email + address /
// birthdate / document + family links + optional opportunity stage).
//
// Persistence reality check: GHL's createContact accepts name / phone
// / email. Address, birthdate and document fields are captured for
// parity with the design but currently dropped on submit until the
// backend wires the matching GHL custom-field plumbing. Family links
// and the optional opportunity create both run after the contact is
// created and surface their own errors via console.warn so they
// can't block the primary "contact added" path.

type FamilyRelationship = "hijo" | "padre" | "esposo" | "hermano" | "otro";

type DraftFamily = {
  name: string;
  phone: string;
  relationship: FamilyRelationship;
};

const FAMILY_REL_LABELS: Record<FamilyRelationship, string> = {
  hijo: "Hijo / Hija",
  padre: "Padre / Madre",
  esposo: "Esposo / Esposa",
  hermano: "Hermano / Hermana",
  otro: "Otro",
};

interface AddContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // GHL contact creation hook. Returns the new contact id so the
  // modal can chain family links and an opportunity create. Required;
  // the modal falls back to a toast if the parent doesn't supply it.
  onCreateContact?: (payload: {
    name?: string;
    phone?: string;
    email?: string;
  }) => Promise<{ id: string } | null> | { id: string } | null;
  // Optional opportunity hook. When the operator picks an
  // "Etapa de oportunidad" we POST an opportunity tied to the new
  // contact. Omit to hide nothing — the field is always visible, just
  // ignored at submit time if undefined.
  onCreateOpportunity?: (payload: {
    name: string;
    contactId: string;
    pipelineId: string;
    stageId: string;
    monetaryValue?: number;
  }) => void | Promise<void>;
  // Active pipeline id. Required to chain the opportunity create;
  // without it the stage select still renders but no opportunity row
  // is written.
  pipelineId?: string;
  // Pipeline stages used by the "Etapa de oportunidad" picker. Empty
  // list renders an explanatory message inside the dropdown.
  stages?: { id: string; label: string; color?: string }[];
}

export function AddContactDialog({
  open,
  onOpenChange,
  onCreateContact,
  onCreateOpportunity,
  pipelineId,
  stages = [],
}: AddContactDialogProps) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [birthdate, setBirthdate] = useState("");
  const [docType, setDocType] = useState<string>("CC");
  const [docNumber, setDocNumber] = useState("");
  const [stageId, setStageId] = useState("");
  const [family, setFamily] = useState<DraftFamily[]>([]);
  const [familyDraftName, setFamilyDraftName] = useState("");
  const [familyDraftPhone, setFamilyDraftPhone] = useState("");
  const [familyDraftRel, setFamilyDraftRel] = useState<FamilyRelationship | "">(
    ""
  );
  const [showFamilyDraft, setShowFamilyDraft] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const reset = () => {
    setName("");
    setPhone("");
    setEmail("");
    setAddress("");
    setBirthdate("");
    setDocType("CC");
    setDocNumber("");
    setStageId("");
    setFamily([]);
    setFamilyDraftName("");
    setFamilyDraftPhone("");
    setFamilyDraftRel("");
    setShowFamilyDraft(false);
  };

  // Reset on close so the next open starts fresh. Skipped while the
  // submit is mid-flight to avoid clearing the user's input if the
  // dialog accidentally closes during the network round-trip.
  useEffect(() => {
    if (!open && !isSubmitting) reset();
  }, [open, isSubmitting]);

  const canSubmit = !isSubmitting && name.trim() && phone.trim();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (isSubmitting) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-[480px] rounded-2xl p-6 max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">
            Agregar contacto
          </DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4 mt-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const trimmedName = name.trim();
            const trimmedPhone = phone.trim();
            if (!trimmedName || !trimmedPhone) {
              toast({
                title: "Información incompleta",
                description: "Nombre y teléfono son obligatorios.",
                variant: "destructive",
              });
              return;
            }
            if (!onCreateContact) {
              toast({
                title: "No disponible",
                description: "El backend no expone la creación de contactos.",
                variant: "destructive",
              });
              return;
            }
            setIsSubmitting(true);
            try {
              const created = await onCreateContact({
                name: trimmedName,
                phone: trimmedPhone,
                email: email.trim() || undefined,
              });
              if (!created?.id) {
                setIsSubmitting(false);
                return; // parent handler already toasted on failure
              }
              for (const member of family) {
                try {
                  await api.contacts.addFamily(created.id, member);
                } catch (err) {
                  console.warn("family add failed", err);
                }
              }
              if (stageId && pipelineId && onCreateOpportunity) {
                try {
                  await onCreateOpportunity({
                    name: trimmedName,
                    contactId: created.id,
                    pipelineId,
                    stageId,
                  });
                } catch (err) {
                  console.warn("opportunity create failed", err);
                }
              }
              toast({
                title: "Contacto agregado",
                description:
                  "Aparecerá en la lista cuando GoHighLevel confirme el registro.",
              });
              setIsSubmitting(false);
              onOpenChange(false);
            } catch (err) {
              toast({
                title: "No se pudo agregar el contacto",
                description: String((err as Error)?.message ?? err),
                variant: "destructive",
              });
              setIsSubmitting(false);
            }
          }}
        >
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">
              Nombre y apellido <span className="text-destructive">*</span>
            </Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Juan Pérez"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">
              Teléfono <span className="text-destructive">*</span>
            </Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Ej. +1 234 567 8900"
              inputMode="tel"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Email</Label>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Ej. juan@correo.com"
              inputMode="email"
              type="email"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Dirección</Label>
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Ej. Calle 123, Ciudad"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Fecha de nacimiento</Label>
            <Input
              value={birthdate}
              onChange={(e) => setBirthdate(e.target.value)}
              type="date"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Número de documento</Label>
            <div className="flex gap-2">
              <Select value={docType} onValueChange={setDocType}>
                <SelectTrigger className="w-[110px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CC">CC</SelectItem>
                  <SelectItem value="CE">CE</SelectItem>
                  <SelectItem value="NIT">NIT</SelectItem>
                  <SelectItem value="Pasaporte">Pasaporte</SelectItem>
                </SelectContent>
              </Select>
              <Input
                value={docNumber}
                onChange={(e) => setDocNumber(e.target.value)}
                placeholder="Número"
                className="flex-1"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Familiares vinculados</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full h-8 px-3 text-xs"
                onClick={() => {
                  setShowFamilyDraft(true);
                  setFamilyDraftName("");
                  setFamilyDraftPhone("");
                  setFamilyDraftRel("");
                }}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Agregar familiar
              </Button>
            </div>
            {family.length > 0 && (
              <ul className="space-y-1 text-sm">
                {family.map((m, idx) => (
                  <li
                    key={idx}
                    className="flex items-center justify-between rounded-md border bg-muted/30 px-2 py-1.5"
                  >
                    <div className="flex flex-col min-w-0">
                      <span className="truncate text-foreground">{m.name}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {FAMILY_REL_LABELS[m.relationship]} · {m.phone}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setFamily((prev) => prev.filter((_, i) => i !== idx))
                      }
                      className="h-5 w-5 shrink-0 rounded-full hover:bg-muted-foreground/15 flex items-center justify-center text-muted-foreground"
                      aria-label="Eliminar"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {showFamilyDraft && (
              <div className="rounded-md border bg-muted/20 p-3 space-y-2">
                <Input
                  value={familyDraftName}
                  onChange={(e) => setFamilyDraftName(e.target.value)}
                  placeholder="Nombre del familiar"
                  className="h-8 text-sm"
                />
                <Input
                  value={familyDraftPhone}
                  onChange={(e) => setFamilyDraftPhone(e.target.value)}
                  placeholder="Teléfono"
                  className="h-8 text-sm"
                  inputMode="tel"
                />
                <Select
                  value={familyDraftRel || undefined}
                  onValueChange={(v) =>
                    setFamilyDraftRel(v as FamilyRelationship)
                  }
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="Parentesco" />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(FAMILY_REL_LABELS) as FamilyRelationship[]).map(
                      (r) => (
                        <SelectItem key={r} value={r}>
                          {FAMILY_REL_LABELS[r]}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setShowFamilyDraft(false)}
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={
                      !familyDraftName.trim() ||
                      !familyDraftPhone.trim() ||
                      !familyDraftRel
                    }
                    onClick={() => {
                      setFamily((prev) => [
                        ...prev,
                        {
                          name: familyDraftName.trim(),
                          phone: familyDraftPhone.trim(),
                          relationship: familyDraftRel as FamilyRelationship,
                        },
                      ]);
                      setShowFamilyDraft(false);
                    }}
                  >
                    Añadir
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Etapa de oportunidad</Label>
            <Select
              value={stageId || undefined}
              onValueChange={(v) => setStageId(v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar etapa" />
              </SelectTrigger>
              <SelectContent>
                {stages.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-muted-foreground">
                    No hay etapas disponibles.
                  </div>
                ) : (
                  stages.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-full px-6"
              disabled={isSubmitting}
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              className="rounded-full px-6"
              disabled={!canSubmit}
            >
              {isSubmitting ? "Guardando…" : "Guardar contacto"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
