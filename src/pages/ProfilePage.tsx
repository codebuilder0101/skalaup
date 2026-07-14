import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { UserCircle, Star, Mail, Shield } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import type { Transport } from "@/lib/skalaup/types";
import type { FreelancerWithProfile } from "@/lib/skalaup/freelancers";
import {
  maskCpf, maskCep, maskPhone, isValidCpf, isValidCep, isValidPhone,
} from "@/lib/br-format";

const TRANSPORTS: Transport[] = ["own_car", "motorcycle", "public_transit", "bike", "walk", "other"];

export default function ProfilePage() {
  const { t } = useTranslation();
  const { user, refresh } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [data, setData] = useState<FreelancerWithProfile | null>(null);

  // Freelancer "ficha" fields
  const [transport, setTransport] = useState<Transport | "">("");
  const [experience, setExperience] = useState("");
  const [homeAddress, setHomeAddress] = useState("");
  const [cpf, setCpf] = useState("");
  const [pixKey, setPixKey] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [homeCep, setHomeCep] = useState("");

  const isFreelancer = user?.role === "freelancer" || user?.role === "visitor";

  // Change password (FR-B4)
  const [curPwd, setCurPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [changingPwd, setChangingPwd] = useState(false);

  const changePassword = async () => {
    if (newPwd.length < 6) { toast.error(t("skala.profile.passwordTooShort")); return; }
    if (newPwd !== confirmPwd) { toast.error(t("skala.profile.passwordMismatch")); return; }
    setChangingPwd(true);
    try {
      await api.post("/auth/change-password", { currentPassword: curPwd || undefined, newPassword: newPwd });
      toast.success(t("skala.profile.passwordChanged"));
      setCurPwd(""); setNewPwd(""); setConfirmPwd("");
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setChangingPwd(false);
    }
  };

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const me = await api.get<FreelancerWithProfile>(`/freelancers/${user.id}`);
      setData(me);
      setName(me.name ?? "");
      setPhone((me as { phone?: string | null }).phone ?? "");
      setTransport((me.profile?.transport as Transport) ?? "");
      setExperience(me.profile?.experience ?? "");
      setHomeAddress(me.profile?.homeAddress ?? "");
      setCpf(me.profile?.cpf ?? "");
      setPixKey(me.profile?.pixKey ?? "");
      setWhatsapp(me.profile?.whatsapp ?? "");
      setHomeCep(me.profile?.homeCep ?? "");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!user) return;
    if (isFreelancer) {
      if (cpf && !isValidCpf(cpf)) { toast.error(t("skala.auth.invalidCpf")); return; }
      if (whatsapp && !isValidPhone(whatsapp)) { toast.error(t("skala.auth.invalidWhatsapp")); return; }
      if (homeCep && !isValidCep(homeCep)) { toast.error(t("skala.auth.invalidCep")); return; }
    }
    if (phone && !isValidPhone(phone)) { toast.error(t("skala.auth.invalidPhone")); return; }
    setSaving(true);
    try {
      await api.put("/auth/me", { name: name.trim(), phone: phone.trim() });
      if (isFreelancer) {
        await api.put(`/freelancers/${user.id}/profile`, {
          memberType: data?.profile?.memberType ?? (user.role === "visitor" ? "visitor" : "member"),
          transport: transport || null,
          experience: experience.trim() || null,
          homeAddress: homeAddress.trim() || null,
          cpf: cpf.trim() || null,
          pixKey: pixKey.trim() || null,
          whatsapp: whatsapp.trim() || null,
          homeCep: homeCep.trim() || null,
        });
      }
      await refresh();
      toast.success(t("skala.common.updated"));
      void load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const roleLabel = (r?: string) =>
    r === "administrator" ? t("skala.roles.administrator")
      : r === "coordinator" ? t("skala.roles.coordinator")
        : r === "restaurant_manager" ? t("skala.roles.restaurantManager")
          : r === "visitor" ? t("skala.roles.visitor")
            : t("skala.roles.freelancer");

  return (
    <AppLayout>
      <div className="p-6 max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <UserCircle className="w-6 h-6 text-primary" /> {t("skala.profile.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t("skala.profile.subtitle")}</p>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">{t("skala.common.loading")}</p>
        ) : (
          <>
            {/* Identity summary */}
            <Card className="p-5">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xl font-bold">
                  {(user?.name ?? "?").trim().charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-foreground">{user?.name}</p>
                  <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5" />{user?.email}
                  </p>
                  <Badge variant="secondary" className="mt-1.5">
                    <Shield className="w-3 h-3 mr-1" />{roleLabel(user?.role)}
                  </Badge>
                </div>
                {isFreelancer && (
                  <div className="ml-auto text-right">
                    <p className="text-2xl font-bold text-amber-500 flex items-center gap-1 justify-end">
                      <Star className="w-5 h-5 fill-current" />{data?.profile?.currentScore ?? 0}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {data?.profile?.currentLevel != null
                        ? `${t("skala.freelancers.level")} ${data.profile.currentLevel}`
                        : t("skala.profile.noLevel")}
                    </p>
                  </div>
                )}
              </div>
            </Card>

            {/* Account */}
            <Card className="p-5 space-y-4">
              <h2 className="font-semibold text-foreground">{t("skala.profile.account")}</h2>
              <div className="space-y-1.5">
                <Label>{t("skala.auth.name")}</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("skala.auth.email")}</Label>
                <Input value={user?.email ?? ""} disabled />
              </div>
              <div className="space-y-1.5">
                <Label>{t("skala.profile.phone")}</Label>
                <Input value={phone} placeholder="(00) 00000-0000"
                  onChange={(e) => setPhone(maskPhone(e.target.value))} />
              </div>
            </Card>

            {/* Security — change password */}
            <Card className="p-5 space-y-4">
              <h2 className="font-semibold text-foreground">{t("skala.profile.changePassword")}</h2>
              {user?.mustChangePassword && (
                <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                  {t("skala.profile.tempPasswordNotice")}
                </div>
              )}
              <div className="space-y-1.5">
                <Label>{t("skala.profile.currentPassword")}</Label>
                <Input type="password" value={curPwd} onChange={(e) => setCurPwd(e.target.value)} autoComplete="current-password" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>{t("skala.profile.newPassword")}</Label>
                  <Input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} autoComplete="new-password" />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("skala.profile.confirmPassword")}</Label>
                  <Input type="password" value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} autoComplete="new-password" />
                </div>
              </div>
              <div className="flex justify-end">
                <Button variant="outline" onClick={() => void changePassword()} disabled={changingPwd}>
                  {t("skala.profile.changePassword")}
                </Button>
              </div>
            </Card>

            {/* Freelancer ficha */}
            {isFreelancer && (
              <Card className="p-5 space-y-4">
                <h2 className="font-semibold text-foreground">{t("skala.profile.ficha")}</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>{t("skala.auth.cpf")}</Label>
                    <Input value={cpf} inputMode="numeric" placeholder="000.000.000-00"
                      onChange={(e) => setCpf(maskCpf(e.target.value))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t("skala.auth.pixKey")}</Label>
                    <Input value={pixKey} placeholder={t("skala.auth.pixKeyPlaceholder")}
                      onChange={(e) => setPixKey(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>{t("skala.auth.whatsapp")}</Label>
                  <Input value={whatsapp} inputMode="tel" placeholder="(00) 00000-0000"
                    onChange={(e) => setWhatsapp(maskPhone(e.target.value))} />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("skala.profile.transport")}</Label>
                  <Select value={transport} onValueChange={(v) => setTransport(v as Transport)}>
                    <SelectTrigger><SelectValue placeholder={t("skala.profile.selectTransport")} /></SelectTrigger>
                    <SelectContent>
                      {TRANSPORTS.map((tr) => (
                        <SelectItem key={tr} value={tr}>{t(`skala.transport.${tr}`)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>{t("skala.profile.homeAddress")}</Label>
                  <Input value={homeAddress} onChange={(e) => setHomeAddress(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("skala.auth.cep")}</Label>
                  <Input value={homeCep} inputMode="numeric" placeholder="00000-000"
                    onChange={(e) => setHomeCep(maskCep(e.target.value))} />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("skala.profile.experience")}</Label>
                  <Textarea value={experience} onChange={(e) => setExperience(e.target.value)} rows={3} />
                </div>
              </Card>
            )}

            <div className="flex justify-end">
              <Button onClick={() => void save()} disabled={saving}>
                {saving ? t("skala.common.saving") : t("skala.common.save")}
              </Button>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
