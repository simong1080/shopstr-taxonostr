import { TaxonomyRegistry } from "@/utils/taxonomy/types";
import { getInheritedValRefs, normalizeRef } from "@/utils/taxonomy/registry";
import { contextChangesResolvedTaxonomyState } from "@/utils/taxonomy/client-state";
import {
  isContextRef,
  isSegmentContextRef,
  uniqueRefs,
} from "@/utils/taxonomy/graph";

export function getDerivedHelperContextRefs(
  registry: TaxonomyRegistry | null | undefined,
  selectedThingRef: string | undefined,
  selectedContextRefs: string[]
): string[] {
  if (!registry || !selectedThingRef) return [];
  const normalizedSelectedContextRefs = uniqueRefs(selectedContextRefs);
  return uniqueRefs(
    getInheritedValRefs(registry, selectedThingRef).filter((relatedRef) => {
      const normalizedRelatedRef = normalizeRef(relatedRef);
      return (
        normalizedRelatedRef.startsWith("val:context:") &&
        !normalizedSelectedContextRefs.includes(normalizedRelatedRef)
      );
    })
  );
}

export function partitionPersistedOverlayRefs(params: {
  registry?: TaxonomyRegistry | null;
  selectedThingRef?: string;
  persistedOverlayRefs?: string[];
  helperContextOverlayRefs?: string[];
  implicitBusinessFunctionRef?: string;
}) {
  const persistedOverlayRefs = uniqueRefs(params.persistedOverlayRefs || []);
  const helperContextOverlayRefs = new Set(
    uniqueRefs(params.helperContextOverlayRefs || [])
  );
  const implicitBusinessFunctionRef = normalizeRef(
    params.implicitBusinessFunctionRef || ""
  );

  const segmentRefs = persistedOverlayRefs
    .filter(isSegmentContextRef)
    .slice(0, 1);
  const activeSemanticOverlayRefs: string[] = [];
  const quarantinedLegacyOverlayRefs: string[] = [];

  for (const ref of persistedOverlayRefs) {
    if (segmentRefs.includes(ref)) continue;
    if (ref === implicitBusinessFunctionRef) continue;
    if (isSegmentContextRef(ref)) {
      quarantinedLegacyOverlayRefs.push(ref);
      continue;
    }

    if (helperContextOverlayRefs.has(ref)) {
      continue;
    }

    if (
      params.registry &&
      params.selectedThingRef &&
      isContextRef(ref) &&
      params.registry.nodeByRef[ref] &&
      contextChangesResolvedTaxonomyState(
        params.registry,
        {
          segmentRef: null,
          thingRef: normalizeRef(params.selectedThingRef),
          thingPath: [],
          semanticContextRefs: [],
          selectedValuesByProp: {},
          selectedLiteralsByProp: {},
          quarantinedLegacyRefs: [],
        },
        ref
      )
    ) {
      activeSemanticOverlayRefs.push(ref);
      continue;
    }

    quarantinedLegacyOverlayRefs.push(ref);
  }

  return {
    segmentRefs,
    activeSemanticOverlayRefs,
    quarantinedLegacyOverlayRefs,
  };
}

export function getValidLegacyOverlayRefs(
  registry: TaxonomyRegistry | null | undefined,
  legacyOverlayRefs: string[]
): string[] {
  const normalizedLegacyOverlayRefs = uniqueRefs(legacyOverlayRefs);
  if (!registry) return normalizedLegacyOverlayRefs;
  return normalizedLegacyOverlayRefs.filter((ref) =>
    Boolean(registry.nodeByRef[ref])
  );
}

export function buildSerializedOverlayRefs(params: {
  implicitBusinessFunctionRef?: string;
  primarySegmentRef?: string;
  activeSemanticOverlayRefs?: string[];
  listingLabelOverlayRefs?: string[];
  legacyOverlayRefs?: string[];
}): string[] {
  return uniqueRefs([
    ...(params.implicitBusinessFunctionRef
      ? [params.implicitBusinessFunctionRef]
      : []),
    ...(params.primarySegmentRef ? [params.primarySegmentRef] : []),
    ...(params.activeSemanticOverlayRefs || []),
    ...(params.listingLabelOverlayRefs || []),
    ...(params.legacyOverlayRefs || []),
  ]);
}

export function resetTaxonomyFormStateForCategoryChange() {
  return {
    activeSemanticOverlayRefs: [] as string[],
    quarantinedLegacyOverlayRefs: [] as string[],
    taxonomyRefAssertions: {} as Record<string, string>,
    taxonomyLiteralAssertions: {} as Record<string, string>,
    taxonomyError: null as string | null,
  };
}
