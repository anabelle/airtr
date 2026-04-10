import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PanelBody, PanelHeader, PanelLayout } from "./PanelLayout";

export function PanelLoadingState() {
  const { t } = useTranslation("common");

  return (
    <PanelLayout>
      <PanelHeader title={t("panel.loadingTitle")} subtitle={t("panel.loadingSubtitle")} />
      <PanelBody className="pt-3 sm:pt-4">
        <div
          role="status"
          aria-live="polite"
          className="flex min-h-[18rem] flex-col items-center justify-center gap-4 rounded-[24px] border border-dashed border-border/60 bg-background/30 px-6 py-8 text-center"
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-primary">
            <Loader2 className="h-7 w-7 animate-spin" aria-hidden="true" />
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-semibold text-foreground">{t("panel.loadingMessage")}</p>
            <p className="max-w-[30ch] text-xs leading-relaxed text-muted-foreground sm:text-sm">
              {t("panel.loadingDescription")}
            </p>
          </div>
        </div>
      </PanelBody>
    </PanelLayout>
  );
}
