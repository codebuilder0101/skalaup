import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, MapPin, Store } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  listRestaurants, createRestaurant, updateRestaurant, deleteRestaurant,
  type RestaurantInput,
} from "@/lib/skalaup/restaurants";
import type { Restaurant, ShiftTemplate, NoShowDiscountMode } from "@/lib/skalaup/types";
import { maskCep, maskCnpj, isValidCep, isValidCnpj } from "@/lib/br-format";

type SlotRow = { label: string; startTime: string; endTime: string };
type WeekendBonusChoice = "inherit" | "on" | "off";

type FormState = {
  id?: string;
  name: string;
  address: string;
  cep: string;
  cnpj: string;
  active: boolean;
  // shift times (HH:MM) — each meal period can hold multiple staggered slots
  lunchSlots: SlotRow[];
  dinnerSlots: SlotRow[];
  // pay — empty string = inherit the global default (stored as NULL)
  basePayPerShift: string;
  bonusPayPerShift: string;
  // discounts / bonus
  lateDiscountAmount: string;
  noShowDiscountMode: string; // "" = inherit
  noShowCustomAmount: string;
  weekendBonus: WeekendBonusChoice;
};

const emptyForm: FormState = {
  name: "", address: "", cep: "", cnpj: "", active: true,
  lunchSlots: [],
  dinnerSlots: [],
  basePayPerShift: "", bonusPayPerShift: "",
  lateDiscountAmount: "", noShowDiscountMode: "", noShowCustomAmount: "",
  weekendBonus: "inherit",
};

const emptySlot = (): SlotRow => ({ label: "", startTime: "", endTime: "" });
const toStr = (v: string | number | null | undefined) => (v == null ? "" : String(v));
const toNum = (s: string) => (s.trim() === "" ? null : Number(s));

// "ok" | "incomplete" (only one of start/end filled) | "order" (end <= start)
function checkSlot(s: SlotRow): "ok" | "incomplete" | "order" {
  const a = s.startTime.trim();
  const b = s.endTime.trim();
  if (!a && !b) return "ok";
  if (!a || !b) return "incomplete";
  if (b <= a) return "order";
  return "ok";
}

// Staggered slots within a meal period MAY overlap (e.g. 12:00–16:00 and 13:00–17:00) —
// they're independent time windows. Only exact duplicates (same start AND end) are rejected.
function hasDuplicate(slots: SlotRow[]): boolean {
  const seen = new Set<string>();
  for (const s of slots) {
    if (!s.startTime || !s.endTime) continue;
    const key = `${s.startTime}-${s.endTime}`;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

export default function RestaurantsPage() {
  const { t } = useTranslation();
  const [items, setItems] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await listRestaurants();
    if (error) toast.error(error.message);
    setItems(data);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openCreate = () => { setForm(emptyForm); setDialogOpen(true); };
  const openEdit = (r: Restaurant) => {
    const toSlots = (type: "lunch" | "dinner"): SlotRow[] =>
      (r.shiftTemplates ?? [])
        .filter((s) => s.shiftType === type)
        .map((s) => ({ label: s.label ?? "", startTime: s.startTime, endTime: s.endTime }));
    setForm({
      id: r.id, name: r.name, address: r.address ?? "", cep: r.cep ?? "", cnpj: r.cnpj ?? "",
      active: r.active,
      lunchSlots: toSlots("lunch"),
      dinnerSlots: toSlots("dinner"),
      basePayPerShift: toStr(r.basePayPerShift),
      bonusPayPerShift: toStr(r.bonusPayPerShift),
      lateDiscountAmount: toStr(r.lateDiscountAmount),
      noShowDiscountMode: r.noShowDiscountMode ?? "",
      noShowCustomAmount: toStr(r.noShowCustomAmount),
      weekendBonus: r.weekendBonusEnabled == null ? "inherit" : (r.weekendBonusEnabled ? "on" : "off"),
    });
    setDialogOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) { toast.error(t("skala.restaurants.nameRequired")); return; }
    if (form.cnpj && !isValidCnpj(form.cnpj)) { toast.error(t("skala.restaurants.invalidCnpj")); return; }
    if (form.cep && !isValidCep(form.cep)) { toast.error(t("skala.restaurants.invalidCep")); return; }

    // Shift times — validate every slot, then ensure no overlap within a period.
    const periods = [
      { type: "lunch" as const, list: form.lunchSlots },
      { type: "dinner" as const, list: form.dinnerSlots },
    ];
    for (const { list } of periods) {
      for (const s of list) {
        const r = checkSlot(s);
        if (r === "incomplete") { toast.error(t("skala.restaurants.errShiftIncomplete")); return; }
        if (r === "order") { toast.error(t("skala.restaurants.errEndBeforeStart")); return; }
      }
      if (hasDuplicate(list)) { toast.error(t("skala.restaurants.errDuplicate")); return; }
    }

    // Amounts ≥ 0
    const amounts = [form.basePayPerShift, form.bonusPayPerShift, form.lateDiscountAmount, form.noShowCustomAmount];
    for (const a of amounts) {
      if (a.trim() === "") continue;
      const n = Number(a);
      if (!Number.isFinite(n) || n < 0) { toast.error(t("skala.restaurants.errInvalidAmount")); return; }
    }
    if (form.noShowDiscountMode === "custom" && form.noShowCustomAmount.trim() === "") {
      toast.error(t("skala.restaurants.errCustomRequired")); return;
    }

    const shiftTemplates: ShiftTemplate[] = [];
    for (const { type, list } of periods) {
      for (const s of list) {
        if (s.startTime && s.endTime) {
          shiftTemplates.push({ shiftType: type, label: s.label.trim() || null, startTime: s.startTime, endTime: s.endTime });
        }
      }
    }

    const input: RestaurantInput = {
      name: form.name.trim(),
      address: form.address.trim() || null,
      cep: form.cep.trim() || null,
      cnpj: form.cnpj.trim() || null,
      active: form.active,
      basePayPerShift: toNum(form.basePayPerShift),
      bonusPayPerShift: toNum(form.bonusPayPerShift),
      lateDiscountAmount: toNum(form.lateDiscountAmount),
      noShowDiscountMode: (form.noShowDiscountMode || null) as NoShowDiscountMode | null,
      noShowCustomAmount: toNum(form.noShowCustomAmount),
      weekendBonusEnabled: form.weekendBonus === "inherit" ? null : form.weekendBonus === "on",
      shiftTemplates,
    };

    setSaving(true);
    const res = form.id ? await updateRestaurant(form.id, input) : await createRestaurant(input);
    setSaving(false);
    if (res.error) { toast.error(res.error.message); return; }
    toast.success(t(form.id ? "skala.common.updated" : "skala.common.created"));
    setDialogOpen(false);
    void load();
  };

  const remove = async (r: Restaurant) => {
    if (!window.confirm(t("skala.restaurants.confirmDelete", { name: r.name }))) return;
    const { error } = await deleteRestaurant(r.id);
    if (error) { toast.error(error.message); return; }
    toast.success(t("skala.common.deleted"));
    void load();
  };

  return (
    <AppLayout>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Store className="w-6 h-6 text-primary" /> {t("skala.restaurants.title")}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">{t("skala.restaurants.subtitle")}</p>
          </div>
          <Button onClick={openCreate}><Plus className="w-4 h-4 mr-1.5" />{t("skala.restaurants.add")}</Button>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">{t("skala.common.loading")}</p>
        ) : items.length === 0 ? (
          <Card className="p-10 text-center text-muted-foreground">{t("skala.restaurants.empty")}</Card>
        ) : (
          <div className="flex flex-col gap-3">
            {items.map((r) => (
              <Card key={r.id} className="p-4 flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-foreground truncate">{r.name}</h3>
                    <Badge variant={r.active ? "default" : "secondary"}>
                      {r.active ? t("skala.common.active") : t("skala.common.inactive")}
                    </Badge>
                  </div>
                  {(r.address || r.cep) && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5 truncate">
                      <MapPin className="w-3 h-3 flex-shrink-0" />
                      {r.address}{r.address && r.cep ? " · " : ""}{r.cep ? `CEP ${r.cep}` : ""}
                    </p>
                  )}
                  {r.cnpj && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">CNPJ: {r.cnpj}</p>
                  )}
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <Button size="sm" variant="outline" onClick={() => openEdit(r)}>
                    <Pencil className="w-3.5 h-3.5 mr-1" />{t("skala.common.edit")}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void remove(r)}>
                    <Trash2 className="w-3.5 h-3.5 mr-1" />{t("skala.common.delete")}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? t("skala.restaurants.editTitle") : t("skala.restaurants.add")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>{t("skala.restaurants.name")}</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("skala.restaurants.address")}</Label>
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("skala.restaurants.cep")}</Label>
                <Input
                  value={form.cep}
                  inputMode="numeric"
                  placeholder="00000-000"
                  onChange={(e) => setForm({ ...form, cep: maskCep(e.target.value) })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("skala.restaurants.cnpj")}</Label>
                <Input
                  value={form.cnpj}
                  inputMode="numeric"
                  placeholder="00.000.000/0000-00"
                  onChange={(e) => setForm({ ...form, cnpj: maskCnpj(e.target.value) })}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
              <Label>{t("skala.common.active")}</Label>
            </div>

            {/* --- Shift times (multiple staggered slots per meal period) --- */}
            <div className="space-y-4 pt-3 border-t">
              <h4 className="text-sm font-semibold text-foreground">{t("skala.restaurants.sectionShifts")}</h4>
              {([
                { key: "lunchSlots" as const, label: t("skala.restaurants.shiftLunch"), add: t("skala.restaurants.addLunchTime") },
                { key: "dinnerSlots" as const, label: t("skala.restaurants.shiftDinner"), add: t("skala.restaurants.addDinnerTime") },
              ]).map(({ key, label, add }) => {
                const list = form[key];
                const update = (idx: number, patch: Partial<SlotRow>) =>
                  setForm({ ...form, [key]: list.map((s, i) => (i === idx ? { ...s, ...patch } : s)) });
                const addRow = () => setForm({ ...form, [key]: [...list, emptySlot()] });
                const removeRow = (idx: number) => setForm({ ...form, [key]: list.filter((_, i) => i !== idx) });
                return (
                  <div key={key} className="space-y-2">
                    <p className="text-xs font-medium text-foreground">{label}</p>
                    {list.length === 0 && (
                      <p className="text-xs text-muted-foreground">{t("skala.restaurants.noSlots")}</p>
                    )}
                    {list.map((s, idx) => (
                      <div key={idx} className="flex flex-wrap items-center gap-2">
                        <Input
                          type="time" className="flex-1 min-w-[110px]"
                          value={s.startTime}
                          onChange={(e) => update(idx, { startTime: e.target.value })}
                        />
                        <span className="text-muted-foreground text-xs">–</span>
                        <Input
                          type="time" className="flex-1 min-w-[110px]"
                          value={s.endTime}
                          onChange={(e) => update(idx, { endTime: e.target.value })}
                        />
                        <Input
                          className="w-full sm:w-28"
                          placeholder={t("skala.restaurants.slotLabelPlaceholder")}
                          value={s.label}
                          onChange={(e) => update(idx, { label: e.target.value })}
                        />
                        <Button
                          type="button" size="icon" variant="ghost"
                          className="text-destructive flex-shrink-0"
                          onClick={() => removeRow(idx)}
                          aria-label={t("skala.common.delete")}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                    <Button type="button" size="sm" variant="outline" onClick={addRow}>
                      <Plus className="w-3.5 h-3.5 mr-1" />{add}
                    </Button>
                  </div>
                );
              })}
            </div>

            {/* --- Pay --- */}
            <div className="space-y-3 pt-3 border-t">
              <h4 className="text-sm font-semibold text-foreground">{t("skala.restaurants.sectionPay")}</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>{t("skala.restaurants.basePay")}</Label>
                  <Input
                    type="number" min="0" step="0.01" inputMode="decimal"
                    placeholder={t("skala.restaurants.inheritGlobal")}
                    value={form.basePayPerShift}
                    onChange={(e) => setForm({ ...form, basePayPerShift: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("skala.restaurants.bonusPay")}</Label>
                  <Input
                    type="number" min="0" step="0.01" inputMode="decimal"
                    placeholder={t("skala.restaurants.inheritGlobal")}
                    value={form.bonusPayPerShift}
                    onChange={(e) => setForm({ ...form, bonusPayPerShift: e.target.value })}
                  />
                </div>
              </div>
            </div>

            {/* --- Discounts & bonus --- */}
            <div className="space-y-3 pt-3 border-t">
              <h4 className="text-sm font-semibold text-foreground">{t("skala.restaurants.sectionDiscounts")}</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>{t("skala.restaurants.lateDiscount")}</Label>
                  <Input
                    type="number" min="0" step="0.01" inputMode="decimal"
                    placeholder={t("skala.restaurants.inheritGlobal")}
                    value={form.lateDiscountAmount}
                    onChange={(e) => setForm({ ...form, lateDiscountAmount: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("skala.restaurants.noShowMode")}</Label>
                  <Select
                    value={form.noShowDiscountMode || "inherit"}
                    onValueChange={(v) => setForm({ ...form, noShowDiscountMode: v === "inherit" ? "" : v })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="inherit">{t("skala.restaurants.inheritGlobal")}</SelectItem>
                      <SelectItem value="highest_shift">{t("skala.restaurants.noShowHighest")}</SelectItem>
                      <SelectItem value="base_shift">{t("skala.restaurants.noShowBase")}</SelectItem>
                      <SelectItem value="custom">{t("skala.restaurants.noShowCustom")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {form.noShowDiscountMode === "custom" && (
                <div className="space-y-1.5">
                  <Label>{t("skala.restaurants.customAmount")}</Label>
                  <Input
                    type="number" min="0" step="0.01" inputMode="decimal"
                    value={form.noShowCustomAmount}
                    onChange={(e) => setForm({ ...form, noShowCustomAmount: e.target.value })}
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label>{t("skala.restaurants.weekendBonus")}</Label>
                <Select
                  value={form.weekendBonus}
                  onValueChange={(v) => setForm({ ...form, weekendBonus: v as WeekendBonusChoice })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">{t("skala.restaurants.weekendInherit")}</SelectItem>
                    <SelectItem value="on">{t("skala.restaurants.weekendOn")}</SelectItem>
                    <SelectItem value="off">{t("skala.restaurants.weekendOff")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("skala.common.cancel")}</Button>
            <Button onClick={() => void save()} disabled={saving}>{t("skala.common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
