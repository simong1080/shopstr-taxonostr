import { ParsedUrlQuery } from "querystring";
import { buildMarketplaceHref } from "@/utils/taxonomy/routing";
import {
  getInheritedValRefs,
  isSameOrDescendant,
  normalizeRef,
  propValueType,
} from "@/utils/taxonomy/registry";
import { getTaxonomyDisplayLabel } from "@/utils/taxonomy/display";
import {
  buildResolvedTaxonomyState,
  contextChangesResolvedTaxonomyState,
  resolveSelectedValuesFromRefs,
  thingPath,
} from "@/utils/taxonomy/client-state";
import {
  compatibleThingFrontierForSegment,
  filterThingRefsForActiveContext,
  getAutoActiveRequiredRefs,
  getDirectContextChildren,
  getDirectThingChildren,
  isContextRef,
  isPropRef,
  isSegmentContextRef,
  isThingRef,
  relationsForRefs,
  requiredRelationsForRefs,
  thingSubtreeHasActiveContext,
  uniqueRefs,
} from "@/utils/taxonomy/graph";
import { TaxonomyRegistry, TaxonomyState } from "@/utils/taxonomy/types";
export { buildMarketplaceHref } from "@/utils/taxonomy/routing";
export {
  filterThingRefsForActiveContext,
  getAutoActiveRequiredRefs,
  getDirectChildren,
  getDirectContextChildren,
  getDirectThingChildren,
  getInheritedRequiredRelations,
} from "@/utils/taxonomy/graph";

export type MarketplaceScopeState = {
  contextRef: string;
  thingRef: string;
  fallbackTaxonRef: string;
  pageMode: MarketplacePageMode;
  browseDepth: number;
  nextChoices: TaxonomyNextChoice[];
  navigationItems: NavigationItem[];
  childThingRefinementRefs: string[];
  browseSections: LegacyMarketplacePropBrowseSection[];
  filterProps: string[];
  autoActiveRequiredRefs: string[];
  unresolvedRequiredPropRefs: string[];
  selectedValuesByProp: Record<string, string[]>;
  directContextRefs: string[];
  directThingRefs: string[];
  relatedThingRefs: string[];
  meaningfulOverlayContextRefs: string[];
  autoContextRef: string;
  propNavigationRefs: string[];
  showListings: boolean;
};

export type MarketplacePageMode = "browse" | "listings";

const NON_BROWSE_DEPTH_REFS = new Set([
  "val:context",
  "val:context:segment",
  "val:context:usecase",
  "val:context:system",
  "val:context:medium",
  "thing",
  "thing:artifact",
  "thing:organization",
  "thing:game",
]);

const LISTINGS_MODE_BROWSE_DEPTH = 3;

export type NavigationItem =
  | { kind: "context"; ref: string }
  | { kind: "thing"; ref: string };

export type MarketplaceScopeNavigationSection = {
  kind: "contexts" | "compatibleThings" | "childThings";
  refs: string[];
};

export type MarketplaceNavMode = "root" | "localScope";

export type MarketplaceNavItem = {
  kind: "context" | "thing";
  ref: string;
  label: string;
  depth: number;
  isCurrent: boolean;
};

export type MarketplaceNavSection = {
  id: string;
  label: string;
  kind: "context" | "thing";
  items: MarketplaceNavItem[];
};

export type MarketplaceScopeSidebarNode = MarketplaceNavItem;
export type MarketplaceScopeSidebarSection = MarketplaceNavSection;

// Legacy disabled prop/value browse section shape. Marketplace browse surfaces
// are contexts + things only; prop/value shortcuts belong to filter view-models.
export type LegacyMarketplacePropBrowseSection = {
  propRef: string;
  valueRefs: string[];
};

// Core semantic resolver output: these describe what taxonomy choices remain
// valid or required next. They intentionally do not imply cards, routes,
// dropdowns, or whether listings should be visible on a page.
export type TaxonomyNextChoice =
  | { kind: "context"; ref: string }
  | { kind: "thing"; ref: string }
  | { kind: "prop"; propRef: string; options: string[] }
  | { kind: "value"; ref: string; propRef?: string };

function nextChoicesToNavigationItems(
  nextChoices: TaxonomyNextChoice[]
): NavigationItem[] {
  // Marketplace adapter output: navigationItems are presentation/navigation
  // objects consumed by marketplace cards/dropdowns. Listing form flows can
  // later consume nextChoices directly without inheriting marketplace layout.
  return nextChoices.flatMap((choice): NavigationItem[] => {
    if (choice.kind === "context")
      return [{ kind: "context", ref: choice.ref }];
    if (choice.kind === "thing") return [{ kind: "thing", ref: choice.ref }];
    return [];
  });
}

export type MarketplaceResolverTrace = {
  url: string;
  registryLookup: {
    selectedThingExists: boolean;
    selectedContextRefsExist: Record<string, boolean>;
    nodeCount: number;
  };
  activeScope: {
    thingRef?: string;
    contextRefs: {
      selected: string[];
      required: string[];
    };
    selectedValuesByProp: Record<string, string[]>;
    selectedLiteralsByProp: Record<string, unknown[]>;
  };
  closure: {
    thingAncestry: string[];
    thingDescendants: string[];
    inheritedRelations: string[];
    inheritedRequiredRelations: string[];
    selectedContextRelations: string[];
    selectedContextRequiredRelations: string[];
  };
  requirements: {
    requiredConcreteRefs: string[];
    requiredPropRefs: string[];
    answeredRequiredPropRefs: string[];
    unresolvedRequiredPropRefs: string[];
  };
  optionalChoices: {
    optionalContextRefs: string[];
    optionalPropRefs: string[];
    validValuesByProp: Record<string, string[]>;
  };
  browse: {
    directThingChildren: string[];
    contextCompatibleThingChildren: string[];
    directContextChildren: string[];
    navigationItems: NavigationItem[];
    blockedByRequiredProps: string[];
    terminal: boolean;
    terminalReason: string;
  };
  listings: {
    shouldShowListings: boolean;
    matchedListingCount: number;
    filtersFromActualListingsOnly: boolean;
    filterProps: string[];
  };
};

function firstQueryValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return normalizeRef(value[0] || "");
  return normalizeRef(value || "");
}

function queryValues(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return uniqueRefs(value);
  return uniqueRefs(value ? [value] : []);
}

function queryRawValues(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

function isConcreteRequiredRef(ref: string): boolean {
  const normalizedRef = normalizeRef(ref);
  return Boolean(normalizedRef) && !isPropRef(normalizedRef);
}

function emptyTaxonomyState(
  overrides: Partial<TaxonomyState> = {}
): TaxonomyState {
  return {
    segmentRef: null,
    thingRef: null,
    thingPath: [],
    semanticContextRefs: [],
    selectedValuesByProp: {},
    selectedLiteralsByProp: {},
    quarantinedLegacyRefs: [],
    ...overrides,
  };
}

function marketplaceTaxonomyState(
  registry: TaxonomyRegistry,
  thingRef: string,
  contextRef: string,
  selectedValuesByProp: Record<string, string[]> = {}
): TaxonomyState {
  return emptyTaxonomyState({
    thingRef,
    thingPath: thingPath(thingRef, registry),
    semanticContextRefs: contextRef ? [contextRef] : [],
    selectedValuesByProp,
  });
}

export function getDirectRelatedThingsForContext(
  registry: TaxonomyRegistry,
  contextRef: string
): string[] {
  const normalizedContextRef = normalizeRef(contextRef);
  const relatedThingRefs = (
    registry.reverseRefsByRef[normalizedContextRef] || []
  )
    .filter((reverseRef) => reverseRef.field === "relations")
    .map((reverseRef) => normalizeRef(reverseRef.sourceRef))
    .filter((ref) => registry.nodeByRef[ref]?.family === "thing");

  return keepMostSpecificThingRefs(registry, relatedThingRefs);
}

function keepMostSpecificThingRefs(
  registry: TaxonomyRegistry,
  thingRefs: string[]
): string[] {
  const relatedThingRefs = uniqueRefs(thingRefs).filter(
    (ref) => registry.nodeByRef[ref]?.family === "thing"
  );
  const relatedThingSet = new Set(relatedThingRefs);
  const ancestorRefs = new Set<string>();
  for (const ref of relatedThingRefs) {
    for (const ancestorRef of registry.ancestryByRef[normalizeRef(ref)] || []) {
      const normalizedAncestorRef = normalizeRef(ancestorRef);
      if (
        normalizedAncestorRef !== ref &&
        relatedThingSet.has(normalizedAncestorRef)
      ) {
        ancestorRefs.add(normalizedAncestorRef);
      }
    }
  }
  return relatedThingRefs.filter((ref) => !ancestorRefs.has(ref));
}

function nearestMarketplaceThingParent(
  registry: TaxonomyRegistry,
  ref: string
): string {
  const normalizedRef = normalizeRef(ref);
  const ancestry = registry.ancestryByRef[normalizedRef] || [];
  const parentRefs = ancestry
    .map(normalizeRef)
    .filter((ancestorRef) => ancestorRef !== normalizedRef)
    .filter(
      (ancestorRef) => registry.nodeByRef[ancestorRef]?.family === "thing"
    )
    .filter((ancestorRef) => !NON_BROWSE_DEPTH_REFS.has(ancestorRef));
  return parentRefs[parentRefs.length - 1] || "";
}

function projectCompatibleThingRefsForContext(
  registry: TaxonomyRegistry,
  refs: string[]
): string[] {
  const normalizedRefs = uniqueRefs(refs.map(normalizeRef)).filter(
    (ref) => registry.nodeByRef[ref]?.family === "thing"
  );
  if (normalizedRefs.length <= 1) return normalizedRefs;

  const refsByParent = new Map<string, string[]>();
  for (const ref of normalizedRefs) {
    const parentRef = nearestMarketplaceThingParent(registry, ref);
    const key = parentRef || ref;
    refsByParent.set(key, [...(refsByParent.get(key) || []), ref]);
  }

  const projectedRefs = Array.from(refsByParent.entries()).map(
    ([parentRef, groupRefs]) => {
      if (groupRefs.length > 1 && registry.nodeByRef[parentRef])
        return parentRef;
      return groupRefs[0]!;
    }
  );

  return uniqueRefs(projectedRefs).filter((ref) => {
    const ancestry = registry.ancestryByRef[ref] || [];
    return !projectedRefs.some(
      (candidateRef) => candidateRef !== ref && ancestry.includes(candidateRef)
    );
  });
}

function getContextBrowseThingRefs(
  registry: TaxonomyRegistry,
  contextRef: string
): string[] {
  const normalizedContextRef = normalizeRef(contextRef);
  if (!isSegmentContextRef(normalizedContextRef)) {
    return projectCompatibleThingRefsForContext(
      registry,
      getDirectRelatedThingsForContext(registry, normalizedContextRef)
    );
  }
  return projectCompatibleThingRefsForContext(
    registry,
    keepMostSpecificThingRefs(registry, [
      ...getDirectRelatedThingsForContext(registry, normalizedContextRef),
      ...compatibleThingFrontierForSegment(registry, normalizedContextRef),
    ])
  );
}

function parsePropValuePairs(
  values: string[]
): Array<{ propRef: string; valueRef: string }> {
  return values.flatMap((value) => {
    const [rawPropRef, rawValueRef] = value.split("|");
    if (!rawPropRef || !rawValueRef) return [];
    try {
      return [
        {
          propRef: normalizeRef(decodeURIComponent(rawPropRef)),
          valueRef: normalizeRef(decodeURIComponent(rawValueRef)),
        },
      ];
    } catch {
      return [];
    }
  });
}

function selectedValuesByPropFromQuery(
  registry: TaxonomyRegistry,
  thingRef: string,
  contextRef: string,
  selectedPropValuePairs: Array<{ propRef: string; valueRef: string }>,
  legacyValueRefs: string[] = []
): Record<string, string[]> {
  const state = marketplaceTaxonomyState(registry, thingRef, contextRef);
  const explicitSelectedValuesByProp = selectedPropValuePairsByProp(
    registry,
    selectedPropValuePairs
  );
  const legacySelectedValuesByProp = resolveSelectedValuesFromRefs({
    registry,
    state,
    selectedPropValuePairs: [],
    legacyValueRefs,
    getLegacyCandidatePropRefs: (selectedValuesByProp) =>
      getUnresolvedRequiredPropRefs(registry, thingRef, contextRef, {
        ...explicitSelectedValuesByProp,
        ...selectedValuesByProp,
      }),
  });
  return {
    ...explicitSelectedValuesByProp,
    ...legacySelectedValuesByProp,
  };
}

function valueMatchesPropRoot(
  registry: TaxonomyRegistry,
  propRef: string,
  valueRef: string
): boolean {
  const normalizedValueRef = normalizeRef(valueRef);
  return (registry.propRootsByRef[propRef] || []).some(
    (rootRef) =>
      normalizeRef(rootRef) === normalizedValueRef ||
      isSameOrDescendant(registry, normalizedValueRef, rootRef)
  );
}

function selectedPropValuePairsByProp(
  registry: TaxonomyRegistry,
  selectedPropValuePairs: Array<{ propRef: string; valueRef: string }>
): Record<string, string[]> {
  const selectedValuesByProp: Record<string, string[]> = {};
  for (const pair of selectedPropValuePairs) {
    const propRef = normalizeRef(pair.propRef);
    const valueRef = normalizeRef(pair.valueRef);
    if (!propRef || !valueRef) continue;
    if (registry.nodeByRef[propRef]?.family !== "prop") continue;
    if (!registry.nodeByRef[valueRef]) continue;
    if (!valueMatchesPropRoot(registry, propRef, valueRef)) continue;
    selectedValuesByProp[propRef] = uniqueRefs([
      ...(selectedValuesByProp[propRef] || []),
      valueRef,
    ]);
  }
  return selectedValuesByProp;
}

export function getUnresolvedRequiredPropRefs(
  registry: TaxonomyRegistry,
  thingRef: string,
  contextRef: string,
  selectedValuesByProp: Record<string, string[]>
): string[] {
  if (!thingRef) return [];
  const autoActiveRequiredRefs = getAutoActiveRequiredRefs(registry, thingRef);
  const state = marketplaceTaxonomyState(
    registry,
    thingRef,
    "",
    selectedValuesByProp
  );
  const scopedState = {
    ...state,
    thingRef,
    semanticContextRefs: uniqueRefs([
      contextRef,
      ...autoActiveRequiredRefs.filter(isContextRef),
    ]),
  };
  return buildResolvedTaxonomyState(scopedState, registry)
    .missingRequiredTaxonomyRefs;
}

function optionFamily(ref: string): "thing" | "context" | "value" | "other" {
  const normalizedRef = normalizeRef(ref);
  if (normalizedRef.startsWith("thing:")) return "thing";
  if (normalizedRef.startsWith("val:context:")) return "context";
  if (normalizedRef.startsWith("val:")) return "value";
  return "other";
}

function familyUniform(
  options: string[],
  family: "thing" | "context" | "value"
): boolean {
  return (
    options.length > 0 &&
    options.every((optionRef) => optionFamily(optionRef) === family)
  );
}

export function getMeaningfulOverlayContexts(
  registry: TaxonomyRegistry,
  selectedThingRef: string,
  activeScope:
    | Pick<MarketplaceScopeState, "contextRef">
    | { contextRef?: string }
): string[] {
  const activeContextRef = normalizeRef(activeScope.contextRef || "");
  const baseState = marketplaceTaxonomyState(registry, selectedThingRef, "");
  const baseResolvedState = buildResolvedTaxonomyState(baseState, registry);
  return uniqueRefs(getInheritedValRefs(registry, selectedThingRef))
    .filter(isContextRef)
    .filter((contextRef) => contextRef !== activeContextRef)
    .filter((contextRef) =>
      contextChangesResolvedTaxonomyState(
        registry,
        baseState,
        contextRef,
        baseResolvedState
      )
    );
}

function valueRefsOverlap(
  registry: TaxonomyRegistry,
  leftRef: string,
  rightRef: string
): boolean {
  const normalizedLeftRef = normalizeRef(leftRef);
  const normalizedRightRef = normalizeRef(rightRef);
  return (
    normalizedLeftRef === normalizedRightRef ||
    isSameOrDescendant(registry, normalizedLeftRef, normalizedRightRef) ||
    isSameOrDescendant(registry, normalizedRightRef, normalizedLeftRef)
  );
}

function thingMatchesSelectedPropValues(
  registry: TaxonomyRegistry,
  thingRef: string,
  contextRef: string,
  selectedValuesByProp: Record<string, string[]>
): boolean {
  const selectedEntries = Object.entries(selectedValuesByProp).flatMap(
    ([propRef, valueRefs]) => {
      const normalizedPropRef = normalizeRef(propRef);
      const normalizedValueRefs = uniqueRefs(valueRefs.map(normalizeRef));
      return normalizedValueRefs.length > 0
        ? [[normalizedPropRef, normalizedValueRefs] as const]
        : [];
    }
  );
  if (selectedEntries.length === 0) return true;

  const candidateState = marketplaceTaxonomyState(
    registry,
    thingRef,
    contextRef
  );
  const resolvedState = buildResolvedTaxonomyState(candidateState, registry);

  return selectedEntries.every(([propRef, selectedValueRefs]) => {
    const scopeResolution = resolvedState.propResolutions[propRef];
    if (
      scopeResolution?.resolved &&
      !scopeResolution.ambiguous &&
      scopeResolution.valueRefs.length > 0
    ) {
      return selectedValueRefs.some((selectedValueRef) =>
        scopeResolution.valueRefs.some((scopeValueRef) =>
          valueRefsOverlap(registry, selectedValueRef, scopeValueRef)
        )
      );
    }

    const availableValues = resolvedState.availableValues[propRef] || [];
    if (availableValues.length === 0) return true;
    return selectedValueRefs.every((selectedValueRef) =>
      availableValues.some((availableValueRef) =>
        valueRefsOverlap(registry, selectedValueRef, availableValueRef)
      )
    );
  });
}

function filterPropsForScope(
  registry: TaxonomyRegistry,
  thingRef: string,
  contextRef: string,
  selectedValuesByProp: Record<string, string[]>
): string[] {
  if (!thingRef) return [];
  const state = marketplaceTaxonomyState(
    registry,
    thingRef,
    contextRef,
    selectedValuesByProp
  );
  const resolvedState = buildResolvedTaxonomyState(state, registry);
  return resolvedState.availableProps.filter((propRef) => {
    if (propValueType(registry, propRef)) return true;
    const options = resolvedState.availableValues[propRef] || [];
    return (
      options.length > 0 &&
      !familyUniform(options, "thing") &&
      !familyUniform(options, "context")
    );
  });
}

export function shouldShowListingsForScope(
  scopeState: MarketplaceScopeState
): boolean {
  return scopeState.showListings;
}

export function buildMarketplaceScopeNavigation(
  scopeState: MarketplaceScopeState
): MarketplaceScopeNavigationSection[] {
  if (scopeState.pageMode !== "listings") return [];
  return [
    { kind: "contexts" as const, refs: scopeState.directContextRefs },
    {
      kind: "compatibleThings" as const,
      refs: scopeState.thingRef ? [] : scopeState.relatedThingRefs,
    },
    { kind: "childThings" as const, refs: scopeState.childThingRefinementRefs },
  ].filter((section) => section.refs.length > 0);
}

function localBranchRefs(
  registry: TaxonomyRegistry,
  ref: string,
  roots: Set<string>
): string[] {
  const normalizedRef = normalizeRef(ref);
  if (!normalizedRef) return [];
  return (registry.ancestryByRef[normalizedRef] || [normalizedRef])
    .map(normalizeRef)
    .filter((ancestorRef) => ancestorRef && !roots.has(ancestorRef))
    .slice(-2);
}

function navItems(
  refs: string[],
  kind: "context" | "thing",
  registry: TaxonomyRegistry,
  locale: string,
  currentRef: string,
  depth = 0
): MarketplaceNavItem[] {
  return refs.map((ref) => ({
    kind,
    ref,
    label: getTaxonomyDisplayLabel(registry, ref, locale, "category"),
    depth,
    isCurrent: normalizeRef(ref) === normalizeRef(currentRef),
  }));
}

function branchNavItems(
  refs: string[],
  kind: "context" | "thing",
  registry: TaxonomyRegistry,
  locale: string,
  currentRef: string
): MarketplaceNavItem[] {
  return refs.map((ref, index) => ({
    kind,
    ref,
    label: getTaxonomyDisplayLabel(registry, ref, locale, "category"),
    depth: index,
    isCurrent: normalizeRef(ref) === normalizeRef(currentRef),
  }));
}

function compatibleContextRefsForThing(
  registry: TaxonomyRegistry,
  thingRef: string
): string[] {
  return uniqueRefs(getInheritedValRefs(registry, thingRef))
    .filter(isContextRef)
    .filter((ref) => registry.nodeByRef[ref]);
}

function effectiveThingScopeRefs(
  registry: TaxonomyRegistry,
  thingRef: string
): string[] {
  const normalizedThingRef = normalizeRef(thingRef);
  return uniqueRefs([
    normalizedThingRef,
    ...Object.keys(registry.descendantSetByRef[normalizedThingRef] || {}),
  ]).filter((ref) => registry.nodeByRef[ref]?.family === "thing");
}

function collapseContextRefsToVisibleNodes(
  registry: TaxonomyRegistry,
  refs: string[]
): string[] {
  const contextRefs = uniqueRefs(refs)
    .filter(isContextRef)
    .filter((ref) => registry.nodeByRef[ref]);
  const contextRefSet = new Set(contextRefs);
  return contextRefs.filter(
    (ref) =>
      !contextRefs.some(
        (candidateRef) =>
          candidateRef !== ref &&
          contextRefSet.has(candidateRef) &&
          isSameOrDescendant(registry, candidateRef, ref)
      )
  );
}

function compatibleContextRefsForThingScope(
  registry: TaxonomyRegistry,
  thingRef: string
): string[] {
  const normalizedThingRef = normalizeRef(thingRef);
  if (
    !normalizedThingRef ||
    INVISIBLE_MARKETPLACE_ROOT_REFS.has(normalizedThingRef)
  )
    return [];
  return collapseContextRefsToVisibleNodes(
    registry,
    effectiveThingScopeRefs(registry, normalizedThingRef).flatMap((ref) =>
      compatibleContextRefsForThing(registry, ref)
    )
  );
}

function contextSpecificityRank(ref: string): number {
  const normalizedRef = normalizeRef(ref);
  if (normalizedRef.startsWith("val:context:segment:")) return 0;
  if (normalizedRef.startsWith("val:context:usecase:")) return 1;
  if (normalizedRef.startsWith("val:context:system:")) return 2;
  if (normalizedRef.startsWith("val:context:medium:")) return 3;
  return 4;
}

function sortedContextRefs(
  registry: TaxonomyRegistry,
  refs: string[],
  locale: string
): string[] {
  return uniqueRefs(refs.map(normalizeRef)).sort((a, b) => {
    const rankDelta = contextSpecificityRank(a) - contextSpecificityRank(b);
    if (rankDelta !== 0) return rankDelta;
    return getTaxonomyDisplayLabel(
      registry,
      a,
      locale,
      "category"
    ).localeCompare(
      getTaxonomyDisplayLabel(registry, b, locale, "category"),
      locale
    );
  });
}

const ROOT_CONTEXT_REFS = [
  "val:context:segment",
  "val:context:usecase",
  "val:context:system",
  "val:context:medium",
];

const ROOT_THING_REFS = ["thing:artifact"];
const INVISIBLE_MARKETPLACE_ROOT_REFS = new Set([
  ...ROOT_CONTEXT_REFS,
  ...ROOT_THING_REFS,
]);

export function buildMarketplaceRootNavSections(
  registry: TaxonomyRegistry,
  locale = "en"
): MarketplaceNavSection[] {
  const contextSections = ROOT_CONTEXT_REFS.flatMap(
    (rootRef): MarketplaceNavSection[] => {
      const refs = getDirectContextChildren(registry, rootRef);
      if (refs.length === 0) return [];
      return [
        {
          id: `root:${rootRef}`,
          label: `Shop by ${getTaxonomyDisplayLabel(registry, rootRef, locale, "category")}`,
          kind: "context",
          items: navItems(refs, "context", registry, locale, "", 0),
        },
      ];
    }
  );

  const thingSections = ROOT_THING_REFS.flatMap(
    (rootRef): MarketplaceNavSection[] => {
      const refs = getDirectThingChildren(registry, rootRef);
      if (refs.length === 0) return [];
      return [
        {
          id: `root:${rootRef}`,
          label: "Item type",
          kind: "thing",
          items: navItems(refs, "thing", registry, locale, "", 0),
        },
      ];
    }
  );

  return [...contextSections, ...thingSections];
}

export function buildMarketplaceBrowseNavSections(
  registry: TaxonomyRegistry,
  scopeState: MarketplaceScopeState,
  locale = "en"
): MarketplaceNavSection[] {
  if (!scopeState.contextRef && !scopeState.thingRef) {
    return buildMarketplaceRootNavSections(registry, locale);
  }

  if (
    INVISIBLE_MARKETPLACE_ROOT_REFS.has(
      scopeState.contextRef || scopeState.thingRef
    )
  ) {
    return buildMarketplaceRootNavSections(registry, locale);
  }

  const contextRefs = scopeState.navigationItems
    .filter(
      (item): item is Extract<NavigationItem, { kind: "context" }> =>
        item.kind === "context"
    )
    .map((item) => item.ref);
  const thingRefs = uniqueRefs([
    ...scopeState.navigationItems
      .filter(
        (item): item is Extract<NavigationItem, { kind: "thing" }> =>
          item.kind === "thing"
      )
      .map((item) => item.ref),
    ...scopeState.childThingRefinementRefs,
  ]);
  const sections: MarketplaceNavSection[] = [];

  if (contextRefs.length > 0) {
    sections.push({
      id: "browse:contexts",
      label: scopeState.contextRef ? "More categories" : "Category",
      kind: "context",
      items: navItems(contextRefs, "context", registry, locale, "", 0),
    });
  }

  if (thingRefs.length > 0) {
    sections.push({
      id: "browse:things",
      label: `Shop by ${commonThingParentLabel(registry, thingRefs, locale)}`,
      kind: "thing",
      items: navItems(thingRefs, "thing", registry, locale, "", 0),
    });
  }

  return sections;
}

function commonThingParentLabel(
  registry: TaxonomyRegistry,
  refs: string[],
  locale: string
): string {
  if (refs.length === 0) return "item type";
  const normalizedRefs = refs.map(normalizeRef);
  const refSet = new Set(normalizedRefs);
  const ancestryLists = normalizedRefs.map(
    (ref) => registry.ancestryByRef[ref] || [ref]
  );
  const commonRef = [...(ancestryLists[0] || [])]
    .reverse()
    .map(normalizeRef)
    .find(
      (candidateRef) =>
        candidateRef.startsWith("thing:") &&
        candidateRef !== "thing" &&
        !refSet.has(candidateRef) &&
        ancestryLists.every((ancestry) =>
          ancestry.map(normalizeRef).includes(candidateRef)
        )
    );
  return commonRef
    ? getTaxonomyDisplayLabel(registry, commonRef, locale, "category")
    : "item type";
}

export function buildMarketplaceLocalNavSections(
  registry: TaxonomyRegistry,
  scopeState: MarketplaceScopeState,
  locale = "en"
): MarketplaceNavSection[] {
  if (scopeState.pageMode !== "listings") return [];
  if (!scopeState.contextRef && !scopeState.thingRef)
    return buildMarketplaceRootNavSections(registry, locale);
  if (
    INVISIBLE_MARKETPLACE_ROOT_REFS.has(
      scopeState.contextRef || scopeState.thingRef
    )
  ) {
    return buildMarketplaceRootNavSections(registry, locale);
  }

  const currentRef = scopeState.thingRef || scopeState.contextRef;
  const sections: MarketplaceNavSection[] = [];
  const compatibleContextRefs =
    scopeState.thingRef && !scopeState.contextRef
      ? sortedContextRefs(
          registry,
          compatibleContextRefsForThingScope(registry, scopeState.thingRef),
          locale
        )
      : [];
  if (compatibleContextRefs.length > 0) {
    sections.push({
      id: "local:compatible-contexts",
      label: "Category",
      kind: "context",
      items: navItems(
        compatibleContextRefs,
        "context",
        registry,
        locale,
        currentRef,
        0
      ),
    });
  }

  const contextBranchRefs = localBranchRefs(
    registry,
    scopeState.contextRef,
    new Set([
      "val:context",
      "val:context:segment",
      "val:context:usecase",
      "val:context:system",
      "val:context:medium",
    ])
  );
  const thingBranchRefs = localBranchRefs(
    registry,
    scopeState.thingRef,
    new Set(["thing", "thing:artifact", "thing:organization", "thing:game"])
  );

  if (contextBranchRefs.length > 0) {
    const compatibleThingItems =
      !scopeState.thingRef && scopeState.relatedThingRefs.length > 0
        ? navItems(
            scopeState.relatedThingRefs,
            "thing",
            registry,
            locale,
            currentRef,
            contextBranchRefs.length
          )
        : [];
    sections.push({
      id: "local:context-branch",
      label: "Category",
      kind: "context",
      items: [
        ...branchNavItems(
          contextBranchRefs,
          "context",
          registry,
          locale,
          currentRef
        ),
        ...compatibleThingItems,
      ],
    });
  }

  if (scopeState.thingRef) {
    const thingSectionRefs = uniqueRefs([
      ...thingBranchRefs,
      ...scopeState.childThingRefinementRefs,
    ]);
    sections.push({
      id: "local:thing-branch",
      label: "Item type",
      kind: "thing",
      items: [
        ...branchNavItems(
          thingBranchRefs,
          "thing",
          registry,
          locale,
          currentRef
        ),
        ...navItems(
          scopeState.childThingRefinementRefs.filter(
            (ref) => !thingBranchRefs.includes(normalizeRef(ref))
          ),
          "thing",
          registry,
          locale,
          currentRef,
          thingBranchRefs.length > 0 ? thingBranchRefs.length : 1
        ),
      ].filter(
        (item, index, items) =>
          items.findIndex((candidate) => candidate.ref === item.ref) ===
            index && thingSectionRefs.includes(item.ref)
      ),
    });
  }

  if (!scopeState.thingRef && scopeState.directContextRefs.length > 0) {
    sections.push({
      id: "local:contexts",
      label: "More categories",
      kind: "context",
      items: navItems(
        scopeState.directContextRefs,
        "context",
        registry,
        locale,
        currentRef,
        1
      ),
    });
  }

  if (
    !scopeState.contextRef &&
    !scopeState.thingRef &&
    scopeState.relatedThingRefs.length > 0
  ) {
    sections.push({
      id: "local:compatible-things",
      label: `Shop by ${commonThingParentLabel(registry, scopeState.relatedThingRefs, locale)}`,
      kind: "thing",
      items: navItems(
        scopeState.relatedThingRefs,
        "thing",
        registry,
        locale,
        currentRef,
        1
      ),
    });
  }

  if (!scopeState.thingRef && scopeState.childThingRefinementRefs.length > 0) {
    sections.push({
      id: "local:child-things",
      label: `More ${commonThingParentLabel(registry, scopeState.childThingRefinementRefs, locale)}`,
      kind: "thing",
      items: navItems(
        scopeState.childThingRefinementRefs,
        "thing",
        registry,
        locale,
        currentRef,
        1
      ),
    });
  }

  return sections.filter((section) => section.items.length > 0);
}

export function buildMarketplaceNavSections(params: {
  mode: MarketplaceNavMode;
  registry: TaxonomyRegistry;
  scopeState?: MarketplaceScopeState;
  locale?: string;
}): MarketplaceNavSection[] {
  if (params.mode === "root") {
    return buildMarketplaceRootNavSections(params.registry, params.locale);
  }
  if (!params.scopeState) return [];
  return buildMarketplaceLocalNavSections(
    params.registry,
    params.scopeState,
    params.locale
  );
}

export function getMarketplaceNavHref(params: {
  item: MarketplaceNavItem | NavigationItem;
  registry?: TaxonomyRegistry | null;
  currentScopeState: MarketplaceScopeState;
  listingsIntent?: boolean;
}): string {
  const normalizedRef = normalizeRef(params.item.ref);
  const activeContextRef = normalizeRef(params.currentScopeState.contextRef);
  const targetContextRef =
    params.item.kind === "context" ? normalizedRef : activeContextRef;
  const targetThingRef = params.item.kind === "thing" ? normalizedRef : "";
  const shouldPreserveContext =
    params.item.kind === "thing" &&
    Boolean(activeContextRef) &&
    (!params.registry ||
      thingSubtreeHasActiveContext(
        params.registry,
        normalizedRef,
        activeContextRef
      ));

  return buildMarketplaceNavigationHref({
    registry: params.registry,
    currentScopeState: params.currentScopeState,
    targetThingRef,
    targetContextRef:
      params.item.kind === "thing" && !shouldPreserveContext
        ? ""
        : targetContextRef,
    listingsIntent: params.listingsIntent,
  });
}

export function buildMarketplaceScopeSidebarSections(
  registry: TaxonomyRegistry,
  scopeState: MarketplaceScopeState,
  locale = "en"
): MarketplaceScopeSidebarSection[] {
  return buildMarketplaceLocalNavSections(registry, scopeState, locale);
}

export function deriveMarketplaceListingVisibility(params: {
  explicitListings: boolean;
  hasTaxonomyNavigation: boolean;
}): boolean {
  // Marketplace UI policy, not taxonomy truth. Current behavior is preserved:
  // listings are shown only after semantic navigation is exhausted, unless the
  // user explicitly asks for listings under the current taxonomy scope.
  return params.explicitListings || !params.hasTaxonomyNavigation;
}

export function deriveMarketplacePageMode(params: {
  contextRef: string;
  thingRef: string;
  explicitListings: boolean;
  hasSelectedPropValues?: boolean;
  browseDepth: number;
  childContextRefs: string[];
  compatibleThingRefs: string[];
  childThingRefs: string[];
}): MarketplacePageMode {
  if (params.explicitListings) return "listings";
  if (params.hasSelectedPropValues) return "listings";
  if (params.browseDepth >= LISTINGS_MODE_BROWSE_DEPTH) return "listings";

  const hasContext = Boolean(params.contextRef);
  const hasThing = Boolean(params.thingRef);
  const hasBrowseChoices =
    params.childContextRefs.length > 0 ||
    params.compatibleThingRefs.length > 0 ||
    params.childThingRefs.length > 0;

  if (!hasContext && !hasThing) return "browse";
  if (hasContext && hasThing)
    return params.childThingRefs.length > 0 ? "browse" : "listings";
  return hasBrowseChoices ? "browse" : "listings";
}

function browseDepthForRef(registry: TaxonomyRegistry, ref: string): number {
  const normalizedRef = normalizeRef(ref);
  if (!normalizedRef) return 0;
  return (registry.ancestryByRef[normalizedRef] || [normalizedRef])
    .map(normalizeRef)
    .filter(
      (ancestorRef) => ancestorRef && !NON_BROWSE_DEPTH_REFS.has(ancestorRef)
    ).length;
}

function marketplaceBrowseDepth(
  registry: TaxonomyRegistry,
  contextRef: string,
  thingRef: string
): number {
  return (
    browseDepthForRef(registry, contextRef) +
    browseDepthForRef(registry, thingRef)
  );
}

export function buildActiveMarketplaceState(
  query: ParsedUrlQuery,
  registry?: TaxonomyRegistry | null
): MarketplaceScopeState {
  const fallbackTaxonRef = firstQueryValue(query.taxon);
  const contextRef =
    firstQueryValue(query.context) ||
    (isContextRef(fallbackTaxonRef) ? fallbackTaxonRef : "");
  const thingRef =
    firstQueryValue(query.thing) ||
    (isThingRef(fallbackTaxonRef) ? fallbackTaxonRef : "");
  const selectedValueRefs = queryValues(query.value);
  const selectedPropValuePairs = parsePropValuePairs(queryRawValues(query.pv));
  const explicitListings = firstQueryValue(query.listings) === "1";
  const hasSelectedPropValuePairs =
    selectedPropValuePairs.length > 0 || selectedValueRefs.length > 0;

  if (!registry) {
    const pageMode = deriveMarketplacePageMode({
      contextRef,
      thingRef,
      explicitListings,
      hasSelectedPropValues: hasSelectedPropValuePairs,
      browseDepth: 0,
      childContextRefs: [],
      compatibleThingRefs: [],
      childThingRefs: [],
    });
    return {
      contextRef,
      thingRef,
      fallbackTaxonRef,
      pageMode,
      browseDepth: 0,
      nextChoices: [],
      navigationItems: [],
      childThingRefinementRefs: [],
      browseSections: [],
      filterProps: [],
      autoActiveRequiredRefs: [],
      unresolvedRequiredPropRefs: [],
      selectedValuesByProp: {},
      directContextRefs: [],
      directThingRefs: [],
      relatedThingRefs: [],
      meaningfulOverlayContextRefs: [],
      autoContextRef: "",
      propNavigationRefs: [],
      showListings: pageMode === "listings",
    };
  }

  const directContextRefs = contextRef
    ? getDirectContextChildren(registry, contextRef)
        .filter(isSegmentContextRef)
        .filter((ref) =>
          thingRef
            ? thingSubtreeHasActiveContext(registry, thingRef, ref)
            : true
        )
    : [];
  const relatedThingRefs =
    contextRef && !thingRef
      ? getContextBrowseThingRefs(registry, contextRef)
      : [];
  const rawDirectThingRefs = thingRef
    ? getDirectThingChildren(registry, thingRef)
    : [];
  const autoActiveRequiredRefs = thingRef
    ? getAutoActiveRequiredRefs(registry, thingRef)
    : [];
  const autoRequiredContextRefs = autoActiveRequiredRefs.filter(isContextRef);
  const effectiveContextRef =
    contextRef ||
    (autoRequiredContextRefs.length === 1
      ? autoRequiredContextRefs[0] || ""
      : "");
  const directThingRefs = thingRef
    ? filterThingRefsForActiveContext(
        registry,
        rawDirectThingRefs,
        effectiveContextRef
      )
    : [];
  const selectedValuesByProp = thingRef
    ? selectedValuesByPropFromQuery(
        registry,
        thingRef,
        effectiveContextRef,
        selectedPropValuePairs,
        selectedValueRefs
      )
    : selectedPropValuePairsByProp(registry, selectedPropValuePairs);
  const hasSelectedPropValues = Object.values(selectedValuesByProp).some(
    (valueRefs) => valueRefs.length > 0
  );
  const unresolvedRequiredPropRefs = thingRef
    ? getUnresolvedRequiredPropRefs(
        registry,
        thingRef,
        effectiveContextRef,
        selectedValuesByProp
      )
    : [];
  const meaningfulOverlayContextRefs =
    thingRef && !effectiveContextRef && directThingRefs.length === 0
      ? getMeaningfulOverlayContexts(registry, thingRef, { contextRef })
      : [];
  const autoContextRef =
    meaningfulOverlayContextRefs.length === 1
      ? meaningfulOverlayContextRefs[0] || ""
      : "";
  const hasSelectedContext = Boolean(contextRef);
  const navigationContextRefs = thingRef ? [] : directContextRefs;
  const activeValueFilteredDirectThingRefs = thingRef
    ? directThingRefs.filter((ref) =>
        thingMatchesSelectedPropValues(
          registry,
          ref,
          effectiveContextRef,
          selectedValuesByProp
        )
      )
    : [];
  const navigationThingRefs = thingRef
    ? hasSelectedContext
      ? []
      : activeValueFilteredDirectThingRefs
    : relatedThingRefs;
  const nextChoices: TaxonomyNextChoice[] = [
    ...navigationContextRefs.map((ref) => ({ kind: "context" as const, ref })),
    ...navigationThingRefs.map((ref) => ({ kind: "thing" as const, ref })),
  ];
  const navigationItems = nextChoicesToNavigationItems(nextChoices);
  const browseSections: LegacyMarketplacePropBrowseSection[] = [];
  const filterProps = thingRef
    ? filterPropsForScope(
        registry,
        thingRef,
        effectiveContextRef,
        selectedValuesByProp
      )
    : [];
  const browseDepth = marketplaceBrowseDepth(registry, contextRef, thingRef);
  const pageMode = deriveMarketplacePageMode({
    contextRef,
    thingRef,
    explicitListings,
    hasSelectedPropValues,
    browseDepth,
    childContextRefs: directContextRefs,
    compatibleThingRefs: relatedThingRefs,
    childThingRefs: activeValueFilteredDirectThingRefs,
  });
  const showListings = pageMode === "listings";
  const childThingRefinementRefs =
    thingRef && (hasSelectedContext || pageMode === "listings")
      ? activeValueFilteredDirectThingRefs
      : [];

  return {
    contextRef,
    thingRef,
    fallbackTaxonRef,
    pageMode,
    browseDepth,
    nextChoices,
    navigationItems,
    childThingRefinementRefs,
    browseSections,
    filterProps,
    autoActiveRequiredRefs,
    unresolvedRequiredPropRefs,
    selectedValuesByProp,
    directContextRefs,
    directThingRefs,
    relatedThingRefs,
    meaningfulOverlayContextRefs,
    autoContextRef,
    propNavigationRefs: [],
    showListings,
  };
}

function selectedValuesToQueryValues(
  selectedValuesByProp: Record<string, string[]>
): string[] {
  return Object.entries(selectedValuesByProp).flatMap(
    ([propRef, valueRefs]) => {
      const normalizedPropRef = normalizeRef(propRef);
      return uniqueRefs(valueRefs.map(normalizeRef)).flatMap((valueRef) =>
        normalizedPropRef && valueRef
          ? [`${normalizedPropRef}|${valueRef}`]
          : []
      );
    }
  );
}

function hasSelectedValues(
  selectedValuesByProp: Record<string, string[]>
): boolean {
  return Object.values(selectedValuesByProp).some(
    (valueRefs) => valueRefs.length > 0
  );
}

function withListingsParam(href: string): string {
  return `${href}${href.includes("?") ? "&" : "?"}listings=1`;
}

export function buildMarketplaceNavigationHref(params: {
  registry?: TaxonomyRegistry | null;
  currentScopeState: Pick<
    MarketplaceScopeState,
    "selectedValuesByProp" | "pageMode"
  >;
  targetContextRef?: string;
  targetThingRef?: string;
  selectedValuesByProp?: Record<string, string[]>;
  listingsIntent?: boolean;
}): string {
  const selectedValuesByProp = params.selectedValuesByProp ?? {};
  if (!params.registry) {
    const fallbackHref = buildMarketplaceHref({
      contextRef: params.targetContextRef,
      thingRef: params.targetThingRef,
      selectedValuesByProp,
    });
    return params.listingsIntent
      ? withListingsParam(fallbackHref)
      : fallbackHref;
  }

  const targetScopeState = buildActiveMarketplaceState(
    {
      context: params.targetContextRef || undefined,
      thing: params.targetThingRef || undefined,
      pv: selectedValuesToQueryValues(selectedValuesByProp),
      listings: params.listingsIntent ? "1" : undefined,
    },
    params.registry
  );
  const href = buildMarketplaceHref({
    contextRef: targetScopeState.contextRef,
    thingRef: targetScopeState.thingRef,
    selectedValuesByProp: targetScopeState.selectedValuesByProp,
  });
  return params.listingsIntent ||
    hasSelectedValues(targetScopeState.selectedValuesByProp)
    ? withListingsParam(href)
    : href;
}

export function buildMarketplaceScopeFromQuery(
  query: ParsedUrlQuery,
  registry?: TaxonomyRegistry | null
): MarketplaceScopeState {
  return buildActiveMarketplaceState(query, registry);
}

function terminalReasonForTrace(scopeState: MarketplaceScopeState): string {
  if (!scopeState.showListings) {
    if (scopeState.unresolvedRequiredPropRefs.length > 0)
      return "blocked by unresolved required prop refs";
    if (scopeState.navigationItems.length > 0)
      return "browse navigation is still available";
    if (scopeState.autoContextRef) return "auto context is available";
    return "taxonomy navigation is not terminal";
  }
  if (!scopeState.thingRef && !scopeState.contextRef)
    return "broad marketplace listing surface";
  return "no child navigation or unresolved required props remain";
}

export function buildMarketplaceResolverTrace(
  query: ParsedUrlQuery,
  registry: TaxonomyRegistry | null | undefined,
  options: {
    url?: string;
    matchedListingCount?: number;
    filtersFromActualListingsOnly?: boolean;
    filterProps?: string[];
  } = {}
): MarketplaceResolverTrace {
  const fallbackTaxonRef = firstQueryValue(query.taxon);
  const contextRef =
    firstQueryValue(query.context) ||
    (isContextRef(fallbackTaxonRef) ? fallbackTaxonRef : "");
  const thingRef =
    firstQueryValue(query.thing) ||
    (isThingRef(fallbackTaxonRef) ? fallbackTaxonRef : "");
  const nodeCount = registry ? Object.keys(registry.nodeByRef).length : 0;
  const selectedContextRefs = uniqueRefs([contextRef]).filter(isContextRef);

  if (!registry) {
    return {
      url: options.url || "",
      registryLookup: {
        selectedThingExists: false,
        selectedContextRefsExist: Object.fromEntries(
          selectedContextRefs.map((ref) => [ref, false])
        ),
        nodeCount,
      },
      activeScope: {
        thingRef: thingRef || undefined,
        contextRefs: { selected: selectedContextRefs, required: [] },
        selectedValuesByProp: {},
        selectedLiteralsByProp: {},
      },
      closure: {
        thingAncestry: [],
        thingDescendants: [],
        inheritedRelations: [],
        inheritedRequiredRelations: [],
        selectedContextRelations: [],
        selectedContextRequiredRelations: [],
      },
      requirements: {
        requiredConcreteRefs: [],
        requiredPropRefs: [],
        answeredRequiredPropRefs: [],
        unresolvedRequiredPropRefs: [],
      },
      optionalChoices: {
        optionalContextRefs: [],
        optionalPropRefs: [],
        validValuesByProp: {},
      },
      browse: {
        directThingChildren: [],
        contextCompatibleThingChildren: [],
        directContextChildren: [],
        navigationItems: [],
        blockedByRequiredProps: [],
        terminal: false,
        terminalReason: "registry unavailable",
      },
      listings: {
        shouldShowListings: false,
        matchedListingCount: options.matchedListingCount || 0,
        filtersFromActualListingsOnly: Boolean(
          options.filtersFromActualListingsOnly
        ),
        filterProps: options.filterProps || [],
      },
    };
  }

  const scopeState = buildActiveMarketplaceState(query, registry);
  const selectedValuesByProp = scopeState.selectedValuesByProp;
  const thingAncestry = thingRef
    ? registry.ancestryByRef[normalizeRef(thingRef)] || [normalizeRef(thingRef)]
    : [];
  const thingDescendants = thingRef
    ? registry.descendantsByRef[normalizeRef(thingRef)] || []
    : [];
  const inheritedRelations = relationsForRefs(registry, thingAncestry);
  const inheritedRequiredRelations = requiredRelationsForRefs(
    registry,
    thingAncestry
  );
  const requiredContextRefs = uniqueRefs(
    scopeState.autoActiveRequiredRefs.filter(isContextRef)
  );
  const allSelectedContextRefs = uniqueRefs([
    ...selectedContextRefs,
    ...requiredContextRefs,
  ]);
  const selectedContextAncestry = uniqueRefs(
    allSelectedContextRefs.flatMap(
      (ref) => registry.ancestryByRef[normalizeRef(ref)] || [normalizeRef(ref)]
    )
  );
  const selectedContextRelations = relationsForRefs(
    registry,
    selectedContextAncestry
  );
  const selectedContextRequiredRelations = requiredRelationsForRefs(
    registry,
    selectedContextAncestry
  );
  const allRequiredRelations = uniqueRefs([
    ...inheritedRequiredRelations,
    ...selectedContextRequiredRelations,
  ]);
  const requiredConcreteRefs = uniqueRefs(
    allRequiredRelations.filter(isConcreteRequiredRef)
  );
  const requiredPropRefs = uniqueRefs(allRequiredRelations.filter(isPropRef));
  const answeredRequiredPropRefs = requiredPropRefs.filter(
    (propRef) => (selectedValuesByProp[normalizeRef(propRef)] || []).length > 0
  );
  const optionalContextRefs = uniqueRefs(inheritedRelations)
    .filter(isContextRef)
    .filter((ref) => !allSelectedContextRefs.includes(ref))
    .filter((ref) => !requiredConcreteRefs.includes(ref));
  const optionalPropRefs = uniqueRefs([
    ...inheritedRelations,
    ...selectedContextRelations,
  ])
    .filter(isPropRef)
    .filter((propRef) => !requiredPropRefs.includes(propRef));
  const optionState = {
    ...marketplaceTaxonomyState(registry, thingRef, "", selectedValuesByProp),
    semanticContextRefs: allSelectedContextRefs,
  };
  const resolvedOptionState = buildResolvedTaxonomyState(optionState, registry);
  const validValuesByProp = Object.fromEntries(
    optionalPropRefs
      .map(
        (propRef) =>
          [propRef, resolvedOptionState.availableValues[propRef] || []] as const
      )
      .filter(([, values]) => values.length > 0)
  );
  const directThingChildren = thingRef
    ? getDirectThingChildren(registry, thingRef)
    : [];
  const effectiveContextRef =
    scopeState.contextRef ||
    scopeState.autoContextRef ||
    requiredContextRefs[0] ||
    "";
  const contextCompatibleThingChildren = thingRef
    ? filterThingRefsForActiveContext(
        registry,
        directThingChildren,
        effectiveContextRef
      )
    : effectiveContextRef && isSegmentContextRef(effectiveContextRef)
      ? compatibleThingFrontierForSegment(registry, effectiveContextRef)
      : [];
  const directContextChildren =
    contextRef && !thingRef
      ? getDirectContextChildren(registry, contextRef).filter(
          isSegmentContextRef
        )
      : [];

  return {
    url: options.url || "",
    registryLookup: {
      selectedThingExists: Boolean(
        thingRef && registry.nodeByRef[normalizeRef(thingRef)]
      ),
      selectedContextRefsExist: Object.fromEntries(
        allSelectedContextRefs.map((ref) => [
          ref,
          Boolean(registry.nodeByRef[normalizeRef(ref)]),
        ])
      ),
      nodeCount,
    },
    activeScope: {
      thingRef: thingRef || undefined,
      contextRefs: {
        selected: selectedContextRefs,
        required: requiredContextRefs,
      },
      selectedValuesByProp,
      selectedLiteralsByProp: {},
    },
    closure: {
      thingAncestry,
      thingDescendants,
      inheritedRelations,
      inheritedRequiredRelations,
      selectedContextRelations,
      selectedContextRequiredRelations,
    },
    requirements: {
      requiredConcreteRefs,
      requiredPropRefs,
      answeredRequiredPropRefs,
      unresolvedRequiredPropRefs: scopeState.unresolvedRequiredPropRefs,
    },
    optionalChoices: {
      optionalContextRefs,
      optionalPropRefs,
      validValuesByProp,
    },
    browse: {
      directThingChildren,
      contextCompatibleThingChildren,
      directContextChildren,
      navigationItems: scopeState.navigationItems,
      blockedByRequiredProps: scopeState.unresolvedRequiredPropRefs,
      terminal: scopeState.showListings,
      terminalReason: terminalReasonForTrace(scopeState),
    },
    listings: {
      shouldShowListings: scopeState.showListings,
      matchedListingCount: options.matchedListingCount || 0,
      filtersFromActualListingsOnly: Boolean(
        options.filtersFromActualListingsOnly
      ),
      filterProps: options.filterProps || [],
    },
  };
}
