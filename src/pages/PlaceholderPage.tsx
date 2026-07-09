import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/layout/AppLayout";
import { Construction } from "lucide-react";

interface PlaceholderPageProps {
  titleKey: string;
  descriptionKey: string;
}

export default function PlaceholderPage({ titleKey, descriptionKey }: PlaceholderPageProps) {
  const { t } = useTranslation();
  return (
    <AppLayout>
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-3">
          <Construction className="w-12 h-12 text-muted-foreground/40 mx-auto" />
          <h1 className="text-xl font-bold text-foreground">{t(titleKey)}</h1>
          <p className="text-sm text-muted-foreground max-w-md">{t(descriptionKey)}</p>
        </div>
      </div>
    </AppLayout>
  );
}
