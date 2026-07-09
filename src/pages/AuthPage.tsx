import { useState } from "react";
import { useNavigate, useLocation, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { roleHomePath } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { SUPPORTED_LANGUAGES, setStoredLanguage, type SupportedLanguage } from "@/i18n/config";
import {
  maskCpf, maskCep, maskPhone, isValidCpf, isValidCep, isValidPhone,
} from "@/lib/br-format";

type Mode = "login" | "register";
const SIGNUP_ROLES = ["freelancer", "restaurant_manager", "coordinator"] as const;

export default function AuthPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { login, register, isAuthenticated, user } = useAuth();

  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<string>("freelancer");
  // Freelancer registration "ficha" fields (only collected when role === freelancer).
  const [phone, setPhone] = useState("");
  const [cpf, setCpf] = useState("");
  const [pixKey, setPixKey] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [homeAddress, setHomeAddress] = useState("");
  const [homeCep, setHomeCep] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (isAuthenticated && user) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from || roleHomePath[user.role]} replace />;
  }

  const changeLanguage = (lng: SupportedLanguage) => {
    void i18n.changeLanguage(lng);
    setStoredLanguage(lng);
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setNotice(null);
    setPassword("");
  };

  const roleError = (msg?: string) => {
    if (msg === "auth.pending") return t("skala.auth.errPending");
    if (msg === "auth.rejected") return t("skala.auth.errRejected");
    if (msg === "auth.inactive") return t("skala.auth.errInactive");
    if (msg && /already exists/i.test(msg)) return t("skala.auth.emailExists");
    return msg || t("skala.auth.error");
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    if (mode === "login") {
      const res = await login(email.trim(), password);
      setSubmitting(false);
      if (res.success) navigate(roleHomePath[user?.role ?? "freelancer"], { replace: true });
      else setError(roleError(res.error));
    } else {
      // Light client-side validation for the optional Brazilian-format fields.
      if (role === "freelancer") {
        if (cpf && !isValidCpf(cpf)) { setSubmitting(false); setError(t("skala.auth.invalidCpf")); return; }
        if (phone && !isValidPhone(phone)) { setSubmitting(false); setError(t("skala.auth.invalidPhone")); return; }
        if (whatsapp && !isValidPhone(whatsapp)) { setSubmitting(false); setError(t("skala.auth.invalidWhatsapp")); return; }
        if (homeCep && !isValidCep(homeCep)) { setSubmitting(false); setError(t("skala.auth.invalidCep")); return; }
      }
      const res = await register({
        name: name.trim(), email: email.trim(), password, role,
        ...(role === "freelancer" ? {
          phone: phone.trim() || undefined,
          cpf: cpf.trim() || undefined,
          pixKey: pixKey.trim() || undefined,
          whatsapp: whatsapp.trim() || undefined,
          homeAddress: homeAddress.trim() || undefined,
          homeCep: homeCep.trim() || undefined,
        } : {}),
      });
      setSubmitting(false);
      if (res.success) {
        setNotice(t("skala.auth.pendingNotice"));
        setMode("login");
        setName(""); setPassword("");
        setPhone(""); setCpf(""); setPixKey(""); setWhatsapp(""); setHomeAddress(""); setHomeCep("");
      } else {
        setError(roleError(res.error));
      }
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Brand panel */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#F8719D] via-[#FF9E7A] to-[#62C7E6]" />
        <div className="relative z-10 flex flex-col justify-between p-12 text-white">
          <div className="flex items-center">
            <img src="/logo.png" alt="SkalaUp" className="h-24 w-auto object-contain" />
          </div>
          <div className="space-y-4">
            <h2 className="text-4xl font-bold leading-tight">{t("skala.auth.heroTitle")}</h2>
            <p className="text-white/85 text-lg max-w-md">{t("skala.auth.heroSubtitle")}</p>
          </div>
          <p className="text-white/70 text-sm">{t("skala.auth.tagline")}</p>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex-1 flex items-center justify-center p-6 bg-background">
        <div className="w-full max-w-sm space-y-6">
          <div className="flex justify-end gap-1">
            {SUPPORTED_LANGUAGES.map((lang) => (
              <Button
                key={lang.code}
                variant={i18n.language === lang.code ? "secondary" : "ghost"}
                size="sm"
                onClick={() => changeLanguage(lang.code)}
              >
                {lang.code === "en" ? "EN" : "PT"}
              </Button>
            ))}
          </div>

          <div className="lg:hidden flex items-center">
            <img src="/logo.png" alt="SkalaUp" className="h-10 w-auto object-contain" />
          </div>

          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {mode === "login" ? t("skala.auth.title") : t("skala.auth.registerTitle")}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {mode === "login" ? t("skala.auth.subtitle") : t("skala.auth.registerSubtitle")}
            </p>
          </div>

          {notice && (
            <div className="rounded-md bg-success/10 border border-success/30 px-3 py-2 text-sm text-success">
              {notice}
            </div>
          )}

          <form onSubmit={onSubmit} className="space-y-4">
            {mode === "register" && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="name">{t("skala.auth.name")}</Label>
                  <Input id="name" type="text" autoComplete="name" value={name}
                    onChange={(e) => setName(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("skala.auth.role")}</Label>
                  <Select value={role} onValueChange={setRole}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SIGNUP_ROLES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r === "coordinator" ? t("skala.roles.coordinator")
                            : r === "restaurant_manager" ? t("skala.roles.restaurantManager")
                              : t("skala.roles.freelancer")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {role === "freelancer" && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="cpf">{t("skala.auth.cpf")}</Label>
                        <Input id="cpf" inputMode="numeric" placeholder="000.000.000-00"
                          value={cpf} onChange={(e) => setCpf(maskCpf(e.target.value))} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="pix">{t("skala.auth.pixKey")}</Label>
                        <Input id="pix" value={pixKey}
                          placeholder={t("skala.auth.pixKeyPlaceholder")}
                          onChange={(e) => setPixKey(e.target.value)} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="phone">{t("skala.auth.phone")}</Label>
                        <Input id="phone" inputMode="tel" placeholder="(00) 00000-0000"
                          value={phone} onChange={(e) => setPhone(maskPhone(e.target.value))} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="whatsapp">{t("skala.auth.whatsapp")}</Label>
                        <Input id="whatsapp" inputMode="tel" placeholder="(00) 00000-0000"
                          value={whatsapp} onChange={(e) => setWhatsapp(maskPhone(e.target.value))} />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="address">{t("skala.auth.address")}</Label>
                      <Input id="address" value={homeAddress}
                        onChange={(e) => setHomeAddress(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="cep">{t("skala.auth.cep")}</Label>
                      <Input id="cep" inputMode="numeric" placeholder="00000-000"
                        value={homeCep} onChange={(e) => setHomeCep(maskCep(e.target.value))} />
                    </div>
                  </>
                )}
              </>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">{t("skala.auth.email")}</Label>
              <Input id="email" type="email" autoComplete="email" value={email}
                onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">{t("skala.auth.password")}</Label>
              <Input id="password" type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                value={password} onChange={(e) => setPassword(e.target.value)} required
                minLength={mode === "register" ? 6 : undefined} />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting
                ? (mode === "login" ? t("skala.auth.signingIn") : t("skala.auth.registering"))
                : (mode === "login" ? t("skala.auth.signIn") : t("skala.auth.signUp"))}
            </Button>
          </form>

          <p className="text-sm text-center text-muted-foreground">
            {mode === "login" ? (
              <>
                {t("skala.auth.noAccount")}{" "}
                <button type="button" className="text-primary font-medium hover:underline"
                  onClick={() => switchMode("register")}>
                  {t("skala.auth.signUp")}
                </button>
              </>
            ) : (
              <>
                {t("skala.auth.haveAccount")}{" "}
                <button type="button" className="text-primary font-medium hover:underline"
                  onClick={() => switchMode("login")}>
                  {t("skala.auth.signIn")}
                </button>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
