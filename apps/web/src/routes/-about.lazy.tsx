import { ExternalLink, Github, Globe, Plane, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PanelBody, PanelHeader, PanelLayout } from "@/shared/components/layout/PanelLayout";
import { LanguageSelector } from "@/shared/components/layout/LanguageSelector";

const GITHUB_URL = "https://github.com/anabelle/acars.pub";

const highlightKeys = [
  { icon: Globe, titleKey: "nostr.title", descKey: "nostr.desc" },
  { icon: Plane, titleKey: "realtime.title", descKey: "realtime.desc" },
  { icon: Zap, titleKey: "bitcoin.title", descKey: "bitcoin.desc" },
];

export default function AboutPage() {
  const { t } = useTranslation("about");
  const { t: tc } = useTranslation("common");

  return (
    <PanelLayout>
      <PanelHeader title={t("title")} subtitle={t("subtitle")} />
      <PanelBody className="space-y-6 pt-3 sm:pt-4">
        {/* Description */}
        <section className="space-y-3">
          <p className="text-sm leading-relaxed text-muted-foreground">
            <strong className="text-foreground">{t("acarsTitle")}</strong> {t("acarsDesc")}
          </p>
        </section>

        {/* Highlights */}
        <section className="space-y-3">
          {highlightKeys.map((item) => (
            <div
              key={item.titleKey}
              className="flex gap-3 rounded-xl border border-border/60 bg-background/60 p-3 backdrop-blur-sm"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <item.icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">{t(item.titleKey)}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {t(item.descKey)}
                </p>
              </div>
            </div>
          ))}
        </section>

        {/* Language Selector */}
        <section className="flex items-center justify-between rounded-xl border border-border/60 bg-background/60 px-4 py-3 backdrop-blur-sm">
          <span className="text-sm font-medium text-foreground">{tc("language.label")}</span>
          <LanguageSelector />
        </section>

        {/* Links */}
        <section className="space-y-2">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/60 px-4 py-3 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5"
          >
            <Github className="h-5 w-5 shrink-0 text-muted-foreground" />
            <span className="flex-1">{t("viewOnGithub")}</span>
            <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
          </a>
          <a
            href="https://nostr.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/60 px-4 py-3 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5"
          >
            <Globe className="h-5 w-5 shrink-0 text-muted-foreground" />
            <span className="flex-1">{t("learnNostr")}</span>
            <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
          </a>
        </section>

        {/* Footer */}
        <p className="text-center text-[11px] text-muted-foreground/60">{t("license")}</p>
      </PanelBody>
    </PanelLayout>
  );
}
