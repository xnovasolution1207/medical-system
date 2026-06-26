import { useEffect, useState } from "react";
import { Bot, Plus, Trash2, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, StageRule } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface StageRulesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stages: { id: string; label: string }[];
  // Pipeline the stages belong to — stored on each rule so the backend can
  // create an opportunity in the right pipeline when the lead has none.
  pipelineId?: string;
}

// Manage the keyword → stage automation rules. When an inbound lead message
// contains a keyword, the backend moves that lead's opportunity to the rule's
// stage automatically.
export function StageRulesDialog({
  open,
  onOpenChange,
  stages,
  pipelineId,
}: StageRulesDialogProps) {
  const { toast } = useToast();
  const [rules, setRules] = useState<StageRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.stageRules
      .list()
      .then((r) => setRules(r.rules ?? []))
      .catch(() => setRules([]))
      .finally(() => setLoading(false));
  }, [open]);

  const addRule = () => {
    setRules((prev) => [
      ...prev,
      {
        id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        keyword: "",
        stageId: stages[0]?.id ?? "",
        pipelineId: pipelineId ?? "",
        enabled: true,
      },
    ]);
  };

  const update = (id: string, patch: Partial<StageRule>) =>
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const remove = (id: string) =>
    setRules((prev) => prev.filter((r) => r.id !== id));

  const save = async () => {
    // Drop incomplete rows and stamp the current pipeline.
    const clean = rules
      .filter((r) => r.keyword.trim() && r.stageId)
      .map((r) => ({ ...r, keyword: r.keyword.trim(), pipelineId: pipelineId ?? r.pipelineId }));
    setSaving(true);
    try {
      const res = await api.stageRules.save(clean);
      setRules(res.rules ?? clean);
      toast({ title: "Automatización guardada", description: `${clean.length} regla(s) activas.` });
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "No se pudo guardar",
        description: String((err as Error)?.message ?? err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-indigo-600" />
            Automatización por palabras clave
          </DialogTitle>
          <DialogDescription>
            Cuando un mensaje entrante del lead contenga la palabra clave, su
            oportunidad se moverá automáticamente a la etapa indicada.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <div className="max-h-[55vh] space-y-2 overflow-y-auto py-1">
            {rules.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Aún no hay reglas. Agrega una para empezar.
              </p>
            )}
            {rules.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-2 rounded-lg border p-2"
              >
                <Switch
                  checked={r.enabled}
                  onCheckedChange={(v) => update(r.id, { enabled: v })}
                  title={r.enabled ? "Activa" : "Inactiva"}
                />
                <Input
                  value={r.keyword}
                  onChange={(e) => update(r.id, { keyword: e.target.value })}
                  placeholder="Palabra o frase clave"
                  className="flex-1"
                />
                <span className="shrink-0 text-xs text-muted-foreground">→</span>
                <Select
                  value={r.stageId}
                  onValueChange={(v) => update(r.id, { stageId: v })}
                >
                  <SelectTrigger className="w-44 shrink-0">
                    <SelectValue placeholder="Etapa" />
                  </SelectTrigger>
                  <SelectContent>
                    {stages.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => remove(r.id)}
                  aria-label="Eliminar regla"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <Button type="button" variant="outline" size="sm" onClick={addRule}>
            <Plus className="mr-1.5 h-4 w-4" />
            Agregar regla
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="button" onClick={save} disabled={saving}>
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Guardar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
