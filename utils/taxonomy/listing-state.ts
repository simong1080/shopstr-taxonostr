import {
  getInheritedValRefs,
  getTaxonomyNodeLabel,
  isSameOrDescendant,
  normalizeRef,
} from "@/utils/taxonomy/registry";
import {
  buildResolvedTaxonomyState,
  buildPropRenderTree,
  decodeListingRefs,
  PropRenderNode,
  PropResolution,
  propOrder,
  propRoots,
  propValueType,
  segmentPath,
  thingPath,
} from "@/utils/taxonomy/client-state";
import {
  getAutoActiveRequiredRefs,
  isContextRef,
  isSegmentContextRef,
  uniqueRefs,
} from "@/utils/taxonomy/graph";
import {
  ProductTaxonomyRefAssertion,
  TaxonomyRegistry,
  TaxonomyState,
} from "@/utils/taxonomy/types";

export type { PropRenderNode };

// Listing-specific view model. Core resolver facts come from
// buildResolvedTaxonomyState; submit blocking, warnings, images, and chips are
// intentionally kept in this adapter layer.
export type ActiveListingState = {
  selectedThingRef: string;
  selectedThingExists: boolean;
  selectedThingPath: string[];
  selectedSegmentPath: string[];
  selectedSegmentRefs: string[];
  primarySegmentRef: string;
  selectedSemanticContextRefs: string[];
  selectedChipRefs: string[];
  requiredSegmentRefs: string[];
  hasRequiredSegment: boolean;
  hasExactlyOneSegment: boolean;
  fixedSegmentRef: string;
  compatibleSegmentRefs: string[];
  availableSegmentRefs: string[];
  activeSelectedSegmentRefs: string[];
  serializedRequiredRefs: string[];
  requiredContextRefs: string[];
  automaticRequiredContextRefs: Set<string>;
  semanticOverlayOptions: string[];
  availableContextRefs: string[];
  overlayGroups: Record<string, string[]>;
  validLegacyOverlayRefs: string[];
  serializedOverlayValRefs: string[];
  selectedTaxonomyImageRefs: string[];
  applicablePropRefs: string[];
  requiredPropRefs: string[];
  orderedApplicablePropRefs: string[];
  propFieldTree: PropRenderNode[];
  availableValuesByProp: Record<string, string[]>;
  propResolutionsByProp: Record<string, PropResolution>;
  propValueTypeByProp: Record<string, string>;
  propTargetRefsByProp: Record<string, string[]>;
  selectedValueRefsByProp: Record<string, string[]>;
  selectedLiteralByProp: Record<string, unknown>;
  fieldLabelsByProp: Record<string, string>;
  literalPlaceholderByProp: Record<string, string>;
  autoProductName: string;
  missingRequiredContextRefs: string[];
  missingRequiredPropRefs: string[];
  hasAnyAttribute: boolean;
  canSubmit: boolean;
  submitBlockReason: string | null;
  warnings: string[];
};

function overlayGroupLabel(ref: string): string {
  const normalized = normalizeRef(ref);
  if (normalized.startsWith("val:context:segment:")) return "Segments";
  if (normalized.startsWith("val:business_function:"))
    return "Business Functions";
  if (normalized.startsWith("val:context:usecase:")) return "Use Cases";
  if (normalized.startsWith("val:context:")) return "Context";
  if (normalized.startsWith("val:status:")) return "Status";
  if (normalized.startsWith("val:condition:")) return "Condition";
  return "Other Overlays";
}

const AUTO_NAME_PROP_PRIORITIES = [
  "prop:manufacturer",
  "prop:brand",
  "prop:player",
  "prop:person",
  "prop:subject_name",
  "prop:team",
  "prop:sport",
  "prop:league",
  "prop:card_set",
  "prop:series",
  "prop:franchise",
  "prop:condition",
];

function autoNamePropPriority(propRef: string): number {
  const normalizedPropRef = normalizeRef(propRef);
  const exactIndex = AUTO_NAME_PROP_PRIORITIES.indexOf(normalizedPropRef);
  if (exactIndex >= 0) return exactIndex;
  const terminal = normalizedPropRef.split(":").pop() || "";
  const fuzzyIndex = AUTO_NAME_PROP_PRIORITIES.findIndex((candidateRef) =>
    candidateRef.endsWith(`:${terminal}`)
  );
  return fuzzyIndex >= 0 ? fuzzyIndex : Number.POSITIVE_INFINITY;
}

function formatAutoProductNameLiteral(
  value: string,
  valueTypeRef: string | undefined,
  propLabel: string
): string | null {
  if (!value || !value.trim()) return null;
  const normalizedValueTypeRef = normalizeRef(valueTypeRef || "");
  if (normalizedValueTypeRef === "valtype:boolean") {
    return value === "true" ? propLabel : null;
  }
  if (normalizedValueTypeRef === "valtype:quantitative") {
    try {
      const parsed = JSON.parse(value) as { value?: unknown; unit?: unknown };
      if (parsed && typeof parsed === "object") {
        const quantity = parsed.value === undefined ? "" : String(parsed.value);
        const unit = parsed.unit === undefined ? "" : String(parsed.unit);
        return [quantity, unit].filter(Boolean).join(" ").trim() || value;
      }
    } catch {
      return value;
    }
  }
  return value;
}

function literalPlaceholder(
  registry: TaxonomyRegistry,
  valueTypeRef: string,
  locale: string
): string {
  const normalized = normalizeRef(valueTypeRef);
  if (registry.nodeByRef[normalized]?.content?.labels) {
    return getTaxonomyNodeLabel(registry, normalized, locale).toLowerCase();
  }
  const placeholders: Record<string, string> = {
    "valtype:text": "text",
    "valtype:integer": "whole number",
    "valtype:decimal": "number",
    "valtype:boolean": "yes/no",
    "valtype:date": "date",
    "valtype:year": "year",
    "valtype:quantitative": "quantity",
  };
  return (
    placeholders[normalized] ||
    getTaxonomyNodeLabel(registry, normalized, locale).toLowerCase()
  );
}

function hasAnsweredLiteralValue(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return value === true;
  return value !== null && value !== undefined;
}

function uniquePropForConcreteValue(
  registry: TaxonomyRegistry,
  valueRef: string
): string {
  const normalizedValueRef = normalizeRef(valueRef);
  if (!normalizedValueRef || !registry.nodeByRef[normalizedValueRef]) return "";
  const propRefs = Object.keys(registry.nodeByRef)
    .filter((ref) => registry.nodeByRef[ref]?.family === "prop")
    .filter((propRef) =>
      propRoots(propRef, registry).some(
        (rootRef) =>
          normalizeRef(rootRef) === normalizedValueRef ||
          isSameOrDescendant(registry, normalizedValueRef, rootRef)
      )
    )
    .sort();
  return propRefs.length === 1 ? propRefs[0] || "" : "";
}

function propDisplayLabel(
  registry: TaxonomyRegistry,
  propRef: string,
  locale: string
): string {
  const normalizedPropRef = normalizeRef(propRef);
  const parentPropRef = (
    registry.nodeByRef[normalizedPropRef]?.content.parents || []
  )
    .map(normalizeRef)
    .find((ref: string) => ref.startsWith("prop:"));
  return getTaxonomyNodeLabel(
    registry,
    parentPropRef || normalizedPropRef,
    locale
  );
}

function buildAutoProductName(params: {
  registry: TaxonomyRegistry;
  selectedThingRef: string;
  orderedApplicablePropRefs: string[];
  propValueTypeByProp: Record<string, string>;
  fieldLabelsByProp: Record<string, string>;
  selectedValueRefsByProp: Record<string, string[]>;
  selectedLiteralByProp: Record<string, unknown>;
  locale: string;
}): string {
  if (!params.selectedThingRef) return "";

  const parts: string[] = [
    getTaxonomyNodeLabel(
      params.registry,
      params.selectedThingRef,
      params.locale
    ),
  ];
  for (const propRef of params.orderedApplicablePropRefs
    .slice()
    .sort((a, b) => autoNamePropPriority(a) - autoNamePropPriority(b))
    .filter((propRef) => Number.isFinite(autoNamePropPriority(propRef)))) {
    const selectedRef = params.selectedValueRefsByProp[propRef]?.[0];
    if (selectedRef) {
      parts.push(
        getTaxonomyNodeLabel(params.registry, selectedRef, params.locale)
      );
      if (parts.length >= 7) break;
      continue;
    }

    const literalValue = String(params.selectedLiteralByProp[propRef] || "");
    if (!literalValue || !literalValue.trim()) continue;
    const literalLabel = formatAutoProductNameLiteral(
      literalValue,
      params.propValueTypeByProp[propRef],
      params.fieldLabelsByProp[propRef] ||
        getTaxonomyNodeLabel(params.registry, propRef, params.locale)
    );
    if (literalLabel) parts.push(literalLabel);
    if (parts.length >= 7) break;
  }

  return [...new Set(parts.filter(Boolean))].join(" - ");
}

export function createEmptyListingTaxonomyState(): TaxonomyState {
  return {
    segmentRef: null,
    thingRef: null,
    thingPath: [],
    semanticContextRefs: [],
    selectedValuesByProp: {},
    selectedLiteralsByProp: {},
    quarantinedLegacyRefs: [],
  };
}

export function buildListingTaxonomyRefAssertions(
  listingState: Pick<
    ActiveListingState,
    "selectedValueRefsByProp" | "propResolutionsByProp"
  >
): ProductTaxonomyRefAssertion[] {
  const assertionsByProp = new Map<string, Set<string>>();

  const addAssertion = (propRef: string, valueRef: string) => {
    const normalizedPropRef = normalizeRef(propRef);
    const normalizedValueRef = normalizeRef(valueRef);
    if (!normalizedPropRef || !normalizedValueRef) return;
    if (!assertionsByProp.has(normalizedPropRef))
      assertionsByProp.set(normalizedPropRef, new Set<string>());
    assertionsByProp.get(normalizedPropRef)?.add(normalizedValueRef);
  };

  for (const [propRef, valueRefs] of Object.entries(
    listingState.selectedValueRefsByProp
  )) {
    for (const valueRef of valueRefs || []) addAssertion(propRef, valueRef);
  }

  for (const resolution of Object.values(listingState.propResolutionsByProp)) {
    if (!resolution.resolved || resolution.ambiguous) continue;
    if (resolution.source !== "scope" && resolution.source !== "user") continue;
    for (const valueRef of resolution.valueRefs || [])
      addAssertion(resolution.propRef, valueRef);
  }

  return Array.from(assertionsByProp.entries()).flatMap(
    ([propRef, valueRefs]) =>
      Array.from(valueRefs).map((valueRef) => ({ propRef, valueRef }))
  );
}

export function decodeListingTaxonomyState(
  overlayRefs: string[],
  registry: TaxonomyRegistry
): TaxonomyState {
  return decodeListingRefs(overlayRefs, registry);
}

export function buildListingThingPath(
  registry: TaxonomyRegistry,
  thingRef: string | null | undefined
): string[] {
  return thingPath(thingRef || null, registry);
}

export function buildInitialListingStateForThing(
  registry: TaxonomyRegistry,
  thingRef: string
): TaxonomyState {
  // Listing adapter helper: ProductForm calls this instead of re-deriving
  // required concrete values or applicable prop options in the component.
  const nextThingRef = normalizeRef(thingRef);
  const nextThingPath = buildListingThingPath(registry, nextThingRef);
  const autoRequiredRefs = getAutoActiveRequiredRefs(registry, nextThingRef);
  const requiredSegmentRefs = autoRequiredRefs.filter(isSegmentContextRef);
  const nextSegmentRef =
    requiredSegmentRefs.length === 1 ? requiredSegmentRefs[0] || null : null;
  const requiredContextRefs = autoRequiredRefs
    .filter(isContextRef)
    .filter((ref) => !isSegmentContextRef(ref));
  const requiredValueRefs = autoRequiredRefs.filter(
    (ref) => !isContextRef(ref)
  );
  const seedState: TaxonomyState = {
    ...createEmptyListingTaxonomyState(),
    segmentRef: nextSegmentRef,
    thingRef: nextThingRef,
    thingPath: nextThingPath,
    semanticContextRefs: requiredContextRefs,
  };
  const resolvedSeedState = buildResolvedTaxonomyState(seedState, registry);
  const selectedValuesByProp = Object.fromEntries(
    resolvedSeedState.availableProps.flatMap((propRef) => {
      const optionSet = new Set(
        (resolvedSeedState.availableValues[propRef] || []).map(normalizeRef)
      );
      const selectedRefs = requiredValueRefs.filter((valueRef) =>
        optionSet.has(normalizeRef(valueRef))
      );
      return selectedRefs.length > 0 ? [[propRef, selectedRefs]] : [];
    })
  );

  return {
    ...seedState,
    selectedValuesByProp,
  };
}

export function deriveLegacyCategoryTags(
  registry: TaxonomyRegistry,
  primaryThingRef: string,
  overlayValRefs: string[],
  locale: string
): string[] {
  if (!primaryThingRef) return [];
  const path = thingPath(primaryThingRef, registry);
  const genericRoots = new Set([
    "thing:good",
    "thing:organization",
    "thing:game",
  ]);
  const thingLabels = path
    .filter((ref) => !genericRoots.has(normalizeRef(ref)))
    .map((ref) => getTaxonomyNodeLabel(registry, ref, locale));
  const overlayLabels = overlayValRefs
    .filter((ref) => normalizeRef(ref).startsWith("val:context:segment:"))
    .map((ref) => getTaxonomyNodeLabel(registry, ref, locale));
  return [...new Set([...thingLabels, ...overlayLabels].filter(Boolean))];
}

export function buildActiveListingState(
  formSelections: TaxonomyState,
  registry: TaxonomyRegistry,
  options: { implicitBusinessFunctionRef?: string; locale?: string } = {}
): ActiveListingState {
  const locale = options.locale || "en";
  const selectedThingRef = normalizeRef(formSelections.thingRef || "");
  const selectedThingExists = Boolean(
    selectedThingRef && registry.nodeByRef[selectedThingRef]
  );
  const selectedThingPath = formSelections.thingPath
    .map(normalizeRef)
    .filter(Boolean);
  const selectedSemanticContextRefs = uniqueRefs(
    formSelections.semanticContextRefs
  );
  const selectedSegmentPath = segmentPath(formSelections.segmentRef, registry);
  const selectedSegmentRefs = uniqueRefs([
    formSelections.segmentRef || "",
    ...formSelections.semanticContextRefs,
  ]).filter(
    (ref) => isSegmentContextRef(ref) && Boolean(registry.nodeByRef[ref])
  );
  const primarySegmentRef = isSegmentContextRef(formSelections.segmentRef || "")
    ? normalizeRef(formSelections.segmentRef || "")
    : "";
  const selectedChipRefs = uniqueRefs([
    primarySegmentRef,
    selectedThingRef,
    ...selectedSemanticContextRefs,
  ]);
  const hasRequiredSegment = selectedSegmentRefs.length > 0;
  const hasExactlyOneSegment = selectedSegmentRefs.length === 1;
  const inheritedValRefs = selectedThingRef
    ? getInheritedValRefs(registry, selectedThingRef).map(normalizeRef)
    : [];

  const compatibleSegmentRefs = selectedThingRef
    ? uniqueRefs(
        inheritedValRefs.filter(
          (ref) => isSegmentContextRef(ref) && ref !== "val:context:segment"
        )
      )
    : [];

  const activeSelectedSegmentRefs = uniqueRefs([...selectedSegmentPath]);

  const serializedRequiredRefs = selectedThingRef
    ? getAutoActiveRequiredRefs(registry, selectedThingRef).filter(
        (ref) => !normalizeRef(ref).startsWith("prop:")
      )
    : [];
  const requiredSegmentRefs = serializedRequiredRefs
    .map(normalizeRef)
    .filter(isSegmentContextRef);
  const fixedSegmentRef =
    requiredSegmentRefs.length === 1 ? requiredSegmentRefs[0] || "" : "";
  const requiredContextRefs = serializedRequiredRefs
    .map(normalizeRef)
    .filter((ref) => isContextRef(ref) && !isSegmentContextRef(ref));
  const automaticRequiredContextRefs = new Set(requiredContextRefs);

  const excludedContextRefs = new Set(
    [
      ...activeSelectedSegmentRefs,
      ...formSelections.semanticContextRefs,
      ...serializedRequiredRefs,
      options.implicitBusinessFunctionRef || "",
    ]
      .map((ref) => normalizeRef(ref || ""))
      .filter(Boolean)
  );

  const semanticOverlayOptions = selectedThingRef
    ? uniqueRefs(
        inheritedValRefs
          .filter(isContextRef)
          .filter((ref) => !isSegmentContextRef(ref))
          .filter(
            (ref) => ref !== "val:context" && !excludedContextRefs.has(ref)
          )
      )
    : [];

  const overlayGroups = semanticOverlayOptions.reduce<Record<string, string[]>>(
    (groups, ref) => {
      const label = overlayGroupLabel(ref);
      groups[label] = [...(groups[label] || []), ref];
      return groups;
    },
    {}
  );

  const validLegacyOverlayRefs = formSelections.quarantinedLegacyRefs
    .map(normalizeRef)
    .filter(Boolean)
    .filter((ref) => Boolean(registry.nodeByRef[ref]));

  const serializedOverlayValRefs = uniqueRefs([
    options.implicitBusinessFunctionRef || "",
    primarySegmentRef,
    ...formSelections.semanticContextRefs.filter(
      (ref) => !isSegmentContextRef(ref)
    ),
    ...validLegacyOverlayRefs.filter((ref) => !isSegmentContextRef(ref)),
  ]);

  const selectedTaxonomyImageRefs = [
    selectedThingRef,
    formSelections.segmentRef,
    ...formSelections.semanticContextRefs,
    ...serializedRequiredRefs,
  ]
    .map((ref) => normalizeRef(ref || ""))
    .filter(Boolean)
    .filter((ref, index, refs) => refs.indexOf(ref) === index)
    .filter((ref) => Boolean(registry.imageByRef[ref]));

  const resolvedTaxonomyState = buildResolvedTaxonomyState(
    formSelections,
    registry
  );
  const propResolutionsByProp: Record<string, PropResolution> = {
    ...resolvedTaxonomyState.propResolutions,
  };
  for (const ref of serializedRequiredRefs.map(normalizeRef)) {
    if (!ref.startsWith("val:") || isContextRef(ref)) continue;
    const propRef = uniquePropForConcreteValue(registry, ref);
    if (!propRef || propResolutionsByProp[propRef]?.resolved) continue;
    propResolutionsByProp[propRef] = {
      propRef,
      valueRefs: [ref],
      source: "scope",
      resolved: true,
      explicit: false,
      ambiguous: false,
    };
  }
  const applicablePropRefs = resolvedTaxonomyState.availableProps.filter(
    (propRef) => propResolutionsByProp[propRef]?.source !== "scope"
  );
  const requiredPropRefs = resolvedTaxonomyState.requiredPropRefs;
  const orderedApplicablePropRefs = propOrder(
    applicablePropRefs,
    formSelections,
    registry
  );
  const propFieldTree = buildPropRenderTree(
    orderedApplicablePropRefs,
    registry,
    formSelections
  );
  const availableValuesByProp = Object.fromEntries(
    orderedApplicablePropRefs.map((propRef) => [
      propRef,
      resolvedTaxonomyState.availableValues[propRef] || [],
    ])
  ) as Record<string, string[]>;
  const propValueTypeByProp = Object.fromEntries(
    orderedApplicablePropRefs.map((propRef) => [
      propRef,
      propValueType(propRef, registry) || "",
    ])
  ) as Record<string, string>;
  const propTargetRefsByProp = Object.fromEntries(
    orderedApplicablePropRefs.map((propRef) => [
      propRef,
      propRoots(propRef, registry),
    ])
  ) as Record<string, string[]>;
  const selectedValueRefsByProp = Object.fromEntries(
    Object.entries(formSelections.selectedValuesByProp).map(
      ([propRef, valueRefs]) => [
        normalizeRef(propRef),
        uniqueRefs(valueRefs || []),
      ]
    )
  ) as Record<string, string[]>;
  const selectedLiteralByProp = Object.fromEntries(
    Object.entries(formSelections.selectedLiteralsByProp).map(
      ([propRef, value]) => [normalizeRef(propRef), value]
    )
  ) as Record<string, unknown>;
  const fieldLabelsByProp = Object.fromEntries(
    orderedApplicablePropRefs.map((propRef) => [
      propRef,
      propDisplayLabel(registry, propRef, locale),
    ])
  ) as Record<string, string>;
  const literalPlaceholderByProp = Object.fromEntries(
    orderedApplicablePropRefs.map((propRef) => [
      propRef,
      propValueTypeByProp[propRef]
        ? literalPlaceholder(
            registry,
            propValueTypeByProp[propRef] || "",
            locale
          )
        : "Enter value",
    ])
  ) as Record<string, string>;
  const autoProductName = buildAutoProductName({
    registry,
    selectedThingRef,
    orderedApplicablePropRefs,
    propValueTypeByProp,
    fieldLabelsByProp,
    selectedValueRefsByProp,
    selectedLiteralByProp,
    locale,
  });

  const selectedContextSet = new Set(
    formSelections.semanticContextRefs.map(normalizeRef)
  );
  const missingRequiredContextRefs = requiredContextRefs.filter(
    (ref) => !selectedContextSet.has(ref)
  );
  const missingRequiredPropRefs = requiredPropRefs.filter((propRef) => {
    const normalizedPropRef = normalizeRef(propRef);
    if (propResolutionsByProp[normalizedPropRef]?.resolved) return false;
    const hasRefAssertion = Boolean(
      formSelections.selectedValuesByProp[normalizedPropRef]?.length
    );
    const literalValue =
      formSelections.selectedLiteralsByProp[normalizedPropRef];
    const hasLiteralAssertion = hasAnsweredLiteralValue(literalValue);
    return !hasRefAssertion && !hasLiteralAssertion;
  });

  const hasAnyAttribute =
    Object.values(formSelections.selectedValuesByProp).some(
      (valueRefs) => valueRefs.length > 0
    ) ||
    Object.values(formSelections.selectedLiteralsByProp).some(
      hasAnsweredLiteralValue
    );

  const submitBlockReason = !selectedThingRef
    ? "missing_thing"
    : !selectedThingExists
      ? "invalid_thing"
      : !hasRequiredSegment
        ? "missing_segment"
        : !hasExactlyOneSegment
          ? "multiple_segments"
          : requiredSegmentRefs.length > 1
            ? "multiple_required_segments"
            : fixedSegmentRef && primarySegmentRef !== fixedSegmentRef
              ? "wrong_segment"
              : missingRequiredContextRefs.length > 0
                ? "missing_required_context"
                : missingRequiredPropRefs.length > 0
                  ? "missing_required_props"
                  : null;

  const warnings =
    orderedApplicablePropRefs.length > 0 && !hasAnyAttribute
      ? ["missing_optional_attributes"]
      : [];

  return {
    selectedThingRef,
    selectedThingExists,
    selectedThingPath,
    selectedSegmentPath,
    selectedSegmentRefs,
    primarySegmentRef,
    selectedSemanticContextRefs,
    selectedChipRefs,
    requiredSegmentRefs,
    hasRequiredSegment,
    hasExactlyOneSegment,
    fixedSegmentRef,
    compatibleSegmentRefs,
    availableSegmentRefs:
      primarySegmentRef || fixedSegmentRef ? [] : compatibleSegmentRefs,
    activeSelectedSegmentRefs,
    serializedRequiredRefs,
    requiredContextRefs,
    automaticRequiredContextRefs,
    semanticOverlayOptions,
    availableContextRefs: semanticOverlayOptions,
    overlayGroups,
    validLegacyOverlayRefs,
    serializedOverlayValRefs,
    selectedTaxonomyImageRefs,
    applicablePropRefs,
    requiredPropRefs,
    orderedApplicablePropRefs,
    propFieldTree,
    availableValuesByProp,
    propResolutionsByProp,
    propValueTypeByProp,
    propTargetRefsByProp,
    selectedValueRefsByProp,
    selectedLiteralByProp,
    fieldLabelsByProp,
    literalPlaceholderByProp,
    autoProductName,
    missingRequiredContextRefs,
    missingRequiredPropRefs,
    hasAnyAttribute,
    canSubmit: submitBlockReason === null,
    submitBlockReason,
    warnings,
  };
}
