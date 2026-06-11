import {
  ProductTaxonomy,
  ReverseRef,
  TaxonomyFamily,
  TaxonomyNode,
  TaxonomyNodeContent,
  TaxonomyRegistry,
  TaxonomyValueResolutionInput,
} from "@/utils/taxonomy/types";
import { NostrEvent } from "@/utils/types/types";

function isFamily(value: string): value is TaxonomyFamily {
  return (
    value === "thing" ||
    value === "prop" ||
    value === "val" ||
    value === "valtype"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeRef(ref: string): string {
  if (!ref) return ref;
  const parts = ref.split(":");
  if (parts.length >= 3 && parts[0] === "30078") {
    return parts.slice(2).join(":");
  }
  return ref;
}

export function getTerminalKey(ref: string): string {
  const normalized = normalizeRef(ref);
  const parts = normalized.split(":");
  return parts[parts.length - 1] || normalized;
}

function getPathSegments(ref: string): string[] {
  return normalizeRef(ref).split(":");
}

function pathOverlapScore(a: string, b: string): number {
  const aSegs = new Set(getPathSegments(a));
  const bSegs = getPathSegments(b);
  return bSegs.reduce((score, seg) => score + (aSegs.has(seg) ? 1 : 0), 0);
}

function parseNodeContent(rawContent: unknown): TaxonomyNodeContent {
  if (typeof rawContent === "string") {
    try {
      const parsed = JSON.parse(rawContent) as unknown;
      if (isRecord(parsed)) return parsed as TaxonomyNodeContent;
      return {};
    } catch {
      return {};
    }
  }
  if (isRecord(rawContent)) return rawContent as TaxonomyNodeContent;
  return {};
}

function getDTag(tags: string[][]): string | undefined {
  return tags.find((tag) => tag[0] === "d")?.[1];
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map(normalizeRef);
}

function getParents(content: TaxonomyNodeContent): string[] {
  return getStringArray(content.parents);
}

function getAuthoredRelations(content: TaxonomyNodeContent): string[] {
  return unique(getStringArray(content.relations));
}

function getRequiredRelations(content: TaxonomyNodeContent): string[] {
  return getStringArray(content.requiredRelations);
}

function toTaxonomyNode(event: NostrEvent): TaxonomyNode | null {
  const d = getDTag(event.tags || []);
  if (!d) return null;
  const family = d.split(":", 1)[0] || "";
  if (!isFamily(family)) return null;
  const content = parseNodeContent(event.content);
  return {
    ...event,
    d,
    family,
    coordinate: `30078:${event.pubkey}:${d}`,
    content,
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isNewerTaxonomyEvent(
  candidate: Pick<NostrEvent, "created_at" | "id">,
  existing: Pick<NostrEvent, "created_at" | "id"> | undefined
): boolean {
  if (!existing) return true;
  if (candidate.created_at !== existing.created_at)
    return candidate.created_at > existing.created_at;
  return String(candidate.id || "") > String(existing.id || "");
}

function buildChildrenByRef(
  nodeByRef: Record<string, TaxonomyNode>
): Record<string, string[]> {
  const childrenByRefSet: Record<string, Set<string>> = {};
  for (const ref of Object.keys(nodeByRef))
    childrenByRefSet[ref] = new Set<string>();
  for (const node of Object.values(nodeByRef)) {
    for (const parentRef of getParents(node.content)) {
      const children = childrenByRefSet[parentRef] ?? new Set<string>();
      children.add(node.d);
      childrenByRefSet[parentRef] = children;
    }
  }
  return Object.fromEntries(
    Object.entries(childrenByRefSet).map(([ref, children]) => [
      ref,
      Array.from(children),
    ])
  );
}

function buildAncestryByRef(nodeByRef: Record<string, TaxonomyNode>): {
  ancestryByRef: Record<string, string[]>;
  errors: string[];
} {
  const ancestryByRef: Record<string, string[]> = {};
  const errors: string[] = [];
  const visiting = new Set<string>();

  const visit = (ref: string): string[] => {
    const existingAncestry = ancestryByRef[ref];
    if (existingAncestry) return existingAncestry;
    const node = nodeByRef[ref];
    if (!node) return [];
    if (visiting.has(ref)) {
      errors.push(`Cycle detected while resolving ancestry for ${ref}.`);
      return [ref];
    }
    visiting.add(ref);
    const ancestry: string[] = [];
    for (const parentRef of getParents(node.content)) {
      ancestry.push(...visit(parentRef));
      ancestry.push(parentRef);
    }
    visiting.delete(ref);
    ancestryByRef[ref] = unique([...ancestry, ref]);
    return ancestryByRef[ref] || [ref];
  };

  for (const ref of Object.keys(nodeByRef)) visit(ref);
  return { ancestryByRef, errors };
}

function buildDescendantsByRef(childrenByRef: Record<string, string[]>): {
  descendantsByRef: Record<string, string[]>;
  descendantSetByRef: Record<string, Record<string, true>>;
  errors: string[];
} {
  const descendantsByRef: Record<string, string[]> = {};
  const descendantSetByRef: Record<string, Record<string, true>> = {};
  const errors: string[] = [];
  const visiting = new Set<string>();

  const visit = (ref: string): Set<string> => {
    const existingDescendants = descendantSetByRef[ref];
    if (existingDescendants) return new Set(Object.keys(existingDescendants));
    if (visiting.has(ref)) {
      errors.push(`Cycle detected while resolving descendants for ${ref}.`);
      return new Set();
    }
    visiting.add(ref);
    const descendants = new Set<string>();
    for (const child of childrenByRef[ref] || []) {
      descendants.add(child);
      for (const descendant of visit(child)) descendants.add(descendant);
    }
    visiting.delete(ref);
    descendantsByRef[ref] = Array.from(descendants);
    descendantSetByRef[ref] = Object.fromEntries(
      Array.from(descendants).map((descendantRef) => [descendantRef, true])
    );
    return descendants;
  };

  for (const ref of Object.keys(childrenByRef)) {
    visit(ref);
  }

  return { descendantsByRef, descendantSetByRef, errors };
}

function buildRelationSetByRef(
  relationsByRef: Record<string, string[]>
): Record<string, Record<string, true>> {
  return Object.fromEntries(
    Object.entries(relationsByRef).map(([ref, relations]) => [
      ref,
      Object.fromEntries(
        relations.map((relationRef) => [normalizeRef(relationRef), true])
      ),
    ])
  );
}

function buildThingsBySegmentRef(
  registry: TaxonomyRegistry
): Record<string, string[]> {
  const thingsBySegmentRef: Record<string, Set<string>> = {};
  for (const [ref, node] of Object.entries(registry.nodeByRef)) {
    const normalizedRef = normalizeRef(ref);
    if (node.family !== "thing") continue;
    for (const contextRef of getInheritedValRefs(registry, normalizedRef).map(
      normalizeRef
    )) {
      if (!contextRef.startsWith("val:context:segment:")) continue;
      const segmentThings = thingsBySegmentRef[contextRef] ?? new Set<string>();
      segmentThings.add(normalizedRef);
      thingsBySegmentRef[contextRef] = segmentThings;
    }
  }
  return Object.fromEntries(
    Object.entries(thingsBySegmentRef).map(([ref, things]) => [
      ref,
      Array.from(things),
    ])
  );
}

function buildReverseRefsByRef(
  nodeByRef: Record<string, TaxonomyNode>
): Record<string, ReverseRef[]> {
  const reverseRefsByRef: Record<string, Map<string, ReverseRef>> = {};

  const pushReverse = (targetRef: string, reverseRef: ReverseRef) => {
    const reverseRefs =
      reverseRefsByRef[targetRef] ?? new Map<string, ReverseRef>();
    reverseRefs.set(
      `${reverseRef.sourceRef}\u0000${reverseRef.field}`,
      reverseRef
    );
    reverseRefsByRef[targetRef] = reverseRefs;
  };

  for (const node of Object.values(nodeByRef)) {
    for (const ref of getParents(node.content)) {
      pushReverse(ref, { sourceRef: node.d, field: "parents" });
    }
    for (const ref of getAuthoredRelations(node.content)) {
      pushReverse(ref, { sourceRef: node.d, field: "relations" });
    }
    for (const ref of getRequiredRelations(node.content)) {
      pushReverse(ref, { sourceRef: node.d, field: "requiredRelations" });
    }
  }

  return Object.fromEntries(
    Object.entries(reverseRefsByRef).map(([ref, reverseRefs]) => [
      ref,
      Array.from(reverseRefs.values()),
    ])
  );
}

function getRelationRefs(node: TaxonomyNode | undefined): string[] {
  return getAuthoredRelations(node?.content || {});
}

export function getRelatedRefs(node: TaxonomyNode | undefined): string[] {
  return getRelationRefs(node);
}

export function getRelatedRefsByPrefix(
  node: TaxonomyNode | undefined,
  prefix: string
): string[] {
  return getRelationRefs(node).filter((ref) => ref.startsWith(prefix));
}

export function getDirectRelatedRefsByPrefix(
  registry: TaxonomyRegistry,
  ref: string | null | undefined,
  prefix: string
): string[] {
  if (!ref) return [];
  const node = registry.nodeByRef[normalizeRef(ref)];
  if (!node) return [];
  return getRelatedRefsByPrefix(node, prefix).map(normalizeRef);
}

function getRelatedPropRefs(node: TaxonomyNode | undefined): string[] {
  return getRelationRefs(node).filter((ref) =>
    normalizeRef(ref).startsWith("prop:")
  );
}

function getSelectableCandidateRefsForRoot(
  registry: TaxonomyRegistry,
  rootRef: string
): string[] {
  const normalizedRootRef = normalizeRef(rootRef);
  const descendants = getDescendants(registry, normalizedRootRef);
  return unique(
    descendants.length > 0 ? descendants.map(normalizeRef) : [normalizedRootRef]
  );
}

function buildDomainBranchChildrenByRootRef(
  registry: TaxonomyRegistry
): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};

  for (const node of Object.values(registry.nodeByRef)) {
    if (node.family !== "val") continue;
    const children = (registry.childrenByRef[node.d] || []).map(normalizeRef);
    if (children.length === 0) continue;
    result[node.d] = Object.fromEntries(
      children.map((childRef) => [getTerminalKey(childRef), childRef])
    );
  }

  return result;
}

function buildPropMetadata(registry: TaxonomyRegistry): void {
  const directDependsOnPropsByRef: Record<string, string[]> = {};

  for (const node of Object.values(registry.nodeByRef)) {
    if (node.family !== "prop") continue;

    const roots = propRoots(registry, node.d);
    registry.propRootsByRef[node.d] = roots;
    registry.propSelectableCandidateRefsByRef[node.d] = unique(
      roots.flatMap((rootRef) =>
        getSelectableCandidateRefsForRoot(registry, rootRef)
      )
    );
    directDependsOnPropsByRef[node.d] = [];
  }

  const propRefs = Object.keys(
    registry.propSelectableCandidateRefsByRef
  ).sort();
  const candidateSetByPropRef = Object.fromEntries(
    propRefs.map((propRef) => [
      propRef,
      new Set(registry.propSelectableCandidateRefsByRef[propRef] || []),
    ])
  ) as Record<string, Set<string>>;

  for (const propRef of propRefs) {
    const propCandidateRefs =
      registry.propSelectableCandidateRefsByRef[propRef] || [];
    const directDependencies = new Set<string>();

    for (const otherPropRef of propRefs) {
      if (otherPropRef === propRef) continue;
      const otherCandidates = candidateSetByPropRef[otherPropRef];
      if (!otherCandidates || otherCandidates.size === 0) continue;

      const dependsOnOther = propCandidateRefs.some((candidateRef) => {
        const relatedRefs = getRelationRefs(registry.nodeByRef[candidateRef]);
        return relatedRefs.some((relatedRef) =>
          otherCandidates.has(normalizeRef(relatedRef))
        );
      });

      if (dependsOnOther) directDependencies.add(otherPropRef);
    }

    directDependsOnPropsByRef[propRef] = Array.from(directDependencies).sort();
    registry.propDirectDependsOnPropsByRef[propRef] =
      directDependsOnPropsByRef[propRef] || [];
  }

  for (const propRef of propRefs) {
    const visited = new Set<string>();
    const queue = [...(directDependsOnPropsByRef[propRef] || [])];
    let head = 0;

    while (head < queue.length) {
      const currentPropRef = normalizeRef(queue[head++] || "");
      if (
        !currentPropRef ||
        visited.has(currentPropRef) ||
        currentPropRef === propRef
      )
        continue;
      visited.add(currentPropRef);
      queue.push(...(directDependsOnPropsByRef[currentPropRef] || []));
    }

    registry.propDependsOnPropsByRef[propRef] = Array.from(visited).sort();
  }
}

function inheritedProps(
  registryByRef: Record<string, TaxonomyNode>,
  ancestry: string[]
): string[] {
  return unique(
    ancestry.flatMap((ref) => getRelatedPropRefs(registryByRef[ref]))
  );
}

function getRequiredPropRefs(node: TaxonomyNode | undefined): string[] {
  return getRequiredRelations(node?.content || {}).filter((ref) =>
    normalizeRef(ref).startsWith("prop:")
  );
}

export function getDescendants(
  registry: TaxonomyRegistry,
  rootRef: string
): string[] {
  return registry.descendantsByRef[normalizeRef(rootRef)] || [];
}

export function isSameOrDescendant(
  registry: TaxonomyRegistry,
  candidateRef: string | undefined,
  ancestorRef: string | undefined
): boolean {
  if (!candidateRef || !ancestorRef) return false;
  const candidate = normalizeRef(candidateRef);
  const ancestor = normalizeRef(ancestorRef);
  return (
    candidate === ancestor ||
    Boolean(registry.descendantSetByRef[ancestor]?.[candidate])
  );
}

export function withDescendants(
  registry: TaxonomyRegistry,
  rootRef: string
): string[] {
  const normalized = normalizeRef(rootRef);
  return unique([normalized, ...getDescendants(registry, normalized)]);
}

function activeGraphRefs(
  input: TaxonomyValueResolutionInput,
  registry: TaxonomyRegistry
): string[] {
  const refs: string[] = [];
  const thingRefs = input.primaryThingRef
    ? stripGenericCompatibilityAnchors(
        registry.ancestryByRef[normalizeRef(input.primaryThingRef)] || [
          normalizeRef(input.primaryThingRef),
        ],
        normalizeRef(input.primaryThingRef)
      )
    : [];
  refs.push(...thingRefs);

  for (const ref of thingRefs) {
    refs.push(...getRelationRefs(registry.nodeByRef[ref]));
  }

  const selectedVals = [
    ...(input.overlayValRefs || []).map(normalizeRef),
    ...(input.assertedValueRefs || []).map(normalizeRef),
  ];

  for (const ref of selectedVals) {
    refs.push(ref);
    refs.push(...getRelationRefs(registry.nodeByRef[ref]));
  }

  return unique(
    refs
      .map(normalizeRef)
      .filter(Boolean)
      .filter((ref) => !ref.startsWith("prop:"))
  );
}

function terminalKeys(activeRefs: string[]): Set<string> {
  return new Set(activeRefs.map(getTerminalKey).filter(Boolean));
}

function narrowValRoots(
  registry: TaxonomyRegistry,
  rootTargets: string[],
  activeRefs: string[]
): string[] {
  if (activeRefs.length === 0) return rootTargets.map(normalizeRef);
  const activeKeys = terminalKeys(activeRefs);
  const narrowedRoots = rootTargets.flatMap((rootRef) => {
    const normalizedRoot = normalizeRef(rootRef);
    const rootNode = registry.nodeByRef[normalizedRoot];
    if (!rootNode || rootNode.family !== "val") return [normalizedRoot];

    const directChildren = registry.childrenByRef[normalizedRoot] || [];
    const matchingChildren = directChildren.filter((childRef) =>
      activeKeys.has(getTerminalKey(childRef))
    );
    if (matchingChildren.length > 0) return matchingChildren;

    const genericLeafChildren = directChildren.filter((childRef) => {
      const grandchildren =
        registry.childrenByRef[normalizeRef(childRef)] || [];
      return grandchildren.length === 0;
    });
    return genericLeafChildren.length > 0
      ? genericLeafChildren
      : [normalizedRoot];
  });
  return unique(narrowedRoots);
}

export type PropValueSchema =
  | { kind: "ref"; roots: string[] }
  | { kind: "literal"; typeRef: string };

export function propSchema(
  registry: TaxonomyRegistry,
  propRef: string
): PropValueSchema | undefined {
  const normalizedPropRef = normalizeRef(propRef);
  const propNode = registry.nodeByRef[normalizedPropRef];
  if (!propNode || propNode.family !== "prop") return undefined;
  const relations = getRelationRefs(propNode);
  const roots = relations.filter((ref) => {
    const family = normalizeRef(ref).split(":", 1)[0];
    return family === "thing" || family === "val";
  });
  if (roots.length > 0) return { kind: "ref", roots };
  const valtypeTargets = relations.filter((ref) =>
    normalizeRef(ref).startsWith("valtype:")
  );
  if (valtypeTargets.length === 1)
    return { kind: "literal", typeRef: valtypeTargets[0] || "" };
  return undefined;
}

export function propRoots(
  registry: TaxonomyRegistry,
  propRef: string
): string[] {
  const normalizedPropRef = normalizeRef(propRef);
  const cachedRoots = registry.propRootsByRef[normalizedPropRef];
  if (cachedRoots) return cachedRoots;
  const schema = propSchema(registry, propRef);
  return schema?.kind === "ref" ? schema.roots : [];
}

export function propValueType(
  registry: TaxonomyRegistry,
  propRef: string
): string | undefined {
  const schema = propSchema(registry, propRef);
  return schema?.kind === "literal" ? schema.typeRef : undefined;
}

function getPropSemanticsErrors(node: TaxonomyNode): string[] {
  if (node.family !== "prop") return [];
  const relations = getRelationRefs(node);
  const nodeTargets = relations.filter((ref) => {
    const family = normalizeRef(ref).split(":", 1)[0];
    return family === "thing" || family === "val";
  });
  const valtypeTargets = relations.filter((ref) =>
    normalizeRef(ref).startsWith("valtype:")
  );

  const hasNodeTargets = nodeTargets.length > 0;
  const hasLiteralTarget = valtypeTargets.length > 0;

  if (
    (hasNodeTargets && hasLiteralTarget) ||
    (!hasNodeTargets && !hasLiteralTarget) ||
    valtypeTargets.length > 1
  ) {
    return [
      `Prop ${node.d} must target one-or-more thing/val refs OR exactly one valtype ref via relations.`,
    ];
  }
  return [];
}

function getRequiredSegmentErrors(node: TaxonomyNode): string[] {
  const requiredSegmentRefs = getRequiredRelations(node.content).filter((ref) =>
    normalizeRef(ref).startsWith("val:context:segment:")
  );
  if (requiredSegmentRefs.length <= 1) return [];
  return [
    `${node.d} requiredRelations must contain at most one val:context:segment:* ref.`,
  ];
}

function hasDirectRelation(
  registry: TaxonomyRegistry,
  sourceRef: string,
  targetRef: string
): boolean {
  return Boolean(
    registry.relationSetByRef[normalizeRef(sourceRef)]?.[
      normalizeRef(targetRef)
    ]
  );
}

const GENERIC_COMPATIBILITY_ANCHORS = new Set([
  "thing",
  "thing:good",
  "thing:artifact",
  "thing:organization",
  "thing:game",
  "thing:service",
  "thing:vehicle",
  "thing:real_estate",
  "val",
  "val:context",
  "val:business_function",
]);

function stripGenericCompatibilityAnchors(
  refs: string[],
  preserveRef: string
): string[] {
  return unique(
    refs.filter(
      (ref) =>
        ref === preserveRef ||
        !GENERIC_COMPATIBILITY_ANCHORS.has(normalizeRef(ref))
    )
  );
}

export function isCandidateCompatibleWithActiveGraph(
  registry: TaxonomyRegistry,
  candidateRef: string,
  activeRefs: string[]
): boolean {
  if (activeRefs.length === 0) return true;
  const normalizedCandidate = normalizeRef(candidateRef);
  const candidateFamilyRefs = stripGenericCompatibilityAnchors(
    [
      normalizedCandidate,
      ...(registry.ancestryByRef[normalizedCandidate] || []),
    ],
    normalizedCandidate
  );

  return activeRefs.some((activeRef) => {
    const normalizedActive = normalizeRef(activeRef);
    const activeFamilyRefs = stripGenericCompatibilityAnchors(
      [normalizedActive, ...(registry.ancestryByRef[normalizedActive] || [])],
      normalizedActive
    );

    return candidateFamilyRefs.some((candidateFamilyRef) =>
      activeFamilyRefs.some(
        (activeFamilyRef) =>
          candidateFamilyRef === activeFamilyRef ||
          hasDirectRelation(registry, candidateFamilyRef, activeFamilyRef) ||
          hasDirectRelation(registry, activeFamilyRef, candidateFamilyRef)
      )
    );
  });
}

/**
 * Registry-level option resolver kept for registry/debug callers.
 * Not for user-facing resolver behavior: UI/form/marketplace code should use
 * buildResolvedTaxonomyState or the state-aware helpers in
 * utils/taxonomy/client-state.
 */
export function registryPropOptions(
  registry: TaxonomyRegistry,
  propRef: string,
  input: TaxonomyValueResolutionInput
): string[] {
  const normalizedPropRef = normalizeRef(propRef);
  const propNode = registry.nodeByRef[normalizedPropRef];
  if (!propNode || propNode.family !== "prop") return [];
  const rootTargets = propRoots(registry, normalizedPropRef);
  if (rootTargets.length === 0) return [];

  const activeRefs = activeGraphRefs(input, registry);
  const narrowedRootTargets = narrowValRoots(registry, rootTargets, activeRefs);
  const allOptions = unique(
    narrowedRootTargets.flatMap((rootRef) => {
      const normalizedRoot = normalizeRef(rootRef);
      const descendants = getDescendants(registry, normalizedRoot);
      return descendants.length > 0 ? descendants : [normalizedRoot];
    })
  );

  const compatibleOptions =
    activeRefs.length === 0
      ? allOptions
      : allOptions.filter((optionRef) =>
          isCandidateCompatibleWithActiveGraph(registry, optionRef, activeRefs)
        );

  const optionsToSort =
    compatibleOptions.length > 0 ? compatibleOptions : allOptions;

  const scoredOptions = optionsToSort.map((optionRef) => ({
    ref: optionRef,
    score: activeRefs.reduce(
      (maxScore, activeRef) =>
        Math.max(maxScore, pathOverlapScore(optionRef, activeRef)),
      0
    ),
    depth: getPathSegments(optionRef).length,
  }));

  return scoredOptions
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.depth !== a.depth) return b.depth - a.depth;
      return a.ref.localeCompare(b.ref);
    })
    .map((entry) => entry.ref);
}

export type CompatibilityTrace = {
  candidateRef: string;
  passed: boolean;
  reason: string;
  path: string[];
};

export function debugActiveGraphRefs(
  registry: TaxonomyRegistry,
  input: TaxonomyValueResolutionInput
): { activeGraphRefs: string[]; activeTerminalKeys: string[] } {
  const refs = activeGraphRefs(input, registry);
  return {
    activeGraphRefs: refs,
    activeTerminalKeys: Array.from(terminalKeys(refs)).sort(),
  };
}

function compatibilityTrace(
  registry: TaxonomyRegistry,
  candidateRef: string,
  activeRefs: string[]
): CompatibilityTrace {
  const normalizedCandidate = normalizeRef(candidateRef);
  const candidateFamilyRefs = stripGenericCompatibilityAnchors(
    [
      normalizedCandidate,
      ...(registry.ancestryByRef[normalizedCandidate] || []),
    ],
    normalizedCandidate
  );

  for (const activeRef of activeRefs) {
    const normalizedActive = normalizeRef(activeRef);
    const activeFamilyRefs = stripGenericCompatibilityAnchors(
      [normalizedActive, ...(registry.ancestryByRef[normalizedActive] || [])],
      normalizedActive
    );

    for (const candidateFamilyRef of candidateFamilyRefs) {
      for (const activeFamilyRef of activeFamilyRefs) {
        if (candidateFamilyRef === activeFamilyRef) {
          return {
            candidateRef: normalizedCandidate,
            passed: true,
            reason: "exact family match",
            path: [candidateFamilyRef, activeFamilyRef],
          };
        }
        if (hasDirectRelation(registry, candidateFamilyRef, activeFamilyRef)) {
          return {
            candidateRef: normalizedCandidate,
            passed: true,
            reason: "direct relation from candidate family to active family",
            path: [candidateFamilyRef, activeFamilyRef],
          };
        }
        if (hasDirectRelation(registry, activeFamilyRef, candidateFamilyRef)) {
          return {
            candidateRef: normalizedCandidate,
            passed: true,
            reason: "reverse relation from active family to candidate family",
            path: [activeFamilyRef, candidateFamilyRef],
          };
        }
      }
    }
  }

  return {
    candidateRef: normalizedCandidate,
    passed: false,
    reason: "no relation path found",
    path: [],
  };
}

export function debugPropOptions(
  registry: TaxonomyRegistry,
  propRef: string,
  input: TaxonomyValueResolutionInput
): {
  propRef: string;
  roots: string[];
  narrowedRoots: string[];
  activeGraphRefs: string[];
  activeTerminalKeys: string[];
  candidateCountBeforeCompatibility: number;
  candidateCountAfterCompatibility: number;
  finalOptionRefs: string[];
  compatibility: CompatibilityTrace[];
} {
  const normalizedPropRef = normalizeRef(propRef);
  const roots = propRoots(registry, normalizedPropRef);
  const activeRefs = activeGraphRefs(input, registry);
  const narrowedRoots = narrowValRoots(registry, roots, activeRefs);
  const allOptions = unique(
    narrowedRoots.flatMap((rootRef) => {
      const normalizedRoot = normalizeRef(rootRef);
      const descendants = getDescendants(registry, normalizedRoot);
      return descendants.length > 0 ? descendants : [normalizedRoot];
    })
  );
  const compatibility = allOptions.map((optionRef) =>
    compatibilityTrace(registry, optionRef, activeRefs)
  );
  const compatibleOptions =
    activeRefs.length === 0
      ? allOptions
      : compatibility
          .filter((entry) => entry.passed)
          .map((entry) => entry.candidateRef);
  const finalOptionRefs = registryPropOptions(
    registry,
    normalizedPropRef,
    input
  );

  return {
    propRef: normalizedPropRef,
    roots,
    narrowedRoots,
    activeGraphRefs: activeRefs,
    activeTerminalKeys: Array.from(terminalKeys(activeRefs)).sort(),
    candidateCountBeforeCompatibility: allOptions.length,
    candidateCountAfterCompatibility: compatibleOptions.length,
    finalOptionRefs,
    compatibility,
  };
}

export function debugApplicableProps(
  registry: TaxonomyRegistry,
  params: {
    primaryThingRef?: string;
    primarySegmentRef?: string;
    overlayValRefs?: string[];
    helperLabelOverlayRefs?: string[];
    legacyOverlayRefs?: string[];
    orderedPropRefs?: string[];
  }
): Array<{
  propRef: string;
  reasons: string[];
}> {
  const thingSources = new Set<string>();
  const ancestry = params.primaryThingRef
    ? registry.ancestryByRef[normalizeRef(params.primaryThingRef)] || [
        normalizeRef(params.primaryThingRef),
      ]
    : [];
  for (const ref of ancestry) {
    for (const propRef of getRelatedPropRefs(registry.nodeByRef[ref])) {
      thingSources.add(
        `${normalizeRef(propRef)}::from thing ancestry (${ref})`
      );
    }
  }

  const segmentSources = new Set<string>();
  if (params.primarySegmentRef) {
    for (const propRef of getRelatedPropRefs(
      registry.nodeByRef[normalizeRef(params.primarySegmentRef)]
    )) {
      segmentSources.add(
        `${normalizeRef(propRef)}::from primary segment (${normalizeRef(params.primarySegmentRef)})`
      );
    }
  }

  const semanticSources = new Set<string>();
  for (const ref of params.overlayValRefs || []) {
    for (const propRef of getRelatedPropRefs(
      registry.nodeByRef[normalizeRef(ref)]
    )) {
      semanticSources.add(
        `${normalizeRef(propRef)}::from semantic overlay (${normalizeRef(ref)})`
      );
    }
  }

  const helperSources = new Set<string>();
  for (const ref of params.helperLabelOverlayRefs || []) {
    for (const propRef of getRelatedPropRefs(
      registry.nodeByRef[normalizeRef(ref)]
    )) {
      helperSources.add(
        `${normalizeRef(propRef)}::from helper label (${normalizeRef(ref)})`
      );
    }
  }

  const legacySources = new Set<string>();
  for (const ref of params.legacyOverlayRefs || []) {
    for (const propRef of getRelatedPropRefs(
      registry.nodeByRef[normalizeRef(ref)]
    )) {
      legacySources.add(
        `${normalizeRef(propRef)}::from legacy state (${normalizeRef(ref)})`
      );
    }
  }

  const propOrder =
    params.orderedPropRefs || registryApplicableProps(registry, params);
  return propOrder.map((propRef) => {
    const normalizedPropRef = normalizeRef(propRef);
    const reasons = [
      ...Array.from(thingSources)
        .filter((entry) => entry.startsWith(`${normalizedPropRef}::`))
        .map((entry) => entry.split("::")[1] || ""),
      ...Array.from(segmentSources)
        .filter((entry) => entry.startsWith(`${normalizedPropRef}::`))
        .map((entry) => entry.split("::")[1] || ""),
      ...Array.from(semanticSources)
        .filter((entry) => entry.startsWith(`${normalizedPropRef}::`))
        .map((entry) => entry.split("::")[1] || ""),
      ...Array.from(legacySources)
        .filter((entry) => entry.startsWith(`${normalizedPropRef}::`))
        .map((entry) => entry.split("::")[1] || ""),
      ...Array.from(helperSources)
        .filter((entry) => entry.startsWith(`${normalizedPropRef}::`))
        .map((entry) => entry.split("::")[1] || ""),
    ].filter(Boolean);

    return { propRef: normalizedPropRef, reasons };
  });
}

/**
 * Registry-level applicability helper kept for registry/debug callers.
 * Not for user-facing resolver behavior: it does not know listing/form state.
 * Prefer buildResolvedTaxonomyState or the state-aware client-state helpers.
 */
export function registryApplicableProps(
  registry: TaxonomyRegistry,
  params: {
    primaryThingRef?: string;
    primarySegmentRef?: string;
    overlayValRefs?: string[];
  }
): string[] {
  const thingProps = params.primaryThingRef
    ? registry.fullThingPropsByRef[normalizeRef(params.primaryThingRef)] || []
    : [];
  const structuralOverlayRefs = [
    ...(params.primarySegmentRef ? [params.primarySegmentRef] : []),
    ...(params.overlayValRefs || []),
  ];
  const overlayProps = structuralOverlayRefs
    .map(normalizeRef)
    .flatMap((ref) => getRelatedPropRefs(registry.nodeByRef[ref]));
  return unique([...thingProps, ...overlayProps]);
}

export function requiredProps(
  registry: TaxonomyRegistry,
  params: {
    primaryThingRef?: string;
    primarySegmentRef?: string;
    overlayValRefs?: string[];
  }
): string[] {
  const thingRequired = params.primaryThingRef
    ? (
        registry.ancestryByRef[normalizeRef(params.primaryThingRef)] || [
          normalizeRef(params.primaryThingRef),
        ]
      ).flatMap((ref) => getRequiredPropRefs(registry.nodeByRef[ref]))
    : [];
  const structuralOverlayRefs = [
    ...(params.primarySegmentRef ? [params.primarySegmentRef] : []),
    ...(params.overlayValRefs || []),
  ];
  const overlayRequired = structuralOverlayRefs
    .map(normalizeRef)
    .flatMap((ref) => getRequiredPropRefs(registry.nodeByRef[ref]));
  return unique([...thingRequired, ...overlayRequired]);
}

export function getInheritedRefsByPrefix(
  registry: TaxonomyRegistry,
  primaryThingRef: string | undefined,
  prefix: string
): string[] {
  if (!primaryThingRef) return [];
  const ancestry = registry.ancestryByRef[normalizeRef(primaryThingRef)] || [
    normalizeRef(primaryThingRef),
  ];
  return unique(
    ancestry.flatMap((ref) =>
      getRelatedRefsByPrefix(registry.nodeByRef[ref], prefix)
    )
  );
}

export function getInheritedValRefs(
  registry: TaxonomyRegistry,
  primaryThingRef: string | undefined
): string[] {
  return getInheritedRefsByPrefix(registry, primaryThingRef, "val:");
}

export function createEmptyTaxonomyRegistry(
  trustedPubkeys: string[] = []
): TaxonomyRegistry {
  return {
    loadedAt: new Date(0).toISOString(),
    loadedEventCount: 0,
    source: "empty",
    trustedPubkeys,
    nodeByRef: {},
    coordinateToRef: {},
    childrenByRef: {},
    ancestryByRef: {},
    descendantsByRef: {},
    descendantSetByRef: {},
    reverseRefsByRef: {},
    imageByRef: {},
    relationsByRef: {},
    relationSetByRef: {},
    fullThingPropsByRef: {},
    propRootsByRef: {},
    propSelectableCandidateRefsByRef: {},
    domainBranchChildrenByRootRef: {},
    propDirectDependsOnPropsByRef: {},
    propDependsOnPropsByRef: {},
    warnings: [],
    errors: [],
    thingsBySegmentRef: {},
  };
}

export function buildRegistry(
  events: NostrEvent[],
  options: { trustedPubkeys?: string[] } = {}
): TaxonomyRegistry {
  const trustedPubkeys = unique(
    (options.trustedPubkeys || [])
      .map((pubkey) => pubkey.trim())
      .filter(Boolean)
  );
  const registry = createEmptyTaxonomyRegistry(trustedPubkeys);
  const trustedSet = new Set(trustedPubkeys);
  const nodes = events
    .filter((event) => trustedSet.size === 0 || trustedSet.has(event.pubkey))
    .map(toTaxonomyNode)
    .filter((node): node is TaxonomyNode => node !== null);

  registry.loadedEventCount = nodes.length;

  for (const node of nodes) {
    const existing = registry.nodeByRef[node.d];
    if (isNewerTaxonomyEvent(node, existing)) {
      registry.nodeByRef[node.d] = node;
      registry.coordinateToRef[node.coordinate] = node.d;
      registry.relationsByRef[node.d] = getRelationRefs(node);
      if (node.content.image?.url)
        registry.imageByRef[node.d] = node.content.image.url;
      else delete registry.imageByRef[node.d];
    }
  }

  for (const node of Object.values(registry.nodeByRef)) {
    for (const ref of getParents(node.content)) {
      if (!registry.nodeByRef[ref])
        registry.warnings.push(
          `${node.d} references missing parents target ${ref}.`
        );
    }
    for (const ref of getRelationRefs(node)) {
      if (!registry.nodeByRef[ref])
        registry.warnings.push(
          `${node.d} references missing relations target ${ref}.`
        );
    }
    for (const ref of getRequiredRelations(node.content)) {
      if (!registry.nodeByRef[ref])
        registry.warnings.push(
          `${node.d} references missing requiredRelations target ${ref}.`
        );
    }
    registry.errors.push(...getPropSemanticsErrors(node));
    registry.errors.push(...getRequiredSegmentErrors(node));
  }

  registry.childrenByRef = buildChildrenByRef(registry.nodeByRef);
  const ancestryResult = buildAncestryByRef(registry.nodeByRef);
  registry.ancestryByRef = ancestryResult.ancestryByRef;
  const descendantsResult = buildDescendantsByRef(registry.childrenByRef);
  registry.descendantsByRef = descendantsResult.descendantsByRef;
  registry.descendantSetByRef = descendantsResult.descendantSetByRef;
  registry.errors.push(...descendantsResult.errors);
  registry.errors.push(...ancestryResult.errors);
  registry.reverseRefsByRef = buildReverseRefsByRef(registry.nodeByRef);
  registry.relationSetByRef = buildRelationSetByRef(registry.relationsByRef);
  registry.thingsBySegmentRef = buildThingsBySegmentRef(registry);

  for (const node of Object.values(registry.nodeByRef)) {
    if (node.family !== "thing") continue;
    const ancestry = registry.ancestryByRef[node.d] || [node.d];
    registry.fullThingPropsByRef[node.d] = inheritedProps(
      registry.nodeByRef,
      ancestry
    );
  }

  registry.domainBranchChildrenByRootRef =
    buildDomainBranchChildrenByRootRef(registry);
  buildPropMetadata(registry);

  registry.loadedAt = new Date().toISOString();
  registry.warnings = unique(registry.warnings);
  registry.errors = unique(registry.errors);
  return registry;
}

export function resolveRegistryRef(
  registry: TaxonomyRegistry,
  ref: string
): string | undefined {
  const normalizedRef = normalizeRef(ref);
  if (registry.nodeByRef[normalizedRef]) return normalizedRef;
  return registry.coordinateToRef[ref];
}

export const normalizeTaxonomyRef = normalizeRef;
export const expandRefWithDescendants = withDescendants;
export const getPropValueSchema = propSchema;
export const getPropNodeTargetRoots = propRoots;
export const getPropLiteralValueTypeRef = propValueType;
export const resolveRegistryValueOptionsForProp = registryPropOptions;
export const getRegistryApplicableProps = registryApplicableProps;
export const getFullRequiredProps = requiredProps;
export const getInheritedRelatedRefsByPrefix = getInheritedRefsByPrefix;
export const getInheritedOverlayValRefs = getInheritedValRefs;

function humanizeTerminalKey(ref: string): string {
  const terminal = normalizeRef(ref).split(":").filter(Boolean).pop() || ref;
  return terminal
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function getTaxonomyNodeLabel(
  registry: TaxonomyRegistry,
  ref: string,
  locale: string = "en"
): string {
  const resolvedRef = resolveRegistryRef(registry, ref);
  if (!resolvedRef) return humanizeTerminalKey(ref);
  const labels = registry.nodeByRef[resolvedRef]?.content.labels;
  return labels?.[locale] || labels?.en || humanizeTerminalKey(resolvedRef);
}

export function getTaxonomyBrowseLabel(
  registry: TaxonomyRegistry,
  ref: string,
  locale: string = "en"
): string {
  return getTaxonomyNodeLabel(registry, ref, locale);
}

export function createEmptyProductTaxonomy(): ProductTaxonomy {
  return {
    primaryThingRef: undefined,
    overlayValRefs: [],
    requiredRefs: [],
    refAssertions: [],
    literalAssertions: [],
  };
}
