import {
  getDescendants,
  getInheritedValRefs,
  normalizeRef,
  propRoots as registryPropRoots,
  propValueType as registryPropValueType,
} from "@/utils/taxonomy/registry";
import {
  TaxonomyNode,
  TaxonomyRegistry,
  TaxonomyState,
} from "@/utils/taxonomy/types";
import {
  GENERIC_THING_REFS,
  getInheritedRequiredRelations,
  isContextRef,
  isPropRef,
  isSegmentContextRef,
  uniqueRefs,
} from "@/utils/taxonomy/graph";

function sameRefArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

const GENERIC_NARROWING_REFS = new Set([
  "thing",
  "thing:good",
  "thing:artifact",
  "thing:service",
  "thing:real_estate",
  "thing:vehicle",
  "thing:organization",
  "thing:game",
  "val",
  "val:context",
  "val:business_function",
  "prop",
]);

const propCountByRegistry = new WeakMap<TaxonomyRegistry, number>();

function registryPropCount(registry: TaxonomyRegistry): number {
  const cachedCount = propCountByRegistry.get(registry);
  if (cachedCount !== undefined) return cachedCount;
  const count = Object.keys(registry.nodeByRef).filter((ref) =>
    ref.startsWith("prop:")
  ).length;
  propCountByRegistry.set(registry, count);
  return count;
}

function isThingNode(node: TaxonomyNode | undefined): boolean {
  return Boolean(node && node.family === "thing");
}

function terminalKey(ref: string): string {
  const parts = normalizeRef(ref).split(":");
  return parts[parts.length - 1] || "";
}

function activePathSegmentRefs(
  state: Pick<TaxonomyState, "segmentRef">,
  registry: TaxonomyRegistry
): string[] {
  return uniqueRefs([state.segmentRef]).filter(
    (ref) => isSegmentContextRef(ref) && Boolean(registry.nodeByRef[ref])
  );
}

function listingSegmentRefs(
  state: Pick<TaxonomyState, "segmentRef">
): string[] {
  return uniqueRefs([state.segmentRef]).filter(isSegmentContextRef).slice(0, 1);
}

function getRelatedRefs(registry: TaxonomyRegistry, ref: string): string[] {
  return registry.relationsByRef[normalizeRef(ref)] || [];
}

function upstreamDependencyProps(
  _propRef: string,
  dependencyPropRefs: string[],
  _state: TaxonomyState,
  _registry: TaxonomyRegistry
): string[] {
  return uniqueRefs(dependencyPropRefs);
}

export type PropResolution = {
  propRef: string;
  valueRefs: string[];
  source: "user" | "scope" | "ambiguous" | "unresolved";
  resolved: boolean;
  explicit: boolean;
  ambiguous: boolean;
};

export type ResolvedTaxonomyNextChoice = {
  kind: string;
  ref?: string;
  propRef?: string;
  options?: string[];
};

export type ResolvedTaxonomyState = {
  activeScope: {
    refs: string[];
    keys: string[];
  };
  // Placeholder until core owns cross-page "what can be chosen next" output.
  // Marketplace currently derives concrete choices from the facts below.
  nextChoices: ResolvedTaxonomyNextChoice[];
  availableProps: string[];
  requiredPropRefs: string[];
  propResolutions: Record<string, PropResolution>;
  availableValues: Record<string, string[]>;
  ambiguousProps: string[];
  missingRequiredTaxonomyRefs: string[];
};

function selectedDependencyPlan(
  propRef: string,
  state: TaxonomyState,
  registry: TaxonomyRegistry
): { sourceProps: string[]; traversalProps: string[] } {
  const normalizedPropRef = normalizeRef(propRef);
  const directDependencies = upstreamDependencyProps(
    normalizedPropRef,
    propDirectDependencies(normalizedPropRef, registry),
    state,
    registry
  );
  const selectedDirectDependencies = directDependencies.filter(
    (dependencyPropRef) =>
      propValueRefsForResolution(dependencyPropRef, state, registry).length > 0
  );
  if (selectedDirectDependencies.length > 0) {
    return {
      sourceProps: selectedDirectDependencies,
      traversalProps: selectedDirectDependencies,
    };
  }

  const transitiveDependencies = upstreamDependencyProps(
    normalizedPropRef,
    propDependencies(normalizedPropRef, registry),
    state,
    registry
  );
  const selectedTransitiveDependencies = transitiveDependencies.filter(
    (dependencyPropRef) =>
      propValueRefsForResolution(dependencyPropRef, state, registry).length > 0
  );
  return {
    sourceProps: selectedTransitiveDependencies,
    traversalProps: transitiveDependencies,
  };
}

function getRelatedPropRefs(registry: TaxonomyRegistry, ref: string): string[] {
  return getRelatedRefs(registry, ref).filter((relatedRef) =>
    normalizeRef(relatedRef).startsWith("prop:")
  );
}

function inheritedRefsForRef(
  registry: TaxonomyRegistry,
  ref: string
): string[] {
  const normalizedRef = normalizeRef(ref);
  return registry.ancestryByRef[normalizedRef] || [normalizedRef];
}

function getInheritedRelatedPropRefs(
  registry: TaxonomyRegistry,
  ref: string
): string[] {
  return uniqueRefs(
    inheritedRefsForRef(registry, ref).flatMap((ancestorRef) =>
      getRelatedPropRefs(registry, ancestorRef)
    )
  );
}

function getPropChildRefs(
  registry: TaxonomyRegistry,
  propRef: string
): string[] {
  return getRelatedRefs(registry, propRef).filter((relatedRef) =>
    normalizeRef(relatedRef).startsWith("prop:")
  );
}

function getRequiredPropRefs(
  registry: TaxonomyRegistry,
  ref: string
): string[] {
  const node = registry.nodeByRef[normalizeRef(ref)];
  const requiredRelations = Array.isArray(node?.content.requiredRelations)
    ? node?.content.requiredRelations || []
    : [];
  return requiredRelations
    .map((relatedRef) => normalizeRef(relatedRef))
    .filter((relatedRef) => relatedRef.startsWith("prop:"));
}

function getInheritedRequiredPropRefs(
  registry: TaxonomyRegistry,
  ref: string
): string[] {
  return uniqueRefs(
    inheritedRefsForRef(registry, ref).flatMap((ancestorRef) =>
      getRequiredPropRefs(registry, ancestorRef)
    )
  );
}

function getPropActivationParentRefs(
  registry: TaxonomyRegistry,
  propRef: string
): string[] {
  const normalizedPropRef = normalizeRef(propRef);
  return uniqueRefs(
    (registry.reverseRefsByRef[normalizedPropRef] || [])
      .filter(
        (reverseRef) =>
          reverseRef.field === "relations" ||
          reverseRef.field === "requiredRelations"
      )
      .map((reverseRef) => normalizeRef(reverseRef.sourceRef))
      .filter((sourceRef) => registry.nodeByRef[sourceRef]?.family === "prop")
  );
}

export function propDirectDependencies(
  propRef: string,
  registry: TaxonomyRegistry
): string[] {
  const normalizedPropRef = normalizeRef(propRef);
  return uniqueRefs([
    ...(registry.propDirectDependsOnPropsByRef[normalizedPropRef] || []),
    ...getPropActivationParentRefs(registry, normalizedPropRef),
  ]);
}

export function propDependencies(
  propRef: string,
  registry: TaxonomyRegistry
): string[] {
  const normalizedPropRef = normalizeRef(propRef);
  const visited = new Set<string>();
  const queue = [...propDirectDependencies(normalizedPropRef, registry)];
  let head = 0;

  while (head < queue.length) {
    const currentPropRef = normalizeRef(queue[head++] || "");
    if (
      !currentPropRef ||
      currentPropRef === normalizedPropRef ||
      visited.has(currentPropRef)
    )
      continue;
    visited.add(currentPropRef);
    queue.push(...propDirectDependencies(currentPropRef, registry));
  }

  return Array.from(visited).sort();
}

function getRequiredRefs(registry: TaxonomyRegistry, ref: string): string[] {
  const node = registry.nodeByRef[normalizeRef(ref)];
  return Array.isArray(node?.content.requiredRelations)
    ? uniqueRefs(node?.content.requiredRelations || [])
    : [];
}

function ancestryThingRefs(
  registry: TaxonomyRegistry,
  thingRef: string | null
): string[] {
  if (!thingRef) return [];
  return (
    registry.ancestryByRef[normalizeRef(thingRef)] || [normalizeRef(thingRef)]
  )
    .filter((ref) => isThingNode(registry.nodeByRef[ref]))
    .filter((ref) => !GENERIC_THING_REFS.has(normalizeRef(ref)));
}

function activeContextRefsWithAncestry(
  state: TaxonomyState,
  registry: TaxonomyRegistry
): string[] {
  const contextRefs = uniqueRefs([
    ...activePathSegmentRefs(state, registry),
    ...semanticContexts(state, registry),
  ]);
  return uniqueRefs(
    contextRefs.flatMap(
      (ref) => registry.ancestryByRef[normalizeRef(ref)] || [normalizeRef(ref)]
    )
  ).filter(isContextRef);
}

function activeStructuralRefs(
  state: TaxonomyState,
  registry: TaxonomyRegistry
): string[] {
  return uniqueRefs([
    ...activeContextRefsWithAncestry(state, registry),
    ...thingPath(state.thingRef, registry),
  ]);
}

function activeScopeValueRefs(
  state: TaxonomyState,
  registry: TaxonomyRegistry
): string[] {
  const structuralRefs = activeStructuralRefs(state, registry);
  const structuralAncestryRefs = uniqueRefs(
    structuralRefs.flatMap(
      (ref) => registry.ancestryByRef[normalizeRef(ref)] || [normalizeRef(ref)]
    )
  );
  return uniqueRefs([
    ...structuralAncestryRefs,
    ...structuralAncestryRefs.flatMap((ref) => getRelatedRefs(registry, ref)),
    ...structuralAncestryRefs.flatMap((ref) => getRequiredRefs(registry, ref)),
    ...Object.values(state.selectedValuesByProp).flat(),
  ]).filter((ref) => !normalizeRef(ref).startsWith("prop:"));
}

function activeActivationValueRefs(
  state: TaxonomyState,
  registry: TaxonomyRegistry
): string[] {
  const structuralRefs = activeStructuralRefs(state, registry);
  const structuralAncestryRefs = uniqueRefs(
    structuralRefs.flatMap(
      (ref) => registry.ancestryByRef[normalizeRef(ref)] || [normalizeRef(ref)]
    )
  );
  return uniqueRefs([
    ...structuralAncestryRefs,
    ...structuralAncestryRefs.flatMap((ref) =>
      getRelatedRefs(registry, ref).filter(
        (relatedRef) => !isContextRef(relatedRef)
      )
    ),
    ...structuralAncestryRefs.flatMap((ref) => getRequiredRefs(registry, ref)),
    ...Object.values(state.selectedValuesByProp).flat(),
  ]).filter((ref) => !normalizeRef(ref).startsWith("prop:"));
}

function candidateRefsForPropRoots(
  propRef: string,
  registry: TaxonomyRegistry
): Set<string> {
  const refs = propRoots(propRef, registry).flatMap((rootRef) => {
    const normalizedRootRef = normalizeRef(rootRef);
    return [normalizedRootRef, ...getDescendants(registry, normalizedRootRef)];
  });
  return new Set(uniqueRefs(refs));
}

function scopeResolvedValueRefs(
  propRef: string,
  state: TaxonomyState,
  registry: TaxonomyRegistry
): string[] {
  const candidateRefs = candidateRefsForPropRoots(propRef, registry);
  if (candidateRefs.size === 0) return [];
  return uniqueRefs(
    activeScopeValueRefs(state, registry).filter((ref) =>
      candidateRefs.has(normalizeRef(ref))
    )
  );
}

export function resolvePropResolution(
  propRef: string,
  state: TaxonomyState,
  registry: TaxonomyRegistry
): PropResolution {
  const normalizedPropRef = normalizeRef(propRef);
  const userValueRefs = uniqueRefs(
    state.selectedValuesByProp[normalizedPropRef] || []
  );
  if (userValueRefs.length > 0) {
    return {
      propRef: normalizedPropRef,
      valueRefs: userValueRefs,
      source: "user",
      resolved: true,
      explicit: true,
      ambiguous: false,
    };
  }

  const scopedValueRefs = scopeResolvedValueRefs(
    normalizedPropRef,
    state,
    registry
  );
  if (scopedValueRefs.length === 1) {
    return {
      propRef: normalizedPropRef,
      valueRefs: scopedValueRefs,
      source: "scope",
      resolved: true,
      explicit: false,
      ambiguous: false,
    };
  }
  if (scopedValueRefs.length > 1) {
    return {
      propRef: normalizedPropRef,
      valueRefs: scopedValueRefs,
      source: "ambiguous",
      resolved: false,
      explicit: false,
      ambiguous: true,
    };
  }

  return {
    propRef: normalizedPropRef,
    valueRefs: [],
    source: "unresolved",
    resolved: false,
    explicit: false,
    ambiguous: false,
  };
}

function propValueRefsForResolution(
  propRef: string,
  state: TaxonomyState,
  registry: TaxonomyRegistry
): string[] {
  const resolution = resolvePropResolution(propRef, state, registry);
  return resolution.resolved ? resolution.valueRefs : [];
}

function hasAnsweredProp(
  propRef: string,
  state: TaxonomyState,
  registry: TaxonomyRegistry
): boolean {
  const normalizedPropRef = normalizeRef(propRef);
  if ((state.selectedValuesByProp[normalizedPropRef] || []).length > 0)
    return true;

  if (
    !Object.prototype.hasOwnProperty.call(
      state.selectedLiteralsByProp,
      normalizedPropRef
    )
  )
    return false;
  const literalValue = state.selectedLiteralsByProp[normalizedPropRef];
  const valueTypeRef = propValueType(normalizedPropRef, registry);

  if (valueTypeRef === "valtype:boolean") {
    return (
      literalValue === true || literalValue === "true" || literalValue === 1
    );
  }
  if (typeof literalValue === "string") return literalValue.trim().length > 0;
  if (typeof literalValue === "number") return Number.isFinite(literalValue);
  return (
    literalValue !== null &&
    literalValue !== undefined &&
    literalValue !== false
  );
}

function collectAvailableAndRequiredProps(
  basePropRefs: string[],
  baseRequiredPropRefs: string[],
  state: TaxonomyState,
  registry: TaxonomyRegistry
): {
  availableProps: string[];
  requiredProps: string[];
  valueActivatedProps: string[];
} {
  const available = new Set<string>();
  const required = new Set<string>();
  const valueActivated = new Set<string>();
  const propQueue: string[] = [];
  const valueQueue: string[] = [];
  const processedProps = new Set<string>();
  const processedValues = new Set<string>();

  const addProp = (
    propRef: string,
    isRequired = false,
    activatedByValue = false
  ) => {
    const normalizedPropRef = normalizeRef(propRef);
    if (!normalizedPropRef || !normalizedPropRef.startsWith("prop:")) return;
    if (isRequired) required.add(normalizedPropRef);
    if (activatedByValue) valueActivated.add(normalizedPropRef);
    if (available.has(normalizedPropRef)) return;
    available.add(normalizedPropRef);
    propQueue.push(normalizedPropRef);
  };

  const addValue = (ref: string) => {
    const normalizedRef = normalizeRef(ref);
    if (
      !normalizedRef ||
      normalizedRef.startsWith("prop:") ||
      processedValues.has(normalizedRef)
    )
      return;
    valueQueue.push(normalizedRef);
  };

  uniqueRefs(basePropRefs).forEach((propRef) => addProp(propRef));
  uniqueRefs(baseRequiredPropRefs).forEach((propRef) => addProp(propRef, true));
  activeActivationValueRefs(state, registry).forEach(addValue);

  let propHead = 0;
  let valueHead = 0;
  const maxSteps = Math.max(8, Object.keys(registry.nodeByRef).length * 2);
  let steps = 0;

  while (
    (propHead < propQueue.length || valueHead < valueQueue.length) &&
    steps < maxSteps
  ) {
    steps += 1;

    while (valueHead < valueQueue.length) {
      const activeRef = normalizeRef(valueQueue[valueHead++] || "");
      if (!activeRef || processedValues.has(activeRef)) continue;
      processedValues.add(activeRef);

      for (const propRef of getInheritedRelatedPropRefs(registry, activeRef))
        addProp(propRef, false, true);
      for (const propRef of getInheritedRequiredPropRefs(registry, activeRef))
        addProp(propRef, true, true);
    }

    while (propHead < propQueue.length) {
      const propRef = normalizeRef(propQueue[propHead++] || "");
      if (!propRef || processedProps.has(propRef)) continue;
      processedProps.add(propRef);

      const resolution = resolvePropResolution(propRef, state, registry);
      if (resolution.resolved) resolution.valueRefs.forEach(addValue);

      if (!hasAnsweredProp(propRef, state, registry)) continue;
      for (const childPropRef of getPropChildRefs(registry, propRef))
        addProp(childPropRef);
      for (const childPropRef of getRequiredPropRefs(registry, propRef))
        addProp(childPropRef, true);
    }
  }

  return {
    availableProps: Array.from(available),
    requiredProps: Array.from(required),
    valueActivatedProps: Array.from(valueActivated),
  };
}

function segmentMatchingThingRefs(
  segmentRefs: string[],
  registry: TaxonomyRegistry
): Set<string> {
  const normalizedSegmentRefs =
    uniqueRefs(segmentRefs).filter(isSegmentContextRef);
  if (normalizedSegmentRefs.length === 0) return new Set();
  const matches = new Set<string>();

  for (const [ref, node] of Object.entries(registry.nodeByRef)) {
    if (node.family !== "thing") continue;
    const inheritedContextSet = new Set(
      getInheritedValRefs(registry, ref).filter((relatedRef) =>
        normalizeRef(relatedRef).startsWith("val:context:")
      )
    );
    if (
      normalizedSegmentRefs.some((segmentRef) =>
        inheritedContextSet.has(segmentRef)
      )
    ) {
      for (const ancestorRef of registry.ancestryByRef[ref] || [ref]) {
        if (isThingNode(registry.nodeByRef[ancestorRef])) {
          matches.add(normalizeRef(ancestorRef));
        }
      }
    }
  }

  return matches;
}

function rootThingsFromSet(
  allowedRefs: Set<string>,
  registry: TaxonomyRegistry
): string[] {
  return Array.from(allowedRefs).filter((ref) => {
    if (GENERIC_THING_REFS.has(normalizeRef(ref))) return false;
    const parents = (
      registry.nodeByRef[normalizeRef(ref)]?.content.parents || []
    ).map(normalizeRef);
    return !parents.some(
      (parentRef) =>
        allowedRefs.has(parentRef) && !GENERIC_THING_REFS.has(parentRef)
    );
  });
}

export function segments(registry: TaxonomyRegistry): string[] {
  return (registry.childrenByRef["val:context:segment"] || [])
    .map(normalizeRef)
    .filter(isSegmentContextRef);
}

export function segmentPath(
  segmentRef: string | null,
  registry: TaxonomyRegistry
): string[] {
  if (!segmentRef) return [];
  return (
    registry.ancestryByRef[normalizeRef(segmentRef)] || [
      normalizeRef(segmentRef),
    ]
  )
    .map(normalizeRef)
    .filter(isSegmentContextRef)
    .filter((ref) => ref !== "val:context:segment");
}

export function childSegments(
  parentSegmentRef: string | null,
  registry: TaxonomyRegistry
): string[] {
  const parentRef = normalizeRef(parentSegmentRef || "val:context:segment");
  return (registry.childrenByRef[parentRef] || [])
    .map(normalizeRef)
    .filter(isSegmentContextRef);
}

export function thingPath(
  thingRef: string | null,
  registry: TaxonomyRegistry
): string[] {
  if (!thingRef) return [];
  return ancestryThingRefs(registry, thingRef);
}

export function thingsForSegment(
  state: TaxonomyState,
  registry: TaxonomyRegistry
): string[] {
  const allowedRefs = segmentMatchingThingRefs(
    activePathSegmentRefs(state, registry),
    registry
  );
  if (allowedRefs.size === 0) return [];
  return rootThingsFromSet(allowedRefs, registry);
}

export function childrenForThing(
  state: TaxonomyState,
  registry: TaxonomyRegistry
): string[] {
  const allowedRefs = segmentMatchingThingRefs(
    activePathSegmentRefs(state, registry),
    registry
  );
  const parentRef = normalizeRef(state.thingRef || "");
  if (!parentRef) return thingsForSegment(state, registry);
  return (registry.childrenByRef[parentRef] || [])
    .map(normalizeRef)
    .filter((ref) => isThingNode(registry.nodeByRef[ref]))
    .filter((ref) => !GENERIC_THING_REFS.has(ref))
    .filter((ref) => allowedRefs.size === 0 || allowedRefs.has(ref));
}

export function relatedContextOptions(
  thingRef: string | null,
  registry: TaxonomyRegistry
): string[] {
  if (!thingRef) return [];
  return uniqueRefs(
    getInheritedValRefs(registry, thingRef).filter((relatedRef) =>
      normalizeRef(relatedRef).startsWith("val:context:")
    )
  );
}

export function semanticContexts(
  state: TaxonomyState,
  registry: TaxonomyRegistry
): string[] {
  return uniqueRefs(state.semanticContextRefs).filter((ref) => {
    const node = registry.nodeByRef[ref];
    return Boolean(node && isContextRef(ref));
  });
}

export function applicableProps(
  state: TaxonomyState,
  registry: TaxonomyRegistry
): string[] {
  const refs = activeStructuralRefs(state, registry);
  const basePropRefs = uniqueRefs(
    refs.flatMap((ref) => [
      ...getRelatedPropRefs(registry, ref),
      ...getRequiredPropRefs(registry, ref),
    ])
  );
  const baseRequiredPropRefs = uniqueRefs(
    refs.flatMap((ref) => getRequiredPropRefs(registry, ref))
  );
  const collected = collectAvailableAndRequiredProps(
    basePropRefs,
    baseRequiredPropRefs,
    state,
    registry
  );
  const expandedPropRefs = collected.availableProps;
  const requiredPropRefs = new Set(collected.requiredProps);
  const valueActivatedPropRefs = new Set(collected.valueActivatedProps);

  return expandedPropRefs.filter((propRef) => {
    if (requiredPropRefs.has(propRef)) return true;
    if (valueActivatedPropRefs.has(propRef)) return true;
    const activationParentRefs = getPropActivationParentRefs(registry, propRef);
    const graphDependencyRefs = (
      registry.propDirectDependsOnPropsByRef[normalizeRef(propRef)] || []
    ).map(normalizeRef);
    if (activationParentRefs.length > 0) {
      return (
        activationParentRefs.some((dependencyPropRef) =>
          hasAnsweredProp(dependencyPropRef, state, registry)
        ) &&
        graphDependencyRefs.every((dependencyPropRef) =>
          hasAnsweredProp(dependencyPropRef, state, registry)
        )
      );
    }
    if (graphDependencyRefs.length === 0) return true;
    return graphDependencyRefs.every((dependencyPropRef) =>
      hasAnsweredProp(dependencyPropRef, state, registry)
    );
  });
}

export function requiredProps(
  state: TaxonomyState,
  registry: TaxonomyRegistry
): string[] {
  const refs = activeStructuralRefs(state, registry);
  const basePropRefs = uniqueRefs(
    refs.flatMap((ref) => [
      ...getRelatedPropRefs(registry, ref),
      ...getRequiredPropRefs(registry, ref),
    ])
  );
  const baseRequiredPropRefs = uniqueRefs(
    refs.flatMap((ref) => getRequiredPropRefs(registry, ref))
  );
  return collectAvailableAndRequiredProps(
    basePropRefs,
    baseRequiredPropRefs,
    state,
    registry
  ).requiredProps;
}

export function propRoots(
  propRef: string,
  registry: TaxonomyRegistry
): string[] {
  return registryPropRoots(registry, propRef).filter(
    (ref) => !normalizeRef(ref).startsWith("prop:")
  );
}

export function propValueType(
  propRef: string,
  registry: TaxonomyRegistry
): string | undefined {
  return registryPropValueType(registry, propRef);
}

export function activeScopeKeys(
  state: TaxonomyState,
  registry: TaxonomyRegistry
): string[] {
  const refs: string[] = [];
  const ancestryRefs = ancestryThingRefs(registry, state.thingRef)
    .slice()
    .reverse();

  refs.push(...ancestryRefs);
  for (const ref of ancestryRefs) {
    refs.push(...getRelatedRefs(registry, ref));
    refs.push(...getRequiredRefs(registry, ref));
  }

  refs.push(...activeContextRefsWithAncestry(state, registry));
  refs.push(...Object.values(state.selectedValuesByProp).flat());

  return uniqueRefs(refs)
    .filter((ref) => !ref.startsWith("prop:"))
    .map(terminalKey)
    .filter(Boolean);
}

export function genericRootOptions(
  rootRef: string,
  registry: TaxonomyRegistry
): string[] {
  const normalizedRootRef = normalizeRef(rootRef);
  const children = (registry.childrenByRef[normalizedRootRef] || []).map(
    normalizeRef
  );
  if (children.length === 0) return [normalizedRootRef];

  const leafChildren = children.filter(
    (childRef) => (registry.childrenByRef[childRef] || []).length === 0
  );
  if (leafChildren.length > 0) return leafChildren;

  return uniqueRefs(
    children.flatMap((childRef) => genericRootOptions(childRef, registry))
  );
}

export function resolvedNarrowingRefs(
  propRef: string,
  state: TaxonomyState,
  registry: TaxonomyRegistry
): string[] {
  const normalizedPropRef = normalizeRef(propRef);
  const dependencyPlan = selectedDependencyPlan(
    normalizedPropRef,
    state,
    registry
  );
  if (dependencyPlan.sourceProps.length === 0) return [];

  const allowedTargets = new Set(
    registry.propSelectableCandidateRefsByRef[normalizedPropRef] || []
  );
  if (allowedTargets.size === 0) return [];
  const traversalRefs = new Set<string>(allowedTargets);
  for (const sourcePropRef of dependencyPlan.traversalProps) {
    for (const candidateRef of registry.propSelectableCandidateRefsByRef[
      normalizeRef(sourcePropRef)
    ] || []) {
      traversalRefs.add(candidateRef);
    }
  }

  const selectedValues = uniqueRefs(
    dependencyPlan.sourceProps.flatMap((sourcePropRef) =>
      propValueRefsForResolution(sourcePropRef, state, registry)
    )
  ).filter((ref) => !GENERIC_NARROWING_REFS.has(ref));

  if (selectedValues.length === 0) return [];

  const queue = [...selectedValues];
  const visited = new Set<string>();
  const resolved: string[] = [];
  let head = 0;

  while (head < queue.length) {
    const currentRef = normalizeRef(queue[head++] || "");
    if (
      !currentRef ||
      visited.has(currentRef) ||
      currentRef.startsWith("prop:")
    )
      continue;
    visited.add(currentRef);
    if (allowedTargets.has(currentRef)) resolved.push(currentRef);

    const nextRefs = uniqueRefs([
      ...getRelatedRefs(registry, currentRef),
      ...(registry.reverseRefsByRef[currentRef] || [])
        .filter((reverseRef) => reverseRef.field === "relations")
        .map((reverseRef) => normalizeRef(reverseRef.sourceRef)),
    ]).filter(
      (relatedRef) =>
        traversalRefs.has(relatedRef) && !GENERIC_NARROWING_REFS.has(relatedRef)
    );

    queue.push(...nextRefs);
  }

  return uniqueRefs(resolved);
}

export function matchesNarrowingSet(
  candidateRef: string,
  narrowingRefs: string[],
  registry: TaxonomyRegistry
): boolean {
  const normalizedCandidateRef = normalizeRef(candidateRef);
  if (narrowingRefs.length === 0) return false;
  const candidateRelations =
    registry.relationSetByRef[normalizedCandidateRef] || {};
  const candidateReverseRelationSources = new Set(
    (registry.reverseRefsByRef[normalizedCandidateRef] || [])
      .filter((reverseRef) => reverseRef.field === "relations")
      .map((reverseRef) => normalizeRef(reverseRef.sourceRef))
  );

  return narrowingRefs.some((narrowingRef) => {
    const normalizedNarrowingRef = normalizeRef(narrowingRef);
    const narrowingRelations =
      registry.relationSetByRef[normalizedNarrowingRef] || {};
    return (
      normalizedCandidateRef === normalizedNarrowingRef ||
      Boolean(candidateRelations[normalizedNarrowingRef]) ||
      Boolean(narrowingRelations[normalizedCandidateRef]) ||
      candidateReverseRelationSources.has(normalizedNarrowingRef) ||
      (registry.reverseRefsByRef[normalizedNarrowingRef] || []).some(
        (reverseRef) =>
          reverseRef.field === "relations" &&
          normalizeRef(reverseRef.sourceRef) === normalizedCandidateRef
      )
    );
  });
}

export function propOptions(
  propRef: string,
  state: TaxonomyState,
  registry: TaxonomyRegistry
): string[] {
  return resolvePropOptions(propRef, state, registry);
}

export function resolvePropOptions(
  propRef: string,
  state: TaxonomyState,
  registry: TaxonomyRegistry
): string[] {
  return resolveOptionsForProp(
    propRef,
    activeScopeKeys(state, registry),
    state.selectedValuesByProp,
    registry,
    state
  );
}

export function buildResolvedTaxonomyState(
  state: TaxonomyState,
  registry: TaxonomyRegistry
): ResolvedTaxonomyState {
  const availableProps = propOrder(
    applicableProps(state, registry),
    state,
    registry
  );
  const requiredPropRefs = requiredProps(state, registry).map(normalizeRef);
  const scopeKeys = activeScopeKeys(state, registry);
  const propResolutions = Object.fromEntries(
    uniqueRefs([...availableProps, ...requiredPropRefs]).map((propRef) => [
      propRef,
      resolvePropResolution(propRef, state, registry),
    ])
  ) as Record<string, PropResolution>;
  const availableValues = Object.fromEntries(
    availableProps.map((propRef) => [
      propRef,
      resolveOptionsForProp(
        propRef,
        scopeKeys,
        state.selectedValuesByProp,
        registry,
        state
      ),
    ])
  ) as Record<string, string[]>;
  const ambiguousProps = Object.values(propResolutions)
    .filter((resolution) => resolution.ambiguous)
    .map((resolution) => resolution.propRef);
  const missingRequiredTaxonomyRefs = requiredPropRefs.filter(
    (propRef) => !propResolutions[propRef]?.resolved
  );

  return {
    activeScope: {
      refs: activeScopeValueRefs(state, registry),
      keys: scopeKeys,
    },
    // Placeholder only: marketplace currently builds concrete next choices in
    // its adapter from these resolver facts. Keep UI policy/layout out of core.
    nextChoices: [],
    availableProps,
    requiredPropRefs,
    propResolutions,
    availableValues,
    ambiguousProps,
    missingRequiredTaxonomyRefs,
  };
}

export function contextChangesResolvedTaxonomyState(
  registry: TaxonomyRegistry,
  baseState: TaxonomyState,
  contextRef: string,
  baseResolvedState?: ResolvedTaxonomyState
): boolean {
  const normalizedContextRef = normalizeRef(contextRef);
  if (!normalizedContextRef) return false;

  const scopedState: TaxonomyState = {
    ...baseState,
    semanticContextRefs: uniqueRefs([
      ...baseState.semanticContextRefs,
      normalizedContextRef,
    ]),
  };
  const baseResolved =
    baseResolvedState || buildResolvedTaxonomyState(baseState, registry);
  const scopedResolved = buildResolvedTaxonomyState(scopedState, registry);

  const baseProps = new Set(baseResolved.availableProps.map(normalizeRef));
  const contextAncestryRefs = registry.ancestryByRef[normalizedContextRef] || [
    normalizedContextRef,
  ];
  const scopedProps = uniqueRefs([
    ...scopedResolved.availableProps,
    ...contextAncestryRefs.flatMap((ref) =>
      (registry.relationsByRef[normalizeRef(ref)] || []).filter(isPropRef)
    ),
  ]);
  if (scopedProps.some((propRef) => !baseProps.has(propRef))) return true;

  const baseRequired = new Set(
    baseState.thingRef
      ? getInheritedRequiredRelations(registry, baseState.thingRef).map(
          normalizeRef
        )
      : []
  );
  const contextRequired = uniqueRefs(
    contextAncestryRefs.flatMap((ref) => {
      const requiredRelations =
        registry.nodeByRef[normalizeRef(ref)]?.content.requiredRelations;
      return Array.isArray(requiredRelations) ? requiredRelations : [];
    })
  );
  return contextRequired.some((ref) => !baseRequired.has(ref));
}

export function resolveSelectedValuesFromRefs(params: {
  registry: TaxonomyRegistry;
  state: TaxonomyState;
  selectedPropValuePairs: Array<{ propRef: string; valueRef: string }>;
  legacyValueRefs?: string[];
  getLegacyCandidatePropRefs?: (
    selectedValuesByProp: Record<string, string[]>
  ) => string[];
}): Record<string, string[]> {
  const {
    registry,
    state,
    selectedPropValuePairs,
    legacyValueRefs = [],
  } = params;
  if (selectedPropValuePairs.length === 0 && legacyValueRefs.length === 0)
    return {};

  const result: Record<string, string[]> = {};
  const applicablePropRefs = new Set(
    buildResolvedTaxonomyState(state, registry).availableProps.map(normalizeRef)
  );
  for (const { propRef, valueRef } of selectedPropValuePairs) {
    const normalizedPropRef = normalizeRef(propRef);
    const normalizedValueRef = normalizeRef(valueRef);
    if (!applicablePropRefs.has(normalizedPropRef)) continue;
    const selectedValuesExcludingCurrentProp = Object.fromEntries(
      Object.entries(result).filter(
        ([currentPropRef]) => normalizeRef(currentPropRef) !== normalizedPropRef
      )
    );
    const currentState = {
      ...state,
      selectedValuesByProp: selectedValuesExcludingCurrentProp,
    };
    const validOptions = new Set(
      (
        buildResolvedTaxonomyState(currentState, registry).availableValues[
          normalizedPropRef
        ] || []
      ).map(normalizeRef)
    );
    if (!validOptions.has(normalizedValueRef)) continue;
    result[normalizedPropRef] = uniqueRefs([
      ...(result[normalizedPropRef] || []),
      normalizedValueRef,
    ]);
  }

  for (const legacyValueRef of legacyValueRefs.map(normalizeRef)) {
    const currentState = { ...state, selectedValuesByProp: result };
    const currentResolvedState = buildResolvedTaxonomyState(
      currentState,
      registry
    );
    const legacyCandidatePropRefs = params.getLegacyCandidatePropRefs
      ? params.getLegacyCandidatePropRefs(result)
      : currentResolvedState.missingRequiredTaxonomyRefs;
    const matchingPropRefs = legacyCandidatePropRefs.filter((propRef) => {
      return (currentResolvedState.availableValues[propRef] || [])
        .map(normalizeRef)
        .includes(legacyValueRef);
    });
    if (matchingPropRefs.length === 1) {
      const propRef = matchingPropRefs[0]!;
      result[propRef] = uniqueRefs([
        ...(result[propRef] || []),
        legacyValueRef,
      ]);
    }
  }

  return result;
}

export function resolveOptionsForProp(
  propRef: string,
  scopeKeys: string[],
  selectedValuesByProp: Record<string, string[]>,
  registry: TaxonomyRegistry,
  dependencyState?: TaxonomyState
): string[] {
  const normalizedPropRef = normalizeRef(propRef);
  const roots = propRoots(normalizedPropRef, registry);
  if (roots.length === 0) return [];

  const activeKeyList = [...new Set(scopeKeys.filter(Boolean))];
  const candidateRefs = uniqueRefs(
    roots.flatMap((rootRef) => {
      const normalizedRootRef = normalizeRef(rootRef);
      const rootNode = registry.nodeByRef[normalizedRootRef];
      if (!rootNode) return [];

      const directChildren = (
        registry.childrenByRef[normalizedRootRef] || []
      ).map(normalizeRef);
      if (directChildren.length > 0 && activeKeyList.length > 0) {
        // Deterministic naming convention, not schema metadata:
        // a broad authored root like val:condition may narrow to an existing
        // branch whose terminal key exactly matches an active graph terminal key,
        // e.g. val:context:segment:collectible_cards -> val:condition:collectible_cards.
        const narrowedRoots = activeKeyList
          .map((key) => `${normalizedRootRef}:${key}`)
          .filter((candidateRootRef) => registry.nodeByRef[candidateRootRef]);
        if (narrowedRoots.length > 0) {
          return uniqueRefs(
            narrowedRoots.flatMap((branchRef) => {
              const descendants = getDescendants(registry, branchRef);
              return descendants.length > 0 ? descendants : [branchRef];
            })
          );
        }
      }

      const descendants = getDescendants(registry, normalizedRootRef);
      if (descendants.length === 0) return [normalizedRootRef];
      return rootNode.family === "val"
        ? genericRootOptions(normalizedRootRef, registry)
        : descendants;
    })
  );

  const dependencyContext = dependencyState || {
    segmentRef: null,
    thingRef: null,
    thingPath: [],
    semanticContextRefs: [],
    selectedValuesByProp,
    selectedLiteralsByProp: {},
    quarantinedLegacyRefs: [],
  };
  const dependencyPlan = selectedDependencyPlan(
    normalizedPropRef,
    dependencyContext,
    registry
  );
  const hasDependencyGraph =
    propDependencies(normalizedPropRef, registry).length > 0;
  const selectedDependencyRefs = uniqueRefs(
    dependencyPlan.sourceProps.flatMap((dependencyPropRef) =>
      propValueRefsForResolution(dependencyPropRef, dependencyContext, registry)
    )
  );

  if (!hasDependencyGraph || selectedDependencyRefs.length === 0) {
    return uniqueRefs(candidateRefs).sort((a, b) => a.localeCompare(b));
  }

  const narrowingRefs = resolvedNarrowingRefs(
    normalizedPropRef,
    dependencyContext,
    registry
  );
  if (narrowingRefs.length === 0) {
    return [];
  }
  const filteredRefs = candidateRefs.filter((candidateRef) =>
    matchesNarrowingSet(candidateRef, narrowingRefs, registry)
  );

  return uniqueRefs(filteredRefs).sort((a, b) => a.localeCompare(b));
}

export function propOrder(
  propRefs: string[],
  _state: TaxonomyState,
  registry: TaxonomyRegistry
): string[] {
  const normalizedPropRefs = uniqueRefs(propRefs);
  const inputIndexByRef = new Map(
    normalizedPropRefs.map((propRef, index) => [propRef, index])
  );
  const propSet = new Set(normalizedPropRefs);
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const ordered: string[] = [];

  const visit = (propRef: string) => {
    const normalizedPropRef = normalizeRef(propRef);
    if (visited.has(normalizedPropRef) || !propSet.has(normalizedPropRef))
      return;
    if (visiting.has(normalizedPropRef)) return;
    visiting.add(normalizedPropRef);

    const dependencyRefs = propDependencies(normalizedPropRef, registry)
      .map(normalizeRef)
      .filter((dependencyPropRef) => propSet.has(dependencyPropRef))
      .sort(
        (a, b) => (inputIndexByRef.get(a) ?? 0) - (inputIndexByRef.get(b) ?? 0)
      );
    for (const dependencyPropRef of dependencyRefs) visit(dependencyPropRef);

    visiting.delete(normalizedPropRef);
    visited.add(normalizedPropRef);
    ordered.push(normalizedPropRef);
  };

  for (const propRef of normalizedPropRefs) visit(propRef);
  return ordered;
}

export type PropRenderNode = {
  propRef: string;
  children: PropRenderNode[];
};

export function buildPropRenderTree(
  propRefs: string[],
  registry: TaxonomyRegistry,
  state?: TaxonomyState
): PropRenderNode[] {
  const orderedPropRefs = uniqueRefs(propRefs).map(normalizeRef);
  const propSet = new Set(orderedPropRefs);
  const assigned = new Set<string>();
  const childRefsByParent = new Map(
    orderedPropRefs.map((propRef) => [
      propRef,
      getPropChildRefs(registry, propRef).filter((childRef) =>
        propSet.has(childRef)
      ),
    ])
  );
  if (state) {
    for (const parentPropRef of orderedPropRefs) {
      const valueTriggeredChildRefs = uniqueRefs(
        propValueRefsForResolution(parentPropRef, state, registry).flatMap(
          (valueRef) => [
            ...getInheritedRelatedPropRefs(registry, valueRef),
            ...getInheritedRequiredPropRefs(registry, valueRef),
          ]
        )
      ).filter(
        (childRef) => propSet.has(childRef) && childRef !== parentPropRef
      );
      if (valueTriggeredChildRefs.length === 0) continue;
      childRefsByParent.set(
        parentPropRef,
        uniqueRefs([
          ...(childRefsByParent.get(parentPropRef) || []),
          ...valueTriggeredChildRefs,
        ])
      );
    }
  }
  const childRefs = new Set(Array.from(childRefsByParent.values()).flat());
  const rootPropRefs = orderedPropRefs.filter(
    (propRef) => !childRefs.has(propRef)
  );

  const buildNode = (
    propRef: string,
    path: Set<string>
  ): PropRenderNode | null => {
    const normalizedPropRef = normalizeRef(propRef);
    if (
      !propSet.has(normalizedPropRef) ||
      assigned.has(normalizedPropRef) ||
      path.has(normalizedPropRef)
    )
      return null;
    assigned.add(normalizedPropRef);
    const nextPath = new Set(path);
    nextPath.add(normalizedPropRef);
    return {
      propRef: normalizedPropRef,
      children: (childRefsByParent.get(normalizedPropRef) || [])
        .map((childRef) => buildNode(childRef, nextPath))
        .filter((node): node is PropRenderNode => Boolean(node)),
    };
  };

  const roots = rootPropRefs
    .map((propRef) => buildNode(propRef, new Set()))
    .filter((node): node is PropRenderNode => Boolean(node));
  const fallbackRoots = orderedPropRefs
    .filter((propRef) => !assigned.has(propRef))
    .map((propRef) => buildNode(propRef, new Set()))
    .filter((node): node is PropRenderNode => Boolean(node));

  return [...roots, ...fallbackRoots];
}

function propsWithDependencies(
  propRefs: string[],
  registry: TaxonomyRegistry
): string[] {
  return uniqueRefs([
    ...propRefs,
    ...propRefs.flatMap((propRef) => propDependencies(propRef, registry)),
  ]);
}

export function reconcileTaxonomyState(
  state: TaxonomyState,
  registry: TaxonomyRegistry
): TaxonomyState {
  const initialApplicablePropRefs = new Set(
    applicableProps(state, registry).map(normalizeRef)
  );
  // Keep selected upstream dependency props while downstream applicable props are
  // being validated. This lets selecting a sport keep narrowing league/team,
  // while removing the category/thing still clears the whole dependency chain.
  const initialRetainedPropRefs = new Set(
    propsWithDependencies(Array.from(initialApplicablePropRefs), registry)
  );
  const nextSelectedValuesByProp = Object.fromEntries(
    Object.entries(state.selectedValuesByProp)
      .map(
        ([propRef, valueRefs]) =>
          [normalizeRef(propRef), uniqueRefs(valueRefs || [])] as const
      )
      .filter(([propRef]) => initialRetainedPropRefs.has(propRef))
  ) as Record<string, string[]>;
  const nextSelectedLiteralsByProp = Object.fromEntries(
    Object.entries(state.selectedLiteralsByProp)
      .map(([propRef, value]) => [normalizeRef(propRef), value] as const)
      .filter(([propRef]) => initialRetainedPropRefs.has(propRef))
  ) as Record<string, unknown>;

  let workingState: TaxonomyState = {
    ...state,
    selectedValuesByProp: nextSelectedValuesByProp,
    selectedLiteralsByProp: nextSelectedLiteralsByProp,
  };

  const maxPasses = Math.max(4, registryPropCount(registry));
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const applicablePropRefs = applicableProps(workingState, registry).map(
      normalizeRef
    );
    const retainedPropRefs = propsWithDependencies(
      applicablePropRefs,
      registry
    );
    const retainedSet = new Set(retainedPropRefs);
    const orderedPropRefs = propOrder(retainedPropRefs, workingState, registry);

    let changed = false;
    const prunedSelectedValuesByProp: Record<string, string[]> = {};
    const prunedSelectedLiteralsByProp: Record<string, unknown> = {};

    for (const [propRef, valueRefs] of Object.entries(
      workingState.selectedValuesByProp
    )) {
      if (!retainedSet.has(normalizeRef(propRef))) {
        changed = true;
        continue;
      }
      prunedSelectedValuesByProp[normalizeRef(propRef)] = uniqueRefs(
        valueRefs || []
      );
    }

    for (const [propRef, literalValue] of Object.entries(
      workingState.selectedLiteralsByProp
    )) {
      if (!retainedSet.has(normalizeRef(propRef))) {
        changed = true;
        continue;
      }
      prunedSelectedLiteralsByProp[normalizeRef(propRef)] = literalValue;
    }

    let nextState: TaxonomyState = {
      ...workingState,
      selectedValuesByProp: prunedSelectedValuesByProp,
      selectedLiteralsByProp: prunedSelectedLiteralsByProp,
    };

    for (const propRef of orderedPropRefs) {
      const selectedValues = nextState.selectedValuesByProp[propRef] || [];
      if (selectedValues.length === 0) continue;

      const directDependencies = upstreamDependencyProps(
        propRef,
        propDirectDependencies(propRef, registry),
        nextState,
        registry
      );
      if (
        directDependencies.length > 0 &&
        !directDependencies.some(
          (dependencyPropRef) =>
            hasAnsweredProp(dependencyPropRef, nextState, registry) ||
            propValueRefsForResolution(dependencyPropRef, nextState, registry)
              .length > 0
        )
      ) {
        changed = true;
        const { [propRef]: _, ...rest } = nextState.selectedValuesByProp;
        nextState = {
          ...nextState,
          selectedValuesByProp: rest,
        };
        continue;
      }

      const validOptions = new Set(
        propOptions(propRef, nextState, registry).map(normalizeRef)
      );
      const nextSelectedValues = selectedValues.filter((valueRef) =>
        validOptions.has(normalizeRef(valueRef))
      );
      if (sameRefArray(selectedValues, nextSelectedValues)) continue;

      changed = true;
      if (nextSelectedValues.length === 0) {
        const { [propRef]: _, ...rest } = nextState.selectedValuesByProp;
        nextState = {
          ...nextState,
          selectedValuesByProp: rest,
        };
      } else {
        nextState = {
          ...nextState,
          selectedValuesByProp: {
            ...nextState.selectedValuesByProp,
            [propRef]: nextSelectedValues,
          },
        };
      }
    }

    if (!changed) return nextState;
    workingState = nextState;
  }

  return workingState;
}

export function decodeListingOverlayRefs(
  refs: string[],
  registry: TaxonomyRegistry
): TaxonomyState {
  // This decodes only overlay refs persisted on a listing. Primary thing refs,
  // prop ref assertions, and literal assertions are encoded separately and are
  // intentionally not reconstructed here.
  const normalizedRefs = uniqueRefs(refs);
  const liveContextRefs = normalizedRefs.filter(
    (ref) => isContextRef(ref) && Boolean(registry.nodeByRef[ref])
  );
  const segmentRef = liveContextRefs.find(isSegmentContextRef) || null;
  const selectedContextRefs = liveContextRefs.filter(
    (ref) => !isSegmentContextRef(ref)
  );
  const activeContextRefs = new Set(
    uniqueRefs([segmentRef, ...selectedContextRefs])
  );
  const quarantinedLegacyRefs = normalizedRefs.filter(
    (ref) => !activeContextRefs.has(ref)
  );

  return {
    segmentRef,
    thingRef: null,
    thingPath: [],
    semanticContextRefs: selectedContextRefs,
    selectedValuesByProp: {},
    selectedLiteralsByProp: {},
    quarantinedLegacyRefs,
  };
}

export const decodeListingRefs = decodeListingOverlayRefs;

export function listingOverlayRefs(state: TaxonomyState): string[] {
  // Ref and literal prop assertions are encoded separately. This list is only overlay refs saved on the listing.
  return uniqueRefs([
    ...listingSegmentRefs(state),
    ...state.semanticContextRefs,
    ...state.quarantinedLegacyRefs,
  ]);
}

export const listingRefs = listingOverlayRefs;
