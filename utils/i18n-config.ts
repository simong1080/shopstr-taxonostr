export type SiteLanguageCode =
  | "en"
  | "ar"
  | "ca"
  | "de"
  | "eo"
  | "es"
  | "eu"
  | "fi"
  | "fr"
  | "gl"
  | "he"
  | "it"
  | "ja"
  | "ko"
  | "nn"
  | "nb"
  | "pt"
  | "ru"
  | "sv"
  | "th"
  | "tr"
  | "uk"
  | "yue"
  | "zh";

export interface SiteLanguageOption {
  code: SiteLanguageCode;
  label: string;
}

export const DEFAULT_SITE_LANGUAGE: SiteLanguageCode = "en";

export const SITE_LANGUAGE_OPTIONS: SiteLanguageOption[] = [
  { code: "ar", label: "العربية" },
  { code: "ca", label: "Català" },
  { code: "de", label: "Deutsch" },
  { code: "eo", label: "Esperanto" },
  { code: "es", label: "Español" },
  { code: "eu", label: "Euskara" },
  { code: "fi", label: "Suomi" },
  { code: "fr", label: "Français" },
  { code: "gl", label: "Galego" },
  { code: "he", label: "עברית" },
  { code: "it", label: "Italiano" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "nn", label: "Norsk nynorsk" },
  { code: "nb", label: "Norsk bokmål" },
  { code: "pt", label: "Português" },
  { code: "ru", label: "Русский" },
  { code: "sv", label: "Svenska" },
  { code: "th", label: "ไทย" },
  { code: "tr", label: "Türkçe" },
  { code: "uk", label: "Українська" },
  { code: "yue", label: "粵語" },
  { code: "zh", label: "中文" },
  { code: "en", label: "English" },
];

export const RTL_SITE_LANGUAGES = new Set<SiteLanguageCode>(["ar", "he"]);

export function normalizeSiteLanguage(value?: string | null): SiteLanguageCode {
  if (!value) return DEFAULT_SITE_LANGUAGE;
  const normalized = value.toLowerCase();
  const exact = SITE_LANGUAGE_OPTIONS.find(
    (option) => option.code === normalized
  );
  if (exact) return exact.code;
  const prefix = SITE_LANGUAGE_OPTIONS.find((option) =>
    normalized.startsWith(option.code)
  );
  return prefix?.code || DEFAULT_SITE_LANGUAGE;
}
