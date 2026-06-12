import { reconcileTaxonomyState } from "@/utils/taxonomy/client-state";
import {
  buildInitialListingStateForThing,
  buildListingThingPath,
  createEmptyListingTaxonomyState,
  decodeListingTaxonomyState,
} from "@/utils/taxonomy/listing-state";
import {
  isContextRef,
  isSegmentContextRef,
  uniqueRefs,
} from "@/utils/taxonomy/graph";
import { normalizeRef } from "@/utils/taxonomy/registry";
import {
  ProductTaxonomyLiteralAssertion,
  ProductTaxonomyRefAssertion,
  TaxonomyRegistry,
  TaxonomyState,
} from "@/utils/taxonomy/types";

function stringifyLiteralValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeSelectedValuesByProp(
  selectedValuesByProp: Record<string, string[]>
): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(selectedValuesByProp).flatMap(([propRef, valueRefs]) => {
      const normalizedPropRef = normalizeRef(propRef);
      const normalizedValueRefs = uniqueRefs(valueRefs || []);
      return normalizedPropRef && normalizedValueRefs.length > 0
        ? [[normalizedPropRef, normalizedValueRefs]]
        : [];
    })
  ) as Record<string, string[]>;
}

function selectedValuesByPropFromAssertions(
  assertions: ProductTaxonomyRefAssertion[]
): Record<string, string[]> {
  return assertions.reduce<Record<string, string[]>>((acc, assertion) => {
    const propRef = normalizeRef(assertion.propRef);
    const valueRef = normalizeRef(assertion.valueRef);
    if (!propRef || !valueRef) return acc;
    acc[propRef] = uniqueRefs([...(acc[propRef] || []), valueRef]);
    return acc;
  }, {});
}

function normalizeSelectedLiteralsByProp(
  selectedLiteralsByProp: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(selectedLiteralsByProp).flatMap(([propRef, value]) => {
      const normalizedPropRef = normalizeRef(propRef);
      return normalizedPropRef ? [[normalizedPropRef, value]] : [];
    })
  ) as Record<string, unknown>;
}

function normalizeListingTaxonomyState(
  state: TaxonomyState,
  registry: TaxonomyRegistry
): TaxonomyState {
  const primarySegmentRef = isSegmentContextRef(state.segmentRef || "")
    ? normalizeRef(state.segmentRef || "")
    : null;
  const semanticContextRefs: string[] = [];
  const quarantinedLegacyRefs: string[] = [];

  for (const ref of uniqueRefs([
    ...state.semanticContextRefs,
    ...state.quarantinedLegacyRefs,
  ])) {
    if (primarySegmentRef && ref === primarySegmentRef) continue;
    if (isSegmentContextRef(ref)) {
      quarantinedLegacyRefs.push(ref);
      continue;
    }
    if (isContextRef(ref) && registry.nodeByRef[ref]) {
      semanticContextRefs.push(ref);
      continue;
    }
    if (ref && registry.nodeByRef[ref]) quarantinedLegacyRefs.push(ref);
  }

  return {
    ...state,
    segmentRef: primarySegmentRef,
    thingRef: state.thingRef ? normalizeRef(state.thingRef) : null,
    thingPath: buildListingThingPath(registry, state.thingRef),
    semanticContextRefs: uniqueRefs(semanticContextRefs),
    selectedValuesByProp: normalizeSelectedValuesByProp(
      state.selectedValuesByProp
    ),
    selectedLiteralsByProp: normalizeSelectedLiteralsByProp(
      state.selectedLiteralsByProp
    ),
    quarantinedLegacyRefs: uniqueRefs(quarantinedLegacyRefs),
  };
}

export function reconcileListingTaxonomyState(
  state: TaxonomyState,
  registry: TaxonomyRegistry
): TaxonomyState {
  return reconcileTaxonomyState(
    normalizeListingTaxonomyState(state, registry),
    registry
  );
}

export function selectThingForListing(
  _state: TaxonomyState,
  thingRef: string,
  registry: TaxonomyRegistry
): TaxonomyState {
  return reconcileListingTaxonomyState(
    buildInitialListingStateForThing(registry, thingRef),
    registry
  );
}

export function selectSegmentForListing(
  state: TaxonomyState,
  segmentRef: string | null | undefined,
  registry: TaxonomyRegistry
): TaxonomyState {
  const normalizedSegmentRef = normalizeRef(segmentRef || "");
  return reconcileListingTaxonomyState(
    {
      ...state,
      segmentRef: isSegmentContextRef(normalizedSegmentRef)
        ? normalizedSegmentRef
        : null,
    },
    registry
  );
}

export function selectCompatibleSegmentForListing(
  state: TaxonomyState,
  segmentRef: string | null | undefined,
  compatibleSegmentRefs: string[],
  registry: TaxonomyRegistry
): TaxonomyState {
  const normalizedSegmentRef = normalizeRef(segmentRef || "");
  const compatibleSegmentSet = new Set(compatibleSegmentRefs.map(normalizeRef));
  const nextSegmentRef = compatibleSegmentSet.has(normalizedSegmentRef)
    ? normalizedSegmentRef
    : null;
  return selectSegmentForListing(state, nextSegmentRef, registry);
}

export function toggleContextForListing(
  state: TaxonomyState,
  contextRef: string,
  registry: TaxonomyRegistry
): TaxonomyState {
  const normalizedContextRef = normalizeRef(contextRef);
  if (
    !isContextRef(normalizedContextRef) ||
    isSegmentContextRef(normalizedContextRef)
  ) {
    return reconcileListingTaxonomyState(state, registry);
  }
  const existingRefs = state.semanticContextRefs.map(normalizeRef);
  const semanticContextRefs = existingRefs.includes(normalizedContextRef)
    ? existingRefs.filter((ref) => ref !== normalizedContextRef)
    : [...existingRefs, normalizedContextRef];
  return reconcileListingTaxonomyState(
    { ...state, semanticContextRefs },
    registry
  );
}

export function setPropValueForListing(
  state: TaxonomyState,
  propRef: string,
  valueRefs: string[],
  registry: TaxonomyRegistry
): TaxonomyState {
  const normalizedPropRef = normalizeRef(propRef);
  const normalizedValueRefs = uniqueRefs(valueRefs);
  const selectedValuesByProp = { ...state.selectedValuesByProp };
  if (!normalizedPropRef || normalizedValueRefs.length === 0)
    delete selectedValuesByProp[normalizedPropRef];
  else selectedValuesByProp[normalizedPropRef] = normalizedValueRefs;
  return reconcileListingTaxonomyState(
    { ...state, selectedValuesByProp },
    registry
  );
}

export function setLiteralForListing(
  state: TaxonomyState,
  propRef: string,
  value: unknown,
  registry: TaxonomyRegistry
): TaxonomyState {
  const normalizedPropRef = normalizeRef(propRef);
  if (!normalizedPropRef) return reconcileListingTaxonomyState(state, registry);
  return reconcileListingTaxonomyState(
    {
      ...state,
      selectedLiteralsByProp: {
        ...state.selectedLiteralsByProp,
        [normalizedPropRef]: value,
      },
    },
    registry
  );
}

export function clearPropForListing(
  state: TaxonomyState,
  propRef: string,
  registry: TaxonomyRegistry
): TaxonomyState {
  const normalizedPropRef = normalizeRef(propRef);
  const { [normalizedPropRef]: _valueRefs, ...selectedValuesByProp } =
    state.selectedValuesByProp;
  const { [normalizedPropRef]: _literalValue, ...selectedLiteralsByProp } =
    state.selectedLiteralsByProp;
  return reconcileListingTaxonomyState(
    { ...state, selectedValuesByProp, selectedLiteralsByProp },
    registry
  );
}

export function removeOverlayForListing(
  state: TaxonomyState,
  overlayRef: string,
  registry: TaxonomyRegistry
): TaxonomyState {
  const normalizedOverlayRef = normalizeRef(overlayRef);
  return reconcileListingTaxonomyState(
    {
      ...state,
      segmentRef:
        normalizeRef(state.segmentRef || "") === normalizedOverlayRef
          ? null
          : state.segmentRef,
      semanticContextRefs: state.semanticContextRefs.filter(
        (ref) => normalizeRef(ref) !== normalizedOverlayRef
      ),
      quarantinedLegacyRefs: state.quarantinedLegacyRefs.filter(
        (ref) => normalizeRef(ref) !== normalizedOverlayRef
      ),
    },
    registry
  );
}

export function clearListingTaxonomySelections(
  state: TaxonomyState,
  registry: TaxonomyRegistry,
  overrides: Partial<TaxonomyState> = {}
): TaxonomyState {
  const hasOverride = (key: keyof TaxonomyState) =>
    Object.prototype.hasOwnProperty.call(overrides, key);
  return reconcileListingTaxonomyState(
    {
      ...state,
      ...createEmptyListingTaxonomyState(),
      segmentRef: hasOverride("segmentRef")
        ? (overrides.segmentRef ?? null)
        : state.segmentRef,
      thingRef: hasOverride("thingRef")
        ? (overrides.thingRef ?? null)
        : state.thingRef,
      thingPath: hasOverride("thingPath")
        ? overrides.thingPath || []
        : state.thingPath,
    },
    registry
  );
}

export function hydrateListingTaxonomyStateFromProduct(
  params: {
    overlayValRefs?: string[];
    primaryThingRef?: string | null;
    refAssertions?: ProductTaxonomyRefAssertion[];
    literalAssertions?: ProductTaxonomyLiteralAssertion[];
    implicitBusinessFunctionRef?: string;
  },
  registry: TaxonomyRegistry
): TaxonomyState {
  const decodedState = decodeListingTaxonomyState(
    params.overlayValRefs || [],
    registry
  );
  const primaryThingRef = params.primaryThingRef
    ? normalizeRef(params.primaryThingRef)
    : null;
  const implicitBusinessFunctionRef = normalizeRef(
    params.implicitBusinessFunctionRef || ""
  );
  return reconcileListingTaxonomyState(
    {
      ...decodedState,
      thingRef: primaryThingRef,
      thingPath: buildListingThingPath(registry, primaryThingRef),
      selectedValuesByProp: selectedValuesByPropFromAssertions(
        params.refAssertions || []
      ),
      selectedLiteralsByProp: Object.fromEntries(
        (params.literalAssertions || []).flatMap((assertion) => {
          const propRef = normalizeRef(assertion.propRef);
          return propRef
            ? [[propRef, stringifyLiteralValue(assertion.value)]]
            : [];
        })
      ),
      quarantinedLegacyRefs: decodedState.quarantinedLegacyRefs.filter(
        (ref) => normalizeRef(ref) !== implicitBusinessFunctionRef
      ),
    },
    registry
  );
}
