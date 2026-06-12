import {
  getInheritedRequiredRelations,
  isContextRef,
  uniqueRefs,
} from "@/utils/taxonomy/graph";
import {
  isSameOrDescendant,
  normalizeTaxonomyRef,
} from "@/utils/taxonomy/registry";
import {
  ProductTaxonomy,
  ProductTaxonomyLiteralAssertion,
  ProductTaxonomyRefAssertion,
  TaxonomyRegistry,
} from "@/utils/taxonomy/types";

export type EffectiveListingTaxonomyFacts = {
  refAssertions: ProductTaxonomyRefAssertion[];
  literalAssertions: ProductTaxonomyLiteralAssertion[];
  diagnostics: string[];
};

function inferredPropRefsForValue(
  registry: TaxonomyRegistry,
  valueRef: string
): string[] {
  const normalizedValueRef = normalizeTaxonomyRef(valueRef);
  return Object.keys(registry.nodeByRef)
    .filter((ref) => registry.nodeByRef[ref]?.family === "prop")
    .filter((propRef) =>
      (registry.propRootsByRef[propRef] || []).some(
        (rootRef) =>
          normalizeTaxonomyRef(rootRef) === normalizedValueRef ||
          isSameOrDescendant(registry, normalizedValueRef, rootRef)
      )
    )
    .sort();
}

function normalizeRefAssertions(
  assertions: ProductTaxonomyRefAssertion[]
): ProductTaxonomyRefAssertion[] {
  const seen = new Set<string>();
  const normalized: ProductTaxonomyRefAssertion[] = [];
  for (const assertion of assertions || []) {
    const propRef = normalizeTaxonomyRef(assertion.propRef || "");
    const valueRef = normalizeTaxonomyRef(assertion.valueRef || "");
    if (!propRef || !valueRef) continue;
    const key = `${propRef}\u0000${valueRef}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ propRef, valueRef });
  }
  return normalized;
}

function trustedRequiredValueRefs(
  taxonomy: ProductTaxonomy,
  registry: TaxonomyRegistry
): string[] {
  const structuralRefs = uniqueRefs([
    taxonomy.primaryThingRef || "",
    ...(taxonomy.overlayValRefs || []).filter((ref) => isContextRef(ref)),
  ]);
  const trustedRequiredRefs = uniqueRefs(
    structuralRefs.flatMap((ref) =>
      getInheritedRequiredRelations(registry, ref)
    )
  );
  const listingRequiredRefSet = new Set(
    (taxonomy.requiredRefs || []).map(normalizeTaxonomyRef)
  );
  return trustedRequiredRefs
    .map(normalizeTaxonomyRef)
    .filter((ref) => ref.startsWith("val:"))
    .filter((ref) => !isContextRef(ref))
    .filter(
      (ref) =>
        listingRequiredRefSet.size === 0 || listingRequiredRefSet.has(ref)
    );
}

export function buildEffectiveListingTaxonomyFacts(
  taxonomy: ProductTaxonomy | undefined,
  registry: TaxonomyRegistry | null | undefined
): EffectiveListingTaxonomyFacts {
  if (!taxonomy || !registry) {
    return { refAssertions: [], literalAssertions: [], diagnostics: [] };
  }

  const diagnostics: string[] = [];
  const explicitRefAssertions = normalizeRefAssertions(
    taxonomy.refAssertions || []
  ).filter((assertion) => {
    const propNode = registry.nodeByRef[assertion.propRef];
    const valueNode = registry.nodeByRef[assertion.valueRef];
    return (
      propNode?.family === "prop" &&
      (valueNode?.family === "val" || valueNode?.family === "thing")
    );
  });
  const assertionMap = new Map<string, Set<string>>();
  for (const assertion of explicitRefAssertions) {
    if (!assertionMap.has(assertion.propRef))
      assertionMap.set(assertion.propRef, new Set<string>());
    assertionMap.get(assertion.propRef)?.add(assertion.valueRef);
  }

  for (const valueRef of trustedRequiredValueRefs(taxonomy, registry)) {
    const propRefs = inferredPropRefsForValue(registry, valueRef);
    if (propRefs.length === 0) {
      diagnostics.push(`unresolved_required_value:${valueRef}`);
      continue;
    }
    if (propRefs.length > 1) {
      diagnostics.push(`ambiguous_required_value:${valueRef}`);
      continue;
    }

    const propRef = propRefs[0] || "";
    const existingValues = assertionMap.get(propRef);
    if (
      existingValues &&
      existingValues.size > 0 &&
      !existingValues.has(valueRef)
    ) {
      diagnostics.push(`conflicting_required_value:${propRef}:${valueRef}`);
      continue;
    }
    if (!assertionMap.has(propRef))
      assertionMap.set(propRef, new Set<string>());
    assertionMap.get(propRef)?.add(valueRef);
  }

  const refAssertions = Array.from(assertionMap.entries()).flatMap(
    ([propRef, valueRefs]) =>
      Array.from(valueRefs)
        .sort()
        .map((valueRef) => ({ propRef, valueRef }))
  );

  return {
    refAssertions,
    literalAssertions: taxonomy.literalAssertions || [],
    diagnostics,
  };
}
