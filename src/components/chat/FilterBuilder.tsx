import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AgentUser, FilterCondition, TagSummary } from "./types";
import { X, Save } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const FILTER_FIELDS = [
  { value: "asignado", label: "Asignado" },
  { value: "seguidor", label: "Seguidor" },
  { value: "mencion", label: "Mención" },
  { value: "direccion_ultimo_mensaje", label: "Dirección del último mensaje" },
  { value: "tipo_ultimo_mensaje_saliente", label: "Tipo del último mensaje saliente" },
  { value: "canal_ultimo_mensaje", label: "Canal del último mensaje" },
  { value: "etiqueta", label: "Etiqueta" },
  { value: "ans", label: "ANS" },
  { value: "embudo_actual", label: "Embudo actual" }
];

// Operator menus differ by field type. Free-text fields keep contains/no
// contains; equality-only selectors (user/channel/stage/direction) drop
// them so the user can't pick a meaningless combination.
const TEXT_OPERATORS = [
  { value: "es", label: "Es" },
  { value: "no_es", label: "No es" },
  { value: "contiene", label: "Contiene" },
  { value: "no_contiene", label: "No contiene" }
];
const EQUALITY_OPERATORS = [
  { value: "es", label: "Es" },
  { value: "no_es", label: "No es" }
];

const FIELDS_WITH_EQUALITY_ONLY = new Set([
  "asignado",
  "seguidor",
  "mencion",
  "direccion_ultimo_mensaje",
  "tipo_ultimo_mensaje_saliente",
  "canal_ultimo_mensaje",
  "embudo_actual",
]);

const CANAL_VALUES = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "sms", label: "SMS" },
  { value: "email", label: "Email" },
  { value: "instagram", label: "Instagram" },
  { value: "messenger", label: "Messenger" },
  { value: "tiktok", label: "TikTok" }
];

const DIRECTION_VALUES = [
  { value: "inbound", label: "Entrante" },
  { value: "outbound", label: "Saliente" },
];

interface FilterBuilderProps {
  filters: FilterCondition[];
  logic: "AND" | "OR";
  onFiltersChange: (filters: FilterCondition[]) => void;
  onLogicChange: (logic: "AND" | "OR") => void;
  onClose: () => void;
  onClear: () => void;
  onSaveView: (name: string, viewId?: string) => void;
  stages?: { id: string; label: string; color: string; }[];
  activeViewId?: string | null;
  initialViewName?: string;
  // Agent roster — drives the user pickers for asignado / seguidor / mención.
  // Empty when GHL hasn't returned a roster yet.
  users?: AgentUser[];
  // Location tag library — drives the "Etiqueta" value dropdown, same as the
  // contact panel's "Etiquetas" picker. Empty when GHL hasn't returned tags.
  availableTags?: TagSummary[];
}

export function FilterBuilder({
  filters,
  logic,
  onFiltersChange,
  onLogicChange,
  onClose,
  onClear,
  onSaveView,
  stages = [],
  activeViewId,
  initialViewName,
  users = [],
  availableTags = [],
}: FilterBuilderProps) {
  const [viewName, setViewName] = useState(initialViewName || "");
  const [isSaving, setIsSaving] = useState(false);

  React.useEffect(() => {
    if (initialViewName) {
      setViewName(initialViewName);
    } else {
      setViewName("");
    }
  }, [initialViewName]);

  const addCondition = () => {
    onFiltersChange([
      ...filters,
      { id: Math.random().toString(36).substr(2, 9), field: "", operator: "es", value: "" }
    ]);
  };

  const updateCondition = (id: string, updates: Partial<FilterCondition>) => {
    onFiltersChange(filters.map(f => f.id === id ? { ...f, ...updates } : f));
  };

  const removeCondition = (id: string) => {
    onFiltersChange(filters.filter(f => f.id !== id));
  };

  const renderValueInput = (condition: FilterCondition) => {
    // Channel pickers — used by both "Canal del último mensaje" and
    // "Tipo del último mensaje saliente" (the latter compares against the
    // channel of the last outbound message).
    if (
      condition.field === "canal_ultimo_mensaje" ||
      condition.field === "tipo_ultimo_mensaje_saliente"
    ) {
      return (
        <Select value={condition.value} onValueChange={(val) => updateCondition(condition.id, { value: val })}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Valor" />
          </SelectTrigger>
          <SelectContent>
            {CANAL_VALUES.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    if (condition.field === "embudo_actual") {
      return (
        <Select value={condition.value} onValueChange={(val) => updateCondition(condition.id, { value: val })}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Valor" />
          </SelectTrigger>
          <SelectContent>
            {stages.map(stage => (
              <SelectItem key={stage.id} value={stage.id}>
                <div className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${stage.color}`} />
                  {stage.label}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    if (condition.field === "direccion_ultimo_mensaje") {
      return (
        <Select value={condition.value} onValueChange={(val) => updateCondition(condition.id, { value: val })}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Valor" />
          </SelectTrigger>
          <SelectContent>
            {DIRECTION_VALUES.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    if (
      condition.field === "asignado" ||
      condition.field === "seguidor" ||
      condition.field === "mencion"
    ) {
      // Match by GHL user id — the value is the userId, not the display name.
      // Falling back to a text input when the roster is empty (GHL token
      // lacks `users.readonly`) lets the user still type a name to match.
      if (users.length === 0) {
        return (
          <Input
            placeholder="Nombre o ID"
            value={condition.value}
            onChange={(e) => updateCondition(condition.id, { value: e.target.value })}
            className="h-9"
          />
        );
      }
      return (
        <Select value={condition.value} onValueChange={(val) => updateCondition(condition.id, { value: val })}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Seleccionar agente" />
          </SelectTrigger>
          <SelectContent>
            {users.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                <div className="flex items-center gap-2">
                  <Avatar className="h-5 w-5">
                    {u.avatar && <AvatarImage src={u.avatar} />}
                    <AvatarFallback>{u.name.substring(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <span>{u.name}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    // Etiqueta — pick from the location's tag library (matched by name),
    // the same list the contact panel's "Etiquetas" picker uses. Falls back
    // to free text when the tag library hasn't loaded (or is empty).
    if (condition.field === "etiqueta" && availableTags.length > 0) {
      return (
        <Select value={condition.value} onValueChange={(val) => updateCondition(condition.id, { value: val })}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Seleccionar etiqueta" />
          </SelectTrigger>
          <SelectContent>
            {availableTags.map((t) => (
              <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    // Default: free-text (etiqueta with no library, ans, anything new).
    return (
      <Input
        placeholder="Valor"
        value={condition.value}
        onChange={(e) => updateCondition(condition.id, { value: e.target.value })}
        className="h-9"
      />
    );
  };

  return (
    <div className="flex flex-col w-[320px] bg-card rounded-lg shadow-lg border p-4 space-y-4">
      <div className="flex items-center justify-between border-b pb-3">
        <h3 className="font-semibold text-lg flex items-center gap-2">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
          Filtros
        </h3>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onClear} className="h-8 px-2 text-muted-foreground hover:text-foreground">
            Borrar
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-4 max-h-[300px] overflow-y-auto pr-1">
        {filters.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-4">
            No hay filtros activos.
          </div>
        )}

        {filters.map((condition, index) => (
          <div key={condition.id} className="relative">
            <div className="flex flex-col gap-2 p-3 border rounded-md bg-muted/30">
              <div className="flex items-center justify-between">
                <Select
                  value={condition.field}
                  onValueChange={(val) => {
                    // Reset the value when the field changes — the previous
                    // value is almost certainly nonsensical for the new
                    // field's input type. Also clamp the operator to one
                    // valid for the new field.
                    const operators = FIELDS_WITH_EQUALITY_ONLY.has(val)
                      ? EQUALITY_OPERATORS
                      : TEXT_OPERATORS;
                    const nextOperator = operators.some(
                      (o) => o.value === condition.operator
                    )
                      ? condition.operator
                      : operators[0].value;
                    updateCondition(condition.id, {
                      field: val,
                      value: "",
                      operator: nextOperator,
                    });
                  }}
                >
                  <SelectTrigger className="h-9 w-full bg-muted">
                    <SelectValue placeholder="Tipo de filtro" />
                  </SelectTrigger>
                  <SelectContent>
                    {FILTER_FIELDS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 ml-1 text-muted-foreground hover:text-destructive" onClick={() => removeCondition(condition.id)}>
                  <X className="h-3 w-3" />
                </Button>
              </div>

              <Select value={condition.operator} onValueChange={(val) => updateCondition(condition.id, { operator: val })}>
                <SelectTrigger className="h-9 bg-muted">
                  <SelectValue placeholder="Es" />
                </SelectTrigger>
                <SelectContent>
                  {(FIELDS_WITH_EQUALITY_ONLY.has(condition.field)
                    ? EQUALITY_OPERATORS
                    : TEXT_OPERATORS
                  ).map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {renderValueInput(condition)}
            </div>

            {index < filters.length - 1 && (
              <div className="relative flex justify-center mt-4 mb-2">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-dashed border-border" />
                </div>
                <div className="relative flex bg-muted border rounded-md shadow-sm">
                  <button 
                    className={`px-3 py-1 text-xs font-medium ${logic === "AND" ? "bg-muted text-foreground" : "text-muted-foreground"} rounded-l-md`}
                    onClick={() => onLogicChange("AND")}
                  >
                    Y
                  </button>
                  <div className="w-px bg-border" />
                  <button 
                    className={`px-3 py-1 text-xs font-medium ${logic === "OR" ? "bg-muted text-foreground" : "text-muted-foreground"} rounded-r-md`}
                    onClick={() => onLogicChange("OR")}
                  >
                    O
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 pt-2 border-t">
        <Button variant="outline" className="w-full border-dashed" onClick={addCondition}>
          + Añadir condición
        </Button>
        
        {filters.length > 0 && (
          <div className="mt-2 flex flex-col gap-2 p-3 bg-muted/30 rounded-md border">
            {isSaving || activeViewId ? (
              <div className="flex gap-2">
                <Input 
                  placeholder="Nombre de la vista" 
                  value={viewName} 
                  onChange={(e) => setViewName(e.target.value)}
                  className="h-9"
                />
                <Button size="sm" className="h-9 shrink-0" onClick={() => {
                  if (viewName.trim()) {
                    onSaveView(viewName, activeViewId || undefined);
                    if (!activeViewId) setViewName("");
                    setIsSaving(false);
                  }
                }}>
                  {activeViewId ? "Actualizar" : "Guardar"}
                </Button>
              </div>
            ) : (
              <Button variant="secondary" className="w-full gap-2" onClick={() => setIsSaving(true)}>
                <Save className="h-4 w-4" />
                Guardar como vista
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
