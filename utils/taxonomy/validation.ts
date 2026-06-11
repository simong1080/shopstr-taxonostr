import { buildActiveListingState } from "@/utils/taxonomy/listing-state";
import {
  buildResolvedTaxonomyState,
  thingPath,
} from "@/utils/taxonomy/client-state";
import {
  isContextRef,
  isSegmentContextRef,
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
  TaxonomyState,
} from "@/utils/taxonomy/types";

export type ProductTaxonomyValidationMode = "publish" | "ingest";

export type ProductTaxonomyValidationResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  normalized?: ProductTaxonomy;
};

export type ProductTaxonomyValidationOptions = {
  mode?: ProductTaxonomyValidationMode;
  content?: string;
  implicitBusinessFunctionRef?: string;
};

function normalizeAssertions(
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

function normalizeLiteralAssertions(
  assertions: ProductTaxonomyLiteralAssertion[]
): ProductTaxonomyLiteralAssertion[] {
  const seen = new Set<string>();
  const normalized: ProductTaxonomyLiteralAssertion[] = [];
  for (const assertion of assertions || []) {
    const propRef = normalizeTaxonomyRef(assertion.propRef || "");
    if (!propRef) continue;
    const valueTypeRef = assertion.valueTypeRef
      ? normalizeTaxonomyRef(assertion.valueTypeRef)
      : undefined;
    const key = `${propRef}\u0000${valueTypeRef || ""}\u0000${JSON.stringify(assertion.value)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ propRef, valueTypeRef, value: assertion.value });
  }
  return normalized;
}

function normalizeProductTaxonomy(taxonomy: ProductTaxonomy): ProductTaxonomy {
  return {
    primaryThingRef: taxonomy.primaryThingRef
      ? normalizeTaxonomyRef(taxonomy.primaryThingRef)
      : undefined,
    overlayValRefs: uniqueRefs(taxonomy.overlayValRefs || []).map(
      normalizeTaxonomyRef
    ),
    requiredRefs: uniqueRefs(taxonomy.requiredRefs || []).map(
      normalizeTaxonomyRef
    ),
    refAssertions: normalizeAssertions(taxonomy.refAssertions || []),
    literalAssertions: normalizeLiteralAssertions(
      taxonomy.literalAssertions || []
    ),
  };
}

function taxonomyStateFromProductTaxonomy(
  taxonomy: ProductTaxonomy,
  registry: TaxonomyRegistry
): TaxonomyState {
  const segmentRefs = (taxonomy.overlayValRefs || []).filter(
    isSegmentContextRef
  );
  const selectedValuesByProp = taxonomy.refAssertions.reduce<
    Record<string, string[]>
  >((acc, assertion) => {
    const propRef = normalizeTaxonomyRef(assertion.propRef);
    const valueRef = normalizeTaxonomyRef(assertion.valueRef);
    if (!propRef || !valueRef) return acc;
    acc[propRef] = uniqueRefs([...(acc[propRef] || []), valueRef]);
    return acc;
  }, {});

  return {
    segmentRef: segmentRefs[0] || null,
    thingRef: taxonomy.primaryThingRef || null,
    thingPath: taxonomy.primaryThingRef
      ? thingPath(taxonomy.primaryThingRef, registry)
      : [],
    semanticContextRefs: uniqueRefs(taxonomy.overlayValRefs || []).filter(
      (ref) => isContextRef(ref) && !isSegmentContextRef(ref)
    ),
    selectedValuesByProp,
    selectedLiteralsByProp: Object.fromEntries(
      (taxonomy.literalAssertions || []).map((assertion) => [
        normalizeTaxonomyRef(assertion.propRef),
        assertion.value,
      ])
    ),
    quarantinedLegacyRefs: [],
  };
}

function valueAllowedForProp(
  registry: TaxonomyRegistry,
  options: string[],
  valueRef: string
): boolean {
  const normalizedValueRef = normalizeTaxonomyRef(valueRef);
  return options.some((optionRef) => {
    const normalizedOptionRef = normalizeTaxonomyRef(optionRef);
    return (
      normalizedValueRef === normalizedOptionRef ||
      isSameOrDescendant(registry, normalizedValueRef, normalizedOptionRef)
    );
  });
}

export function validateProductTaxonomy(
  taxonomy: ProductTaxonomy | undefined,
  registry: TaxonomyRegistry,
  options: ProductTaxonomyValidationOptions = {}
): ProductTaxonomyValidationResult {
  const mode = options.mode || "publish";
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!taxonomy) {
    return { ok: true, errors, warnings };
  }

  const normalized = normalizeProductTaxonomy(taxonomy);
  const content = options.content || "";
  if (content.trim().startsWith("{") || content.includes('"taxonomy"')) {
    errors.push(
      "Listing content must be Markdown description text, not structured taxonomy JSON."
    );
  }

  if (!normalized.primaryThingRef) {
    errors.push("Taxonomy listing is missing a primary thing ref.");
  } else if (
    !registry.nodeByRef[normalized.primaryThingRef] ||
    !normalized.primaryThingRef.startsWith("thing:")
  ) {
    errors.push(
      `Primary thing ref is not a known thing node: ${normalized.primaryThingRef}`
    );
  }

  const segmentRefs = normalized.overlayValRefs.filter(isSegmentContextRef);
  if (segmentRefs.length !== 1) {
    errors.push(
      `Taxonostr listing taxonomy must include exactly one primary segment overlay; got ${segmentRefs.length}.`
    );
  }

  for (const ref of normalized.overlayValRefs) {
    const node = registry.nodeByRef[ref];
    if (!node) {
      errors.push(`Overlay ref is not in registry: ${ref}`);
      continue;
    }
    if (!isContextRef(ref) && !ref.startsWith("val:business_function:")) {
      errors.push(
        `Overlay ref must be a context or business function value: ${ref}`
      );
    }
  }

  for (const ref of normalized.requiredRefs || []) {
    if (!registry.nodeByRef[ref])
      errors.push(`Required ref is not in registry: ${ref}`);
  }

  for (const assertion of normalized.refAssertions) {
    const propNode = registry.nodeByRef[assertion.propRef];
    if (!propNode || propNode.family !== "prop") {
      errors.push(
        `Taxonomy ref assertion uses an unknown prop ref: ${assertion.propRef}`
      );
    }
    const valueNode = registry.nodeByRef[assertion.valueRef];
    if (
      !valueNode ||
      (valueNode.family !== "val" && valueNode.family !== "thing")
    ) {
      errors.push(
        `Taxonomy ref assertion uses an unknown/invalid value ref: ${assertion.valueRef}`
      );
    }
  }

  for (const assertion of normalized.literalAssertions) {
    const propNode = registry.nodeByRef[assertion.propRef];
    if (!propNode || propNode.family !== "prop") {
      errors.push(
        `Taxonomy literal assertion uses an unknown prop ref: ${assertion.propRef}`
      );
    }
    if (assertion.valueTypeRef && !registry.nodeByRef[assertion.valueTypeRef]) {
      errors.push(
        `Taxonomy literal assertion uses an unknown value type ref: ${assertion.valueTypeRef}`
      );
    }
  }

  if (errors.length === 0) {
    const state = taxonomyStateFromProductTaxonomy(normalized, registry);
    const resolvedState = buildResolvedTaxonomyState(state, registry);
    const listingState = buildActiveListingState(state, registry, {
      implicitBusinessFunctionRef: options.implicitBusinessFunctionRef,
    });

    for (const assertion of normalized.refAssertions) {
      const optionsForProp =
        resolvedState.availableValues[assertion.propRef] || [];
      if (optionsForProp.length === 0) {
        errors.push(
          `Taxonomy ref assertion has no resolver-valid options for prop: ${assertion.propRef}`
        );
        continue;
      }
      if (!valueAllowedForProp(registry, optionsForProp, assertion.valueRef)) {
        errors.push(
          `Taxonomy ref assertion value is not valid for ${assertion.propRef}: ${assertion.valueRef}`
        );
      }
    }

    if (listingState.missingRequiredContextRefs.length > 0) {
      errors.push(
        `Missing required context refs: ${listingState.missingRequiredContextRefs.join(", ")}`
      );
    }
    if (listingState.missingRequiredPropRefs.length > 0) {
      errors.push(
        `Missing required prop refs: ${listingState.missingRequiredPropRefs.join(", ")}`
      );
    }

    const assertedValueRefs = new Set(
      normalized.refAssertions.map((assertion) => assertion.valueRef)
    );
    for (const ref of normalized.requiredRefs || []) {
      if (
        !ref.startsWith("val:") ||
        isContextRef(ref) ||
        ref.startsWith("val:business_function:")
      )
        continue;
      if (!assertedValueRefs.has(ref)) {
        const message = `Required concrete value is not attached to a prop assertion and will not be filterable: ${ref}`;
        if (mode === "publish") warnings.push(message);
        else warnings.push(message);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    normalized,
  };
}
