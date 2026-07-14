import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Users, Star, Car, IdCard, KeyRound, Phone, MapPin, Plus, Pencil, Trash2, Mail, Copy, KeyRound as KeyIcon, Store,
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  listFreelancers, createFreelancer, updateFreelancer, deleteFreelancer,
  type FreelancerWithProfile,
} from "@/lib/skalaup/freelancers";
import { listRestaurants } from "@/lib/skalaup/restaurants";
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
  whatsapp: string;
  homeAddress: string;
  homeCep: string;
  restaurantIds: string[];
};

const emptyForm: FormState = {
  name: "", email: "", phone: "", cpf: "", pixKey: "", whatsapp: "", homeAddress: "", homeCep: "",
  restaurantIds: [],
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

  const openCreate = () => { setForm(emptyForm); setDialogOpen(true); };
  const openEdit = (f: FreelancerWithProfile) => {
    setForm({
      id: f.id,
      name: f.name ?? "",
      email: f.email ?? "",
      phone: f.phone ?? "",
      cpf: f.profile?.cpf ?? "",
      pixKey: f.profile?.pixKey ?? "",
      whatsapp: f.profile?.whatsapp ?? "",
      homeAddress: f.profile?.homeAddress ?? "",
      homeCep: f.profile?.homeCep ?? "",
      restaurantIds: (f.clients ?? []).map((c) => c.id),
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
      whatsapp: form.whatsapp.trim() || null,
      homeAddress: form.homeAddress.trim() || null,
      homeCep: form.homeCep.trim() || null,
      restaurantIds: form.restaurantIds,
    };

    if (form.id) {
      const { error } = await updateFreelancer(form.id, payload);
      setSaving(false);
      if (error) { toast.error(error.message); return; }
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
          <Button onClick={openCreate}><Plus className="w-4 h-4 mr-1.5" />{t("skala.freelancers.add")}</Button>
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("skala.common.cancel")}</Button>
            <Button onClick={() => void save()} disabled={saving}>{t("skala.common.save")}</Button>
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
