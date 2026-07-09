import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/layout/AppLayout";
import { Settings, Globe } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  SUPPORTED_LANGUAGES,
  setStoredLanguage,
  type SupportedLanguage,
} from "@/i18n/config";

const SettingsPage = () => {
  const { t, i18n } = useTranslation();

  const handleLanguageChange = (lang: string) => {
    const code = lang as SupportedLanguage;
    setStoredLanguage(code);
    i18n.changeLanguage(code);
  };

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-2xl">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Settings className="w-5 h-5 text-accent" />
            {t("settings.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("settings.description")}
          </p>
        </div>

        <div className="glass-card rounded-lg p-6 space-y-6">
          <div>
            <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <Globe className="w-4 h-4" />
              {t("settings.preferences")}
            </h2>

            <div className="space-y-2">
              <Label htmlFor="language-select" className="text-sm font-medium">
                {t("settings.language")}
              </Label>
              <p className="text-xs text-muted-foreground mb-3">
                {t("settings.languageDescription")}
              </p>
              <Select
                value={
                  SUPPORTED_LANGUAGES.some((l) => l.code === i18n.language)
                    ? i18n.language
                    : i18n.language.startsWith("pt") ? "pt-BR" : "en"
                }
                onValueChange={handleLanguageChange}
              >
                <SelectTrigger id="language-select" className="w-full max-w-xs">
                  <SelectValue/>
                </SelectTrigger>
                <SelectContent>
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <SelectItem key={lang.code} value={lang.code}>
                      {lang.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default SettingsPage;
