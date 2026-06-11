export type TaxonomySourceSettings = {
  trustedPubkeys: string[];
  relayUrls: string[];
};

export type ActiveTaxonomySourceSettings = TaxonomySourceSettings & {
  isOverride: boolean;
};

export const TAXONOMY_SOURCE_SETTINGS_STORAGE_KEY =
  "taxonostrTaxonomySourceSettings";

export function uniqueTrimmed(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function normalizeTaxonomySourceSettings(
  settings: Partial<TaxonomySourceSettings> | null | undefined
): TaxonomySourceSettings {
  return {
    trustedPubkeys: uniqueTrimmed(settings?.trustedPubkeys || []),
    relayUrls: uniqueTrimmed(settings?.relayUrls || []),
  };
}

export function parseTaxonomySourceSettingsFromStorage(
  value: string | null
): TaxonomySourceSettings | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<TaxonomySourceSettings>;
    return normalizeTaxonomySourceSettings(parsed);
  } catch {
    return null;
  }
}

export function readLocalTaxonomySourceSettings(): TaxonomySourceSettings | null {
  if (typeof window === "undefined") return null;
  return parseTaxonomySourceSettingsFromStorage(
    window.localStorage.getItem(TAXONOMY_SOURCE_SETTINGS_STORAGE_KEY)
  );
}

export function writeLocalTaxonomySourceSettings(
  settings: TaxonomySourceSettings | null
): void {
  if (typeof window === "undefined") return;
  if (!settings) {
    window.localStorage.removeItem(TAXONOMY_SOURCE_SETTINGS_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(
    TAXONOMY_SOURCE_SETTINGS_STORAGE_KEY,
    JSON.stringify(normalizeTaxonomySourceSettings(settings))
  );
}

export function taxonomySourceQueryParams(
  settings: TaxonomySourceSettings | null | undefined
): URLSearchParams {
  const query = new URLSearchParams();
  if (!settings) return query;
  const normalized = normalizeTaxonomySourceSettings(settings);
  if (normalized.trustedPubkeys.length > 0)
    query.set("pubkeys", normalized.trustedPubkeys.join(","));
  if (normalized.relayUrls.length > 0)
    query.set("relays", normalized.relayUrls.join(","));
  return query;
}

export function taxonomyApiPath(
  path: string,
  settings: TaxonomySourceSettings | null | undefined,
  extra: Record<string, string | undefined> = {}
): string {
  const query = taxonomySourceQueryParams(settings);
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined) query.set(key, value);
  }
  const queryString = query.toString();
  return queryString ? `${path}?${queryString}` : path;
}
