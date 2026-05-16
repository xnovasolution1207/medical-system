// Modal that prompts the agent to register a WhatsApp Business Account
// id for the current location. Shown when the templates endpoint
// returns ApiError code="WABA_MISSING". On submit, persists the WABA id
// to LocationConfig and resolves `onSubmit`'s promise so the caller can
// retry the template fetch.
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface WabaRegistrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Called after a successful save. Parent typically retries the
  // failing templates fetch here.
  onSaved?: (wabaId: string) => void | Promise<void>;
}

export function WabaRegistrationDialog({
  open,
  onOpenChange,
  onSaved,
}: WabaRegistrationDialogProps) {
  const { toast } = useToast();
  const [wabaId, setWabaId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Prefill from whatever is stored. Lets the dialog double as an
  // "edit" surface if we wire it to a settings page later.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api.locationConfig
      .get()
      .then((res) => {
        if (cancelled) return;
        setWabaId(res.wabaId ?? "");
      })
      .catch(() => {
        if (cancelled) return;
        setWabaId("");
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleSubmit = async () => {
    const trimmed = wabaId.trim();
    if (!trimmed) {
      toast({
        title: "Falta el WABA ID",
        description: "Ingresa el ID de tu WhatsApp Business Account.",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.locationConfig.setWabaId(trimmed);
      onOpenChange(false);
      if (res.wabaId && onSaved) await onSaved(res.wabaId);
    } catch (err) {
      toast({
        title: "No se pudo guardar el WABA ID",
        description: (err as Error)?.message ?? String(err),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar WhatsApp Business Account</DialogTitle>
          <DialogDescription>
            Para cargar plantillas de WhatsApp necesitamos el ID de tu
            WhatsApp Business Account (WABA). Lo encuentras en Meta
            Business Manager → Configuración → Cuentas → WhatsApp.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5 py-2">
          <Label htmlFor="waba-id" className="text-sm font-medium">
            WABA ID
          </Label>
          <Input
            id="waba-id"
            value={wabaId}
            onChange={(e) => setWabaId(e.target.value)}
            placeholder="123456789012345"
            inputMode="numeric"
            autoFocus
            disabled={submitting}
          />
          <p className="text-xs text-muted-foreground">
            Solo números, entre 6 y 32 dígitos.
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={submitting} className="gap-2">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
