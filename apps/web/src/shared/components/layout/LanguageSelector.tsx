import { Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import { supportedLanguages } from "@/i18n";

function safeGetStoredLanguage(): string | null {
  if (typeof window === "undefined") return null;
  const storage = window.localStorage;
  if (!storage || typeof storage.getItem !== "function") return null;
  try {
    return storage.getItem("acars-language");
  } catch {
    return null;
  }
}

function safeClearStoredLanguage() {
  if (typeof window === "undefined") return;
  const storage = window.localStorage;
  if (!storage || typeof storage.removeItem !== "function") return;
  try {
    storage.removeItem("acars-language");
  } catch {
    // Ignore storage access failures and fall back to runtime detection only.
  }
}

export function LanguageSelector() {
  const { t, i18n } = useTranslation("common");

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (value === "auto") {
      // Remove manual override so the detector falls back to browser prefs
      safeClearStoredLanguage();
      // Detect from browser settings (navigator.language)
      const detected = navigator.language.split("-")[0];
      const supported = Object.keys(supportedLanguages);
      i18n.changeLanguage(supported.includes(detected) ? detected : "en");
    } else {
      i18n.changeLanguage(value);
    }
  };

  // Check if a manual override is stored
  const storedLang = safeGetStoredLanguage();
  const currentValue = storedLang ?? "auto";

  return (
    <div className="flex items-center gap-2">
      <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
      <label htmlFor="language-select" className="sr-only">
        {t("language.label")}
      </label>
      <select
        id="language-select"
        value={currentValue}
        onChange={handleChange}
        className="min-h-9 rounded-md border border-border bg-background/70 px-2 py-1 text-sm text-foreground focus:border-primary/60 focus:outline-none"
      >
        <option value="auto">{t("language.auto")}</option>
        {Object.entries(supportedLanguages).map(([code, name]) => (
          <option key={code} value={code}>
            {name}
          </option>
        ))}
      </select>
    </div>
  );
}
