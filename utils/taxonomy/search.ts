import { getTaxonomyNodeLabel, normalizeRef } from "@/utils/taxonomy/registry";
import {
  getDirectThingChildren,
  isContextRef,
  isThingRef,
  uniqueRefs,
} from "@/utils/taxonomy/graph";
import { TaxonomyRegistry } from "@/utils/taxonomy/types";
import { getTaxonomyDisplayLabel } from "@/utils/taxonomy/display";

export type TaxonomySearchSuggestion = {
  ref: string;
  label: string;
  parentLabel: string;
  image: string;
};

export function sortByTaxonomyLabel(
  registry: TaxonomyRegistry,
  refs: string[],
  locale: string
): string[] {
  return refs
    .slice()
    .sort((a, b) =>
      getTaxonomyNodeLabel(registry, a, locale).localeCompare(
        getTaxonomyNodeLabel(registry, b, locale),
        locale
      )
    );
}

export function getImmediateParentLabel(
  registry: TaxonomyRegistry,
  ref: string,
  locale: string = "en"
): string {
  const normalizedRef = normalizeRef(ref);
  const parentRef = (registry.nodeByRef[normalizedRef]?.content.parents || [])
    .map(normalizeRef)
    .find((candidateRef) => Boolean(registry.nodeByRef[candidateRef]));
  return parentRef ? getTaxonomyNodeLabel(registry, parentRef, locale) : "";
}

export function getNodeImage(registry: TaxonomyRegistry, ref: string): string {
  return registry.imageByRef[normalizeRef(ref)] || "";
}

function buildSearchSuggestion(
  registry: TaxonomyRegistry,
  ref: string,
  locale: string
): TaxonomySearchSuggestion {
  const normalizedRef = normalizeRef(ref);
  return {
    ref: normalizedRef,
    label: getTaxonomyDisplayLabel(registry, normalizedRef, locale, "category"),
    parentLabel: getImmediateParentLabel(registry, normalizedRef, locale),
    image: getNodeImage(registry, normalizedRef),
  };
}

export function getTaxonomySearchSuggestions(
  registry: TaxonomyRegistry,
  query: string,
  locale: string = "en",
  limit: number = 40
): TaxonomySearchSuggestion[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length < 2) return [];

  const refs = Object.keys(registry.nodeByRef)
    .filter((ref) => isContextRef(ref) || isThingRef(ref))
    .filter((ref) => {
      const label = getTaxonomyNodeLabel(registry, ref, locale).toLowerCase();
      const terminalLabel = getTaxonomyNodeLabel(
        registry,
        ref,
        "en"
      ).toLowerCase();
      return (
        label.includes(normalizedQuery) ||
        terminalLabel.includes(normalizedQuery)
      );
    });

  return sortByTaxonomyLabel(registry, refs, locale)
    .slice(0, limit)
    .map((ref) => buildSearchSuggestion(registry, ref, locale));
}

export function getThingSearchSuggestions(
  registry: TaxonomyRegistry,
  query: string,
  locale: string = "en",
  limit: number = 40,
  terminalArtifactOnly: boolean = false
): TaxonomySearchSuggestion[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length < 2) return [];

  const refs = Object.keys(registry.nodeByRef)
    .filter(isThingRef)
    .filter((ref) => {
      if (!terminalArtifactOnly) return true;
      const normalizedRef = normalizeRef(ref);
      return (
        normalizedRef.startsWith("thing:artifact:") &&
        getDirectThingChildren(registry, normalizedRef).length === 0
      );
    })
    .filter((ref) =>
      getTaxonomyNodeLabel(registry, ref, locale)
        .toLowerCase()
        .includes(normalizedQuery)
    );

  return sortByTaxonomyLabel(registry, refs, locale)
    .slice(0, limit)
    .map((ref) => buildSearchSuggestion(registry, ref, locale));
}

export function getBrowseTileItems(
  registry: TaxonomyRegistry,
  refs: string[],
  locale: string = "en",
  limit: number = 12
): TaxonomySearchSuggestion[] {
  return sortByTaxonomyLabel(registry, uniqueRefs(refs), locale)
    .slice(0, limit)
    .map((ref) => buildSearchSuggestion(registry, ref, locale));
}
