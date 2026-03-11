import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getDetailReturnTo } from "@/shared/lib/permalinkNavigation";

type DetailWorkspaceFrameProps = {
  eyebrow: string;
  title: string;
  description: string;
};

export function DetailWorkspaceFrame({ eyebrow, title, description }: DetailWorkspaceFrameProps) {
  const { t } = useTranslation("common");
  const returnTo = getDetailReturnTo();

  return (
    <div className="pointer-events-none absolute left-6 top-6 z-20 hidden max-w-sm sm:block">
      <div className="pointer-events-auto rounded-[22px] border border-border/70 bg-background/78 p-4 shadow-[0_18px_50px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
        <div className="flex items-start gap-3">
          <Link
            to={returnTo}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border/60 bg-background/70 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            aria-label={t("detail.backAria")}
            title={t("detail.backTitle")}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </Link>

          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary/80">
              {eyebrow}
            </p>
            <h1 className="mt-1 text-lg font-black tracking-tight text-foreground">{title}</h1>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
          </div>
        </div>

        <div className="mt-3 inline-flex rounded-full border border-border/60 bg-background/60 px-3 py-1 text-[11px] font-semibold text-muted-foreground">
          {t("detail.workspaceHint")}
        </div>
      </div>
    </div>
  );
}
