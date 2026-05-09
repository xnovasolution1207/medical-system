import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  ArrowLeft,
  Camera,
  Lock,
  Mail,
  Phone,
  Save,
  User as UserIcon,
  X,
  Loader2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";

interface ProfileFields {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  profilePhoto: string | null;
}

const EMPTY_FIELDS: ProfileFields = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  profilePhoto: null,
};

// Renders the agent's editable GHL user record. Three groups of fields:
//   - identity (firstName / lastName / email / phone) — patched together
//     in a single PATCH /auth/me/profile call.
//   - avatar — uploaded via multipart, then GHL persists `profilePhoto`
//     and we hydrate the local form state.
//   - password — sent in the same patch as identity. Empty fields are
//     dropped on the server so the form doesn't have to gate them.
export default function Profile() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [original, setOriginal] = useState<ProfileFields>(EMPTY_FIELDS);
  const [form, setForm] = useState<ProfileFields>(EMPTY_FIELDS);
  // Password fields are kept separate from the main form because they
  // never round-trip back as state we want to retain — they're cleared
  // on every save attempt.
  const [passwords, setPasswords] = useState({ current: "", next: "", confirm: "" });
  const [submitting, setSubmitting] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.auth.profile
      .get()
      .then((p) => {
        if (cancelled) return;
        const fields: ProfileFields = {
          firstName: p.firstName,
          lastName: p.lastName,
          email: p.email,
          phone: p.phone,
          profilePhoto: p.profilePhoto,
        };
        setOriginal(fields);
        setForm(fields);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(String((err as Error)?.message ?? err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const passwordDirty =
    passwords.current.length > 0 ||
    passwords.next.length > 0 ||
    passwords.confirm.length > 0;
  const dirty =
    form.firstName !== original.firstName ||
    form.lastName !== original.lastName ||
    form.email !== original.email ||
    form.phone !== original.phone ||
    passwordDirty;

  const handleAvatarPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so picking the same file again still fires
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({
        title: "Archivo no válido",
        description: "Solo se admiten imágenes.",
        variant: "destructive",
      });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "Archivo demasiado grande",
        description: "El máximo es 5 MB.",
        variant: "destructive",
      });
      return;
    }
    setUploadingAvatar(true);
    api.auth.profile
      .uploadAvatar(file)
      .then((res) => {
        setForm((f) => ({ ...f, profilePhoto: res.profilePhoto }));
        setOriginal((o) => ({ ...o, profilePhoto: res.profilePhoto }));
        toast({ title: "Foto actualizada" });
      })
      .catch((err) => {
        toast({
          title: "No se pudo subir la foto",
          description: String((err as Error)?.message ?? err),
          variant: "destructive",
        });
      })
      .finally(() => setUploadingAvatar(false));
  };

  const handleSave = async () => {
    // Local password sanity checks — the backend re-validates everything,
    // these just save a round-trip.
    if (passwordDirty) {
      if (!passwords.current) {
        toast({
          title: "Falta la contraseña actual",
          description: "Ingrésala para confirmar el cambio.",
          variant: "destructive",
        });
        return;
      }
      if (!passwords.next || !passwords.confirm) {
        toast({
          title: "Faltan campos de contraseña",
          variant: "destructive",
        });
        return;
      }
      if (passwords.next !== passwords.confirm) {
        toast({
          title: "Las contraseñas no coinciden",
          variant: "destructive",
        });
        return;
      }
      if (passwords.next.length < 8) {
        toast({
          title: "La nueva contraseña debe tener al menos 8 caracteres",
          variant: "destructive",
        });
        return;
      }
      if (passwords.next === passwords.current) {
        toast({
          title: "La nueva contraseña debe ser diferente de la actual",
          variant: "destructive",
        });
        return;
      }
    }
    setSubmitting(true);
    try {
      const patch: Parameters<typeof api.auth.profile.update>[0] = {};
      if (form.firstName !== original.firstName) patch.firstName = form.firstName;
      if (form.lastName !== original.lastName) patch.lastName = form.lastName;
      if (form.email !== original.email) patch.email = form.email;
      if (form.phone !== original.phone) patch.phone = form.phone;
      if (passwordDirty) {
        patch.currentPassword = passwords.current;
        patch.newPassword = passwords.next;
        patch.confirmPassword = passwords.confirm;
      }
      const updated = await api.auth.profile.update(patch);
      const fields: ProfileFields = {
        firstName: updated.firstName,
        lastName: updated.lastName,
        email: updated.email,
        phone: updated.phone,
        profilePhoto: updated.profilePhoto,
      };
      setOriginal(fields);
      setForm(fields);
      // Always clear password fields on success — never retain them in
      // local state across saves.
      setPasswords({ current: "", next: "", confirm: "" });
      toast({ title: "Perfil actualizado correctamente" });
    } catch (err) {
      toast({
        title: "No se pudo guardar el perfil",
        description: String((err as Error)?.message ?? err),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = () => {
    setForm(original);
    setPasswords({ current: "", next: "", confirm: "" });
  };

  const initials =
    `${form.firstName?.[0] ?? ""}${form.lastName?.[0] ?? ""}`.toUpperCase() || "??";

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Cargando perfil…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center gap-2 bg-background p-6 text-center">
        <h1 className="text-xl font-semibold">No se pudo cargar el perfil</h1>
        <p className="text-sm text-muted-foreground max-w-lg">{loadError}</p>
        <Button variant="outline" onClick={() => navigate("/")}>Volver</Button>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <div className="flex-1 h-full overflow-y-auto bg-slate-50 dark:bg-background">
        <div className="max-w-4xl mx-auto py-10 px-6">
          <div className="mb-8 flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Mi Perfil</h1>
              <p className="text-muted-foreground">
                Gestiona tu información personal y configuración de seguridad.
              </p>
            </div>
            <Button variant="ghost" onClick={() => navigate("/")} className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Volver
            </Button>
          </div>

          <div className="grid gap-8">
            {/* Profile Section */}
            <div className="bg-card rounded-2xl border p-8 shadow-sm">
              <div className="flex flex-col md:flex-row gap-8 items-start">
                <div className="relative group">
                  <Avatar className="h-32 w-32 border-4 border-background shadow-lg">
                    {form.profilePhoto && <AvatarImage src={form.profilePhoto} />}
                    <AvatarFallback className="text-2xl">{initials}</AvatarFallback>
                  </Avatar>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingAvatar}
                    className="absolute bottom-0 right-0 p-2 bg-primary text-primary-foreground rounded-full shadow-lg hover:scale-110 transition-transform disabled:opacity-70 disabled:cursor-not-allowed"
                    aria-label="Cambiar foto de perfil"
                  >
                    {uploadingAvatar ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <Camera className="h-5 w-5" />
                    )}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleAvatarPick}
                  />
                </div>

                <div className="flex-1 grid gap-6 w-full">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldWithIcon
                      id="firstName"
                      label="Nombre"
                      icon={<UserIcon className="h-4 w-4" />}
                      value={form.firstName}
                      onChange={(v) => setForm({ ...form, firstName: v })}
                    />
                    <FieldWithIcon
                      id="lastName"
                      label="Apellido"
                      icon={<UserIcon className="h-4 w-4" />}
                      value={form.lastName}
                      onChange={(v) => setForm({ ...form, lastName: v })}
                    />
                  </div>

                  <FieldWithIcon
                    id="email"
                    type="email"
                    label="Correo Electrónico"
                    icon={<Mail className="h-4 w-4" />}
                    value={form.email}
                    onChange={(v) => setForm({ ...form, email: v })}
                  />

                  <FieldWithIcon
                    id="phone"
                    type="tel"
                    label="Teléfono"
                    icon={<Phone className="h-4 w-4" />}
                    value={form.phone}
                    onChange={(v) => setForm({ ...form, phone: v })}
                    placeholder="+52 55 1234 5678"
                  />
                </div>
              </div>
            </div>

            {/* Password Section. The backend probes a couple of GHL
                endpoints; if none accept the change it returns a 501
                with a clear error message that we surface here. */}
            <div className="bg-card rounded-2xl border p-8 shadow-sm">
              <div className="flex items-center gap-2 mb-6">
                <Lock className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold">Seguridad y Contraseña</h2>
              </div>

              <div className="grid gap-6 max-w-2xl">
                <div className="space-y-2">
                  <Label htmlFor="currentPassword" className="text-[13px] font-semibold">
                    Contraseña Actual
                  </Label>
                  <Input
                    id="currentPassword"
                    type="password"
                    placeholder="••••••••"
                    autoComplete="current-password"
                    value={passwords.current}
                    onChange={(e) => setPasswords({ ...passwords, current: e.target.value })}
                    className="bg-muted/50 border-none h-11 focus-visible:ring-primary/20"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="newPassword" className="text-[13px] font-semibold">
                      Nueva Contraseña
                    </Label>
                    <Input
                      id="newPassword"
                      type="password"
                      placeholder="••••••••"
                      autoComplete="new-password"
                      value={passwords.next}
                      onChange={(e) => setPasswords({ ...passwords, next: e.target.value })}
                      className="bg-muted/50 border-none h-11 focus-visible:ring-primary/20"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword" className="text-[13px] font-semibold">
                      Confirmar Nueva Contraseña
                    </Label>
                    <Input
                      id="confirmPassword"
                      type="password"
                      placeholder="••••••••"
                      autoComplete="new-password"
                      value={passwords.confirm}
                      onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
                      className="bg-muted/50 border-none h-11 focus-visible:ring-primary/20"
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Mínimo 8 caracteres. Si dejas los campos en blanco no se modifica.
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 mt-4">
              <Button
                variant="ghost"
                className="h-11 px-8 rounded-xl font-semibold"
                onClick={handleCancel}
                disabled={submitting || !dirty}
              >
                <X className="mr-2 h-4 w-4" />
                Cancelar
              </Button>
              <Button
                onClick={handleSave}
                disabled={submitting || !dirty}
                className="h-11 px-10 rounded-xl font-semibold shadow-lg shadow-primary/20"
              >
                {submitting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Guardar Cambios
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Small helper so the four input rows above don't repeat the same shell.
function FieldWithIcon({
  id,
  label,
  icon,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  id: string;
  label: string;
  icon: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-[13px] font-semibold">
        {label}
      </Label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
          {icon}
        </span>
        <Input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="bg-muted/50 border-none pl-10 h-11 focus-visible:ring-primary/20"
        />
      </div>
    </div>
  );
}
