import {
  getInheritedValRefs,
  isSameOrDescendant,
  normalizeRef,
} from "@/utils/taxonomy/registry";
import { TaxonomyRegistry } from "@/utils/taxonomy/types";

export function uniqueRefs(refs: Array<string | null | undefined>): string[] {
  return [
    ...new Set(refs.map((ref) => normalizeRef(ref || "")).filter(Boolean)),
  ];
}

export const GENERIC_THING_REFS = new Set([
  "thing",
  "thing:good",
  "thing:artifact",
  "thing:service",
  "thing:real_estate",
  "thing:vehicle",
  "thing:organization",
  "thing:game",
]);

export function isContextRef(ref: string): boolean {
  return normalizeRef(ref).startsWith("val:context:");
}

export function isSegmentContextRef(ref: string): boolean {
  return normalizeRef(ref).startsWith("val:context:segment:");
}

export function isThingRef(ref: string): boolean {
  return normalizeRef(ref).startsWith("thing:");
}

export function isPropRef(ref: string): boolean {
  return normalizeRef(ref).startsWith("prop:");
}

export function getDirectChildren(
  registry: TaxonomyRegistry,
  ref: string
): string[] {
  return (registry.childrenByRef[normalizeRef(ref)] || [])
    .map(normalizeRef)
    .filter((childRef) => Boolean(registry.nodeByRef[childRef]));
}

export function getDirectThingChildren(
  registry: TaxonomyRegistry,
  thingRef: string
): string[] {
  return getDirectChildren(registry, thingRef).filter(
    (ref) => registry.nodeByRef[ref]?.family === "thing"
  );
}

export function getDirectContextChildren(
  registry: TaxonomyRegistry,
  contextRef: string
): string[] {
  return getDirectChildren(registry, contextRef).filter(isContextRef);
}

export function getInheritedRequiredRelations(
  registry: TaxonomyRegistry,
  ref: string
): string[] {
  const normalizedRef = normalizeRef(ref);
  const ancestryRefs = registry.ancestryByRef[normalizedRef] || [normalizedRef];
  return uniqueRefs(
    ancestryRefs.flatMap((ancestorRef) => {
      const requiredRelations =
        registry.nodeByRef[ancestorRef]?.content.requiredRelations;
      return Array.isArray(requiredRelations) ? requiredRelations : [];
    })
  );
}

export function getAutoActiveRequiredRefs(
  registry: TaxonomyRegistry,
  thingRef: string
): string[] {
  return getInheritedRequiredRelations(registry, thingRef).filter(
    (ref) => !isPropRef(ref)
  );
}

export function inheritedContextRefs(
  registry: TaxonomyRegistry,
  thingRef: string
): string[] {
  return uniqueRefs([
    ...getInheritedValRefs(registry, thingRef).filter(isContextRef),
    ...getInheritedRequiredRelations(registry, thingRef).filter(isContextRef),
  ]);
}

export function relationMatchesActiveContext(
  registry: TaxonomyRegistry,
  relationRef: string,
  activeContextRef: string
): boolean {
  const normalizedRelationRef = normalizeRef(relationRef);
  const normalizedActiveContextRef = normalizeRef(activeContextRef);
  return (
    normalizedRelationRef === normalizedActiveContextRef ||
    isSameOrDescendant(
      registry,
      normalizedRelationRef,
      normalizedActiveContextRef
    )
  );
}

export function thingHasActiveContext(
  registry: TaxonomyRegistry,
  thingRef: string,
  activeContextRef: string
): boolean {
  if (!activeContextRef) return true;
  return inheritedContextRefs(registry, thingRef).some((contextRef) =>
    relationMatchesActiveContext(registry, contextRef, activeContextRef)
  );
}

export function thingSubtreeHasActiveContext(
  registry: TaxonomyRegistry,
  thingRef: string,
  activeContextRef: string
): boolean {
  if (!activeContextRef) return true;
  const normalizedThingRef = normalizeRef(thingRef);
  const descendantRefs = Object.keys(
    registry.descendantSetByRef[normalizedThingRef] || {}
  );
  const candidateRefs = uniqueRefs([
    normalizedThingRef,
    ...descendantRefs,
  ]).filter((ref) => registry.nodeByRef[ref]?.family === "thing");
  return candidateRefs.some((candidateRef) =>
    thingHasActiveContext(registry, candidateRef, activeContextRef)
  );
}

export function filterThingRefsForActiveContext(
  registry: TaxonomyRegistry,
  refs: string[],
  activeContextRef: string
): string[] {
  const normalizedActiveContextRef = normalizeRef(activeContextRef);
  if (!normalizedActiveContextRef) return uniqueRefs(refs);
  return uniqueRefs(refs).filter((ref) =>
    thingSubtreeHasActiveContext(registry, ref, normalizedActiveContextRef)
  );
}

export function compatibleThingFrontierForSegment(
  registry: TaxonomyRegistry,
  segmentRef: string
): string[] {
  const normalizedSegmentRef = normalizeRef(segmentRef);
  if (!isSegmentContextRef(normalizedSegmentRef)) return [];

  const compatibleThingRefs = new Set(
    (registry.thingsBySegmentRef[normalizedSegmentRef] || [])
      .map(normalizeRef)
      .filter((ref) => !GENERIC_THING_REFS.has(ref))
  );

  return Array.from(compatibleThingRefs).filter((ref) => {
    const parents = (registry.nodeByRef[ref]?.content.parents || []).map(
      normalizeRef
    );
    return !parents.some(
      (parentRef) =>
        compatibleThingRefs.has(parentRef) && !GENERIC_THING_REFS.has(parentRef)
    );
  });
}

export function relationsForRefs(
  registry: TaxonomyRegistry,
  refs: string[]
): string[] {
  return uniqueRefs(
    refs.flatMap((ref) => registry.relationsByRef[normalizeRef(ref)] || [])
  );
}

export function requiredRelationsForRefs(
  registry: TaxonomyRegistry,
  refs: string[]
): string[] {
  return uniqueRefs(
    refs.flatMap((ref) => {
      const requiredRelations =
        registry.nodeByRef[normalizeRef(ref)]?.content.requiredRelations;
      return Array.isArray(requiredRelations) ? requiredRelations : [];
    })
  );
}
