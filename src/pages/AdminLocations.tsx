import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, Plus, Trash2, ShieldCheck, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/authContext";
import { DEFAULT_PATH } from "@/lib/chattingRoutes";

type LocationRow = {
  locationId: string;
  name: string | null;
  allowed: boolean;
  source: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("es", { dateStyle: "medium", timeStyle: "short" });
}

// Admin: dynamic management of the multi-tenant location allowlist. Lists every
// sub-account the server has seen (or that was added manually), lets an admin
// approve/block each one, and toggles global enforcement — all without a
// redeploy. Gated by the session's isAdmin flag (and the API by requireAdmin).
export default function AdminLocations() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enforced, setEnforced] = useState(false);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.admin.listLocations();
      setEnforced(data.enforced);
      setLocations(data.locations);
    } catch (err) {
      setError((err as Error)?.message ?? "No se pudo cargar la lista.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user?.isAdmin) void load();
    else setLoading(false);
  }, [user?.isAdmin, load]);

  const toggleEnforcement = useCallback(
    async (value: boolean) => {
      setEnforced(value); // optimistic
      try {
        await api.admin.setEnforcement(value);
        toast({
          title: value ? "Lista blanca activada" : "Lista blanca desactivada",
          description: value
            ? "Solo las ubicaciones aprobadas pueden iniciar sesión y generar carga."
            : "Todas las ubicaciones están permitidas.",
        });
      } catch (err) {
        setEnforced(!value); // revert
        toast({ title: "Error", description: String(err), variant: "destructive" });
      }
    },
    [toast]
  );

  const setAllowed = useCallback(
    async (id: string, allowed: boolean) => {
      setBusyId(id);
      setLocations((prev) => prev.map((l) => (l.locationId === id ? { ...l, allowed } : l)));
      try {
        await api.admin.setAllowed(id, allowed);
      } catch (err) {
        setLocations((prev) => prev.map((l) => (l.locationId === id ? { ...l, allowed: !allowed } : l)));
        toast({ title: "Error", description: String(err), variant: "destructive" });
      } finally {
        setBusyId(null);
      }
    },
    [toast]
  );

  const remove = useCallback(
    async (id: string) => {
      if (!window.confirm(`¿Eliminar la ubicación ${id} de la lista?`)) return;
      setBusyId(id);
      try {
        await api.admin.removeLocation(id);
        setLocations((prev) => prev.filter((l) => l.locationId !== id));
      } catch (err) {
        toast({ title: "Error", description: String(err), variant: "destructive" });
      } finally {
        setBusyId(null);
      }
    },
    [toast]
  );

  const addManual = useCallback(async () => {
    const id = newId.trim();
    if (!id) return;
    setBusyId("__new__");
    try {
      await api.admin.addLocation(id, newName.trim() || undefined);
      setNewId("");
      setNewName("");
      await load();
      toast({ title: "Ubicación agregada", description: id });
    } catch (err) {
      toast({ title: "Error", description: String(err), variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }, [newId, newName, load, toast]);

  // Not an admin → show how to grant access (their own user id).
  if (!authLoading && user && !user.isAdmin) {
    return (
      <div className="min-h-screen bg-background p-6 flex items-center justify-center">
        <Card className="max-w-lg w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-amber-500" /> Acceso restringido
            </CardTitle>
            <CardDescription>
              No tienes permisos de administrador. Para habilitar esta sección,
              agrega tu id de usuario de GHL a la variable de entorno
              <code className="mx-1 rounded bg-muted px-1">ADMIN_USER_IDS</code>
              del backend y reinícialo.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">Tu id de usuario</Label>
              <Input readOnly value={user.userId} className="font-mono mt-1" />
            </div>
            <Button variant="outline" onClick={() => navigate(DEFAULT_PATH)}>
              <ArrowLeft className="h-4 w-4 mr-2" /> Volver
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(DEFAULT_PATH)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold">Administración de ubicaciones</h1>
            <p className="text-sm text-muted-foreground">
              Controla qué sub-cuentas de GHL pueden usar el sistema.
            </p>
          </div>
        </div>

        {/* Enforcement toggle */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              {enforced ? (
                <ShieldCheck className="h-5 w-5 text-emerald-500" />
              ) : (
                <ShieldAlert className="h-5 w-5 text-amber-500" />
              )}
              Aplicar lista blanca
            </CardTitle>
            <CardDescription>
              {enforced
                ? "Activada: solo las ubicaciones aprobadas pueden iniciar sesión; los webhooks de las demás se descartan sin consultar a GHL."
                : "Desactivada: TODAS las ubicaciones están permitidas. Aprueba tus ubicaciones abajo y luego actívala."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <Switch checked={enforced} onCheckedChange={toggleEnforcement} />
              <span className="text-sm">{enforced ? "Activada" : "Desactivada"}</span>
            </div>
          </CardContent>
        </Card>

        {/* Add manually */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Agregar ubicación</CardTitle>
            <CardDescription>
              Agrega y aprueba una sub-cuenta por su Location ID (GHL → Settings → Business Profile).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                placeholder="Location ID"
                value={newId}
                onChange={(e) => setNewId(e.target.value)}
                className="font-mono"
              />
              <Input
                placeholder="Nombre (opcional)"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <Button onClick={addManual} disabled={!newId.trim() || busyId === "__new__"}>
                {busyId === "__new__" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                <span className="ml-1">Agregar</span>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Locations table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ubicaciones ({locations.length})</CardTitle>
            <CardDescription>
              Cada sub-cuenta que ha iniciado sesión o enviado un webhook aparece aquí.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando…
              </div>
            ) : error ? (
              <p className="text-sm text-destructive py-4">{error}</p>
            ) : locations.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                Aún no se ha visto ninguna ubicación.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ubicación</TableHead>
                    <TableHead>Origen</TableHead>
                    <TableHead>Última actividad</TableHead>
                    <TableHead className="text-center">Permitida</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {locations.map((l) => (
                    <TableRow key={l.locationId}>
                      <TableCell>
                        <div className="font-medium">{l.name || "—"}</div>
                        <div className="font-mono text-xs text-muted-foreground">{l.locationId}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">
                          {l.source ?? "—"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatWhen(l.lastSeenAt)}
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={l.allowed}
                          disabled={busyId === l.locationId}
                          onCheckedChange={(v) => setAllowed(l.locationId, v)}
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          disabled={busyId === l.locationId}
                          onClick={() => remove(l.locationId)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
