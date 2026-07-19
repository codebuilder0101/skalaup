import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { QRCodeCanvas } from "qrcode.react";
import {
  Users, Star, Car, IdCard, KeyRound, Phone, MapPin, Plus, Pencil, Trash2, Mail, Copy, KeyRound as KeyIcon, Store, UserCheck,
  QrCode, Download, Printer,
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  listFreelancers, createFreelancer, updateFreelancer, deleteFreelancer, setFreelancerStatus,
  listAuthorizedEmails, addAuthorizedEmail, removeAuthorizedEmail,
  type FreelancerWithProfile, type AuthorizedEmail,
} from "@/lib/skalaup/freelancers";
import { listRestaurants } from "@/lib/skalaup/restaurants";
import { addScoreEvent } from "@/lib/skalaup/score";
import { getScoreSettings, type CustomCriterion } from "@/lib/skalaup/settings";
import { getFreelancerRatings, type FreelancerRatings } from "@/lib/skalaup/publicRatings";
import type { Restaurant } from "@/lib/skalaup/types";
import {
  maskCpf, maskCep, maskPhone, isValidCpf, isValidCep, isValidPhone,
} from "@/lib/br-format";

type FormState = {
  id?: string;
  name: string;
  email: string;
  phone: string;
  cpf: string;
  pixKey: string;
  bankName: string;
  birthDate: string;
  whatsapp: string;
  homeAddress: string;
  homeCep: string;
  restaurantIds: string[];
  active: boolean;
};

const emptyForm: FormState = {
  name: "", email: "", phone: "", cpf: "", pixKey: "", bankName: "", birthDate: "",
  whatsapp: "", homeAddress: "", homeCep: "",
  restaurantIds: [], active: true,
};

export default function FreelancersPage() {
  const { t } = useTranslation();
  const [items, setItems] = useState<FreelancerWithProfile[]>([]);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [tempPwd, setTempPwd] = useState<string | null>(null);

  // Freelancer self-registration allow-list (client 2026-07-19): admin pre-registers
  // emails; the freelancer then self-registers with that email on the sign-up page.
  const [emailsOpen, setEmailsOpen] = useState(false);
  const [authEmails, setAuthEmails] = useState<AuthorizedEmail[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);

  const loadAuthEmails = useCallback(async () => {
    const { data, error } = await listAuthorizedEmails();
    if (error) { toast.error(error.message); return; }
    setAuthEmails(data);
  }, []);

  const openEmails = () => { setNewEmail(""); setEmailsOpen(true); void loadAuthEmails(); };

  const addEmail = async () => {
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    setEmailBusy(true);
    const { data, error } = await addAuthorizedEmail(email);
    setEmailBusy(false);
    if (error) { toast.error(error.message); return; }
    if (data) { setAuthEmails((xs) => [data, ...xs]); setNewEmail(""); toast.success(t("skala.freelancers.authEmails.added")); }
  };

  const removeEmail = async (id: string) => {
    const { error } = await removeAuthorizedEmail(id);
    if (error) { toast.error(error.message); return; }
    setAuthEmails((xs) => xs.filter((x) => x.id !== id));
  };

  // Manual score adjustment (R2 item 3) — positive-only points + required reason.
  // R15: optionally apply a coordinator-defined custom criterion (may be negative).
  const [scoreTarget, setScoreTarget] = useState<FreelancerWithProfile | null>(null);
  const [scorePts, setScorePts] = useState("");
  const [scoreReason, setScoreReason] = useState("");
  const [scoreCriterionId, setScoreCriterionId] = useState("");
  const [criteria, setCriteria] = useState<CustomCriterion[]>([]);
  const [scoreSaving, setScoreSaving] = useState(false);

  // Per-employee QR + customer ratings (R2 item 5).
  const [qrTarget, setQrTarget] = useState<FreelancerWithProfile | null>(null);
  const [ratings, setRatings] = useState<FreelancerRatings | null>(null);
  const [ratingsLoading, setRatingsLoading] = useState(false);
  const qrBoxRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await listFreelancers();
    if (error) toast.error(error.message);
    setItems(data);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Active clients for the link selector (§3). Coordinators see all of them here.
  useEffect(() => {
    void (async () => {
      const { data } = await listRestaurants({ activeOnly: true });
      setRestaurants(data);
    })();
  }, []);

  // Custom scoring criteria (R15) for the manual-adjustment picker.
  useEffect(() => {
    void (async () => {
      const { data } = await getScoreSettings();
      if (data) setCriteria(data.customCriteria ?? []);
    })();
  }, []);

  const openCreate = () => { setForm(emptyForm); setDialogOpen(true); };
  const openEdit = (f: FreelancerWithProfile) => {
    setForm({
      id: f.id,
      name: f.name ?? "",
      email: f.email ?? "",
      phone: f.phone ?? "",
      cpf: f.profile?.cpf ?? "",
      pixKey: f.profile?.pixKey ?? "",
      bankName: f.profile?.bankName ?? "",
      birthDate: f.profile?.birthDate ? f.profile.birthDate.slice(0, 10) : "",
      whatsapp: f.profile?.whatsapp ?? "",
      homeAddress: f.profile?.homeAddress ?? "",
      homeCep: f.profile?.homeCep ?? "",
      restaurantIds: (f.clients ?? []).map((c) => c.id),
      active: f.status !== "inactive",
    });
    setDialogOpen(true);
  };

  const toggleClient = (id: string) => {
    setForm((prev) => ({
      ...prev,
      restaurantIds: prev.restaurantIds.includes(id)
        ? prev.restaurantIds.filter((x) => x !== id)
        : [...prev.restaurantIds, id],
    }));
  };

  const save = async () => {
    if (!form.name.trim()) { toast.error(t("skala.freelancers.nameRequired")); return; }
    if (!form.id && !form.email.trim()) { toast.error(t("skala.freelancers.emailRequired")); return; }
    if (form.cpf && !isValidCpf(form.cpf)) { toast.error(t("skala.auth.invalidCpf")); return; }
    if (form.phone && !isValidPhone(form.phone)) { toast.error(t("skala.auth.invalidPhone")); return; }
    if (form.whatsapp && !isValidPhone(form.whatsapp)) { toast.error(t("skala.auth.invalidWhatsapp")); return; }
    if (form.homeCep && !isValidCep(form.homeCep)) { toast.error(t("skala.auth.invalidCep")); return; }

    setSaving(true);
    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      cpf: form.cpf.trim() || null,
      pixKey: form.pixKey.trim() || null,
      bankName: form.bankName.trim() || null,
      birthDate: form.birthDate || null,
      whatsapp: form.whatsapp.trim() || null,
      homeAddress: form.homeAddress.trim() || null,
      homeCep: form.homeCep.trim() || null,
      restaurantIds: form.restaurantIds,
    };

    if (form.id) {
      const { error } = await updateFreelancer(form.id, payload);
      if (error) { setSaving(false); toast.error(error.message); return; }
      // Persist the active/inactive toggle only when it actually changed (R17).
      const original = items.find((x) => x.id === form.id);
      const wasActive = original ? original.status !== "inactive" : true;
      if (form.active !== wasActive) {
        const { error: statusError } = await setFreelancerStatus(form.id, form.active ? "active" : "inactive");
        if (statusError) { setSaving(false); toast.error(statusError.message); return; }
      }
      setSaving(false);
      toast.success(t("skala.common.updated"));
    } else {
      const { data, error } = await createFreelancer({ ...payload, email: form.email.trim() });
      setSaving(false);
      if (error) { toast.error(error.message); return; }
      toast.success(t("skala.common.created"));
      // Show the one-time temporary password in a dialog with a copy action (FR-B5).
      if (data?.tempPassword) setTempPwd(data.tempPassword);
    }
    setDialogOpen(false);
    void load();
  };

  const openScore = (f: FreelancerWithProfile) => {
    setScoreTarget(f);
    setScorePts("");
    setScoreReason("");
    setScoreCriterionId("");
  };

  const selectedCriterion = scoreCriterionId ? criteria.find((c) => c.id === scoreCriterionId) ?? null : null;

  const submitScore = async () => {
    if (!scoreTarget) return;
    if (!selectedCriterion) {
      // Free-form adjustment: positive-only points + required reason.
      const pts = Number(scorePts);
      if (!Number.isFinite(pts) || pts <= 0) { toast.error(t("skala.freelancers.score.invalidPoints")); return; }
      if (!scoreReason.trim()) { toast.error(t("skala.freelancers.score.reasonRequired")); return; }
    }
    setScoreSaving(true);
    const occurredOn = new Date().toISOString().slice(0, 10);
    const { error } = await addScoreEvent(
      selectedCriterion
        ? {
            userId: scoreTarget.id, eventType: "manual_adjustment", occurredOn,
            criterionId: selectedCriterion.id, notes: scoreReason.trim() || undefined,
          }
        : {
            userId: scoreTarget.id, eventType: "manual_adjustment", occurredOn,
            points: Number(scorePts), notes: scoreReason.trim(),
          },
    );
    setScoreSaving(false);
    if (error) { toast.error(error.message); return; }
    const shownPts = selectedCriterion ? selectedCriterion.points : Number(scorePts);
    toast.success(t("skala.freelancers.score.added", { points: shownPts, name: scoreTarget.name }));
    setScoreTarget(null);
    void load();
  };

  const ratingUrl = (f: FreelancerWithProfile | null) =>
    f?.profile?.publicRatingToken ? `${window.location.origin}/rate/${f.profile.publicRatingToken}` : "";

  const openQr = async (f: FreelancerWithProfile) => {
    setQrTarget(f);
    setRatings(null);
    setRatingsLoading(true);
    const { data } = await getFreelancerRatings(f.id);
    setRatings(data);
    setRatingsLoading(false);
  };

  const downloadQr = () => {
    const canvas = qrBoxRef.current?.querySelector("canvas");
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `qr-${qrTarget?.name ?? "freelancer"}.png`;
    a.click();
  };

  const printQr = () => {
    const canvas = qrBoxRef.current?.querySelector("canvas");
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    const w = window.open("", "_blank", "width=420,height=560");
    if (!w) return;
    w.document.write(
      `<html><head><title>QR ${qrTarget?.name ?? ""}</title></head>` +
      `<body style="text-align:center;font-family:sans-serif;padding:24px">` +
      `<h2 style="margin:0 0 4px">${qrTarget?.name ?? ""}</h2>` +
      `<p style="color:#666;margin:0 0 16px">${t("skala.freelancers.qr.printCaption")}</p>` +
      `<img src="${dataUrl}" style="width:280px;height:280px"/>` +
      `</body></html>`,
    );
    w.document.close();
    w.focus();
    w.print();
  };

  const reactivate = async (f: FreelancerWithProfile) => {
    const { error } = await setFreelancerStatus(f.id, "active");
    if (error) { toast.error(error.message); return; }
    toast.success(t("skala.freelancers.reactivated", { name: f.name }));
    void load();
  };

  const remove = async (f: FreelancerWithProfile) => {
    if (!window.confirm(t("skala.freelancers.confirmDelete", { name: f.name }))) return;
    const { error } = await deleteFreelancer(f.id);
    if (error) { toast.error(error.message); return; }
    toast.success(t("skala.common.deleted"));
    void load();
  };

  return (
    <AppLayout>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Users className="w-6 h-6 text-primary" /> {t("skala.freelancers.title")}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">{t("skala.freelancers.subtitle")}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={openEmails}>
              <Mail className="w-4 h-4 mr-1.5" />{t("skala.freelancers.authEmails.button")}
            </Button>
            <Button onClick={openCreate}><Plus className="w-4 h-4 mr-1.5" />{t("skala.freelancers.add")}</Button>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">{t("skala.common.loading")}</p>
        ) : items.length === 0 ? (
          <Card className="p-10 text-center text-muted-foreground">{t("skala.freelancers.empty")}</Card>
        ) : (
          <div className="flex flex-col gap-3">
            {items.map((f) => (
              <Card key={f.id} className="p-4 flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-foreground truncate">{f.name}</h3>
                    <Badge variant={f.role === "visitor" ? "secondary" : "default"}>
                      {f.role === "visitor" ? t("skala.freelancers.visitor") : t("skala.freelancers.member")}
                    </Badge>
                    {f.status === "inactive" && (
                      <Badge variant="outline" className="text-rose-600 border-rose-300">
                        {t("skala.freelancers.inactive")}
                      </Badge>
                    )}
                    <span className="flex items-center gap-1 text-amber-500 font-medium text-sm">
                      <Star className="w-4 h-4 fill-current" />
                      {f.profile?.currentScore ?? 0}
                    </span>
                    {f.profile?.currentLevel != null && (
                      <span className="text-xs text-muted-foreground">
                        {t("skala.freelancers.level")} {f.profile.currentLevel}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{f.email}</p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    {f.profile?.cpf && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <IdCard className="w-3 h-3 flex-shrink-0" />{t("skala.auth.cpf")}: {f.profile.cpf}
                      </span>
                    )}
                    {f.profile?.pixKey && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                        <KeyRound className="w-3 h-3 flex-shrink-0" />{t("skala.auth.pixKey")}: {f.profile.pixKey}
                      </span>
                    )}
                    {(f.phone || f.profile?.whatsapp) && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                        <Phone className="w-3 h-3 flex-shrink-0" />
                        {f.phone || ""}{f.phone && f.profile?.whatsapp ? " · " : ""}
                        {f.profile?.whatsapp ? `WhatsApp ${f.profile.whatsapp}` : ""}
                      </span>
                    )}
                    {(f.profile?.homeAddress || f.profile?.homeCep) && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                        <MapPin className="w-3 h-3 flex-shrink-0" />
                        {f.profile?.homeAddress || ""}
                        {f.profile?.homeAddress && f.profile?.homeCep ? " · " : ""}
                        {f.profile?.homeCep ? `CEP ${f.profile.homeCep}` : ""}
                      </span>
                    )}
                    {f.profile?.transport && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Car className="w-3 h-3" />{t(`skala.transport.${f.profile.transport}`)}
                      </span>
                    )}
                  </div>
                  {f.profile?.experience && (
                    <p className="text-xs text-muted-foreground line-clamp-1">{f.profile.experience}</p>
                  )}
                  {f.clients && f.clients.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1 pt-0.5">
                      <Store className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                      {f.clients.map((c) => (
                        <Badge key={c.id} variant="outline" className="text-[10px] font-normal">{c.name}</Badge>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  {f.status === "inactive" && (
                    <Button size="sm" variant="outline" className="text-emerald-600" onClick={() => void reactivate(f)}>
                      <UserCheck className="w-3.5 h-3.5 mr-1" />{t("skala.freelancers.reactivate")}
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => openScore(f)}>
                    <Star className="w-3.5 h-3.5 mr-1" />{t("skala.freelancers.score.button")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void openQr(f)}>
                    <QrCode className="w-3.5 h-3.5 mr-1" />{t("skala.freelancers.qr.button")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openEdit(f)}>
                    <Pencil className="w-3.5 h-3.5 mr-1" />{t("skala.common.edit")}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void remove(f)}>
                    <Trash2 className="w-3.5 h-3.5 mr-1" />{t("skala.common.delete")}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Authorized emails — pre-register freelancer emails for self sign-up. */}
      <Dialog open={emailsOpen} onOpenChange={setEmailsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="w-4 h-4" />{t("skala.freelancers.authEmails.title")}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("skala.freelancers.authEmails.hint")}</p>
          <div className="flex items-center gap-2">
            <Input
              type="email" placeholder="email@exemplo.com" value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addEmail(); } }}
            />
            <Button onClick={() => void addEmail()} disabled={emailBusy || !newEmail.trim()}>
              <Plus className="w-4 h-4 mr-1.5" />{t("skala.freelancers.authEmails.add")}
            </Button>
          </div>
          <div className="max-h-72 overflow-y-auto space-y-2">
            {authEmails.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">{t("skala.freelancers.authEmails.empty")}</p>
            ) : authEmails.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{a.email}</p>
                  {a.claimedAt || a.userId ? (
                    <Badge variant="secondary" className="mt-0.5">{t("skala.freelancers.authEmails.registered")}</Badge>
                  ) : (
                    <Badge variant="outline" className="mt-0.5">{t("skala.freelancers.authEmails.invited")}</Badge>
                  )}
                </div>
                <Button variant="ghost" size="icon" onClick={() => void removeEmail(a.id)} title={t("skala.common.delete")}>
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailsOpen(false)}>{t("skala.common.close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form.id ? t("skala.freelancers.editTitle") : t("skala.freelancers.add")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>{t("skala.freelancers.fullName")}</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" />{t("skala.auth.email")}</Label>
              <Input
                type="email"
                value={form.email}
                disabled={!!form.id}
                placeholder="email@exemplo.com"
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
              {!form.id && (
                <p className="text-[11px] text-muted-foreground">{t("skala.freelancers.emailHint")}</p>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("skala.auth.cpf")}</Label>
                <Input value={form.cpf} inputMode="numeric" placeholder="000.000.000-00"
                  onChange={(e) => setForm({ ...form, cpf: maskCpf(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("skala.auth.pixKey")}</Label>
                <Input value={form.pixKey} placeholder={t("skala.auth.pixKeyPlaceholder")}
                  onChange={(e) => setForm({ ...form, pixKey: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("skala.freelancers.bankName")}</Label>
                <Input value={form.bankName} placeholder={t("skala.freelancers.bankNamePlaceholder")}
                  onChange={(e) => setForm({ ...form, bankName: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("skala.freelancers.birthDate")}</Label>
                <Input type="date" value={form.birthDate}
                  onChange={(e) => setForm({ ...form, birthDate: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("skala.auth.phone")}</Label>
                <Input value={form.phone} inputMode="tel" placeholder="(00) 00000-0000"
                  onChange={(e) => setForm({ ...form, phone: maskPhone(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("skala.auth.whatsapp")}</Label>
                <Input value={form.whatsapp} inputMode="tel" placeholder="(00) 00000-0000"
                  onChange={(e) => setForm({ ...form, whatsapp: maskPhone(e.target.value) })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t("skala.auth.address")}</Label>
              <Input value={form.homeAddress} onChange={(e) => setForm({ ...form, homeAddress: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("skala.auth.cep")}</Label>
              <Input value={form.homeCep} inputMode="numeric" placeholder="00000-000"
                onChange={(e) => setForm({ ...form, homeCep: maskCep(e.target.value) })} />
            </div>
            {/* Client links (§3) — gates which clients' activities the member joins. */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5"><Store className="w-3.5 h-3.5" />{t("skala.freelancers.clients")}</Label>
              {restaurants.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">{t("skala.freelancers.clientsNone")}</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {restaurants.map((r) => {
                      const on = form.restaurantIds.includes(r.id);
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => toggleClient(r.id)}
                          className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                            on
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-background text-muted-foreground hover:bg-muted"
                          }`}
                        >
                          {r.name}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-muted-foreground">{t("skala.freelancers.clientsHint")}</p>
                </>
              )}
            </div>
            {/* Active/inactive toggle (R17) — mirrors the client toggle. Editing only. */}
            {form.id && (
              <div className="flex items-center gap-2 pt-3 border-t">
                <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
                <Label>{t("skala.common.active")}</Label>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("skala.common.cancel")}</Button>
            <Button onClick={() => void save()} disabled={saving}>{t("skala.common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manual score adjustment (R2 item 3) — positive-only + required reason */}
      <Dialog open={scoreTarget !== null} onOpenChange={(o) => { if (!o) setScoreTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Star className="w-5 h-5 text-amber-500" />
              {scoreTarget ? t("skala.freelancers.score.title", { name: scoreTarget.name }) : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-xs text-muted-foreground">
              {selectedCriterion ? t("skala.freelancers.score.criterionHint") : t("skala.freelancers.score.hint")}
            </p>
            {/* Criterion picker (R15) — only when the coordinator has defined active criteria. */}
            {criteria.some((c) => c.active) && (
              <div className="space-y-1.5">
                <Label>{t("skala.freelancers.score.criterionLabel")}</Label>
                <Select value={scoreCriterionId || "free"} onValueChange={(v) => setScoreCriterionId(v === "free" ? "" : v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="free">{t("skala.freelancers.score.criterionFree")}</SelectItem>
                    {criteria.filter((c) => c.active).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.label} ({c.points > 0 ? "+" : ""}{c.points})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>{t("skala.freelancers.score.pointsLabel")}</Label>
              <Input type="number" step={selectedCriterion ? "0.5" : "1"} inputMode="numeric"
                disabled={!!selectedCriterion}
                value={selectedCriterion ? selectedCriterion.points : scorePts}
                placeholder="0" onChange={(e) => setScorePts(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>
                {t("skala.freelancers.score.reasonLabel")}
                {selectedCriterion && <span className="text-muted-foreground font-normal"> · {t("skala.common.optional")}</span>}
              </Label>
              <Textarea value={scoreReason} rows={3}
                placeholder={t("skala.freelancers.score.reasonPlaceholder")}
                onChange={(e) => setScoreReason(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScoreTarget(null)}>{t("skala.common.cancel")}</Button>
            <Button onClick={() => void submitScore()} disabled={scoreSaving}>{t("skala.freelancers.score.confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Per-employee QR + customer ratings (R2 item 5) */}
      <Dialog open={qrTarget !== null} onOpenChange={(o) => { if (!o) setQrTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="w-5 h-5 text-primary" />
              {qrTarget ? t("skala.freelancers.qr.title", { name: qrTarget.name }) : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-xs text-muted-foreground">{t("skala.freelancers.qr.hint")}</p>
            <div ref={qrBoxRef} className="flex flex-col items-center gap-3">
              {qrTarget?.profile?.publicRatingToken ? (
                <div className="rounded-xl border border-border bg-white p-4">
                  <QRCodeCanvas value={ratingUrl(qrTarget)} size={200} includeMargin level="M" />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-6">{t("skala.freelancers.qr.noToken")}</p>
              )}
              {qrTarget?.profile?.publicRatingToken && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={downloadQr}>
                    <Download className="w-3.5 h-3.5 mr-1" />{t("skala.freelancers.qr.download")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={printQr}>
                    <Printer className="w-3.5 h-3.5 mr-1" />{t("skala.freelancers.qr.print")}
                  </Button>
                </div>
              )}
            </div>

            {/* Ratings summary — informational only, never affects the score */}
            <div className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">{t("skala.freelancers.qr.ratingsTitle")}</span>
                {ratings && ratings.count > 0 && (
                  <span className="flex items-center gap-1 text-sm text-amber-500">
                    <Star className="w-4 h-4 fill-current" />
                    {ratings.average.toFixed(1)} · {ratings.count}
                  </span>
                )}
              </div>
              {ratingsLoading ? (
                <p className="text-xs text-muted-foreground mt-2">{t("skala.common.loading")}</p>
              ) : !ratings || ratings.count === 0 ? (
                <p className="text-xs text-muted-foreground mt-2">{t("skala.freelancers.qr.ratingsEmpty")}</p>
              ) : (
                <div className="mt-2 max-h-40 overflow-y-auto space-y-1.5">
                  {ratings.recent.filter((r) => r.comment).map((r) => (
                    <div key={r.id} className="text-xs border-b border-border/60 last:border-0 pb-1.5">
                      <span className="text-amber-500">{"★".repeat(r.stars)}</span>
                      <span className="text-muted-foreground"> — {r.comment}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQrTarget(null)}>{t("skala.common.close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* One-time temporary password (FR-B5) */}
      <Dialog open={tempPwd !== null} onOpenChange={(o) => { if (!o) setTempPwd(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyIcon className="w-5 h-5 text-primary" />{t("skala.freelancers.tempPasswordTitle")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">{t("skala.freelancers.tempPasswordNote")}</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 select-all rounded-md border border-border bg-muted px-3 py-2 font-mono text-base tracking-wider">
                {tempPwd}
              </code>
              <Button
                variant="outline" size="icon"
                onClick={() => { if (tempPwd) { void navigator.clipboard?.writeText(tempPwd); toast.success(t("skala.common.copied")); } }}
                aria-label={t("skala.common.copy")}
              >
                <Copy className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setTempPwd(null)}>{t("skala.common.close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
