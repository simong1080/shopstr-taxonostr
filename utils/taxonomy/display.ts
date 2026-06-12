import { getTaxonomyNodeLabel, normalizeRef } from "@/utils/taxonomy/registry";
import { TaxonomyRegistry } from "@/utils/taxonomy/types";

export type TaxonomyDisplayLabelContext =
  | "category"
  | "breadcrumb"
  | "listingType"
  | "default";

export type TaxonomyBrowseGroup = {
  key: string;
  label?: string;
  refs: string[];
};

export type TaxonomyBrowseOptions = {
  currentThingRef?: string;
};

export type TaxonomyTileImage = {
  src: string;
  alt: string;
  ref: string;
  fit: "cover" | "contain";
};

export type TaxonomyTileImageOptions = {
  selectedValuesByProp?: Record<string, string[]>;
  requiredRefs?: string[];
  maxImages?: number;
};

const GENERIC_GROUP_REFS = new Set(["thing", "thing:artifact"]);

function displayLabelsFor(
  registry: TaxonomyRegistry,
  ref: string,
  locale: string
) {
  const node = registry.nodeByRef[normalizeRef(ref)];
  return (
    node?.content.displayLabels?.[locale] || node?.content.displayLabels?.en
  );
}

export function getTaxonomyDisplayLabel(
  registry: TaxonomyRegistry,
  ref: string,
  locale: string = "en",
  context: TaxonomyDisplayLabelContext = "default"
): string {
  const labels = displayLabelsFor(registry, ref, locale);
  const fallback = getTaxonomyNodeLabel(registry, ref, locale);

  if (context === "listingType")
    return labels?.listingType || labels?.singular || fallback;
  if (context === "category" || context === "breadcrumb")
    return labels?.category || labels?.plural || fallback;
  return fallback;
}

function tileImageFit(ref: string): TaxonomyTileImage["fit"] {
  const normalizedRef = normalizeRef(ref);
  return normalizedRef.startsWith("thing:organization") ||
    normalizedRef.startsWith("thing:person") ||
    normalizedRef.startsWith("thing:game")
    ? "contain"
    : "cover";
}

function imageForRef(
  registry: TaxonomyRegistry,
  ref: string,
  locale: string,
  seenImageUrls: Set<string>,
  seenRefs: Set<string>
): TaxonomyTileImage | null {
  const normalizedRef = normalizeRef(ref);
  const src = registry.imageByRef[normalizedRef];
  if (!src || seenImageUrls.has(src) || seenRefs.has(normalizedRef))
    return null;
  seenImageUrls.add(src);
  seenRefs.add(normalizedRef);
  return {
    src,
    alt: getTaxonomyDisplayLabel(registry, normalizedRef, locale, "category"),
    ref: normalizedRef,
    fit: tileImageFit(normalizedRef),
  };
}

function nearestDescendantImages(
  registry: TaxonomyRegistry,
  ref: string,
  locale: string,
  maxImages: number,
  seenImageUrls: Set<string>,
  seenRefs: Set<string>
): TaxonomyTileImage[] {
  const queue = [
    ...(registry.childrenByRef[normalizeRef(ref)] || []).map(normalizeRef),
  ];
  const visited = new Set<string>();
  const images: TaxonomyTileImage[] = [];
  let head = 0;

  while (head < queue.length && images.length < maxImages) {
    const currentRef = queue[head++]!;
    if (visited.has(currentRef)) continue;
    visited.add(currentRef);
    const image = imageForRef(
      registry,
      currentRef,
      locale,
      seenImageUrls,
      seenRefs
    );
    if (image) images.push(image);
    for (const childRef of registry.childrenByRef[currentRef] || []) {
      const normalizedChildRef = normalizeRef(childRef);
      if (!visited.has(normalizedChildRef)) queue.push(normalizedChildRef);
    }
  }

  return images;
}

function requiredRelationImages(
  registry: TaxonomyRegistry,
  ref: string,
  locale: string,
  maxImages: number,
  seenImageUrls: Set<string>,
  seenRefs: Set<string>,
  selectedValuesByProp: Record<string, string[]> = {},
  requiredRefs?: string[]
): TaxonomyTileImage[] {
  const inheritedRequiredRefs = requiredRefs
    ? requiredRefs.map(normalizeRef)
    : (
        registry.ancestryByRef[normalizeRef(ref)] || [normalizeRef(ref)]
      ).flatMap((ancestorRef) => {
        const refs = registry.nodeByRef[ancestorRef]?.content.requiredRelations;
        return Array.isArray(refs) ? refs.map(normalizeRef) : [];
      });

  const imageRefs = inheritedRequiredRefs.flatMap((requiredRef) => {
    if (!requiredRef.startsWith("prop:")) return [requiredRef];
    const selectedValueRefs = selectedValuesByProp[requiredRef] || [];
    return selectedValueRefs.length > 0
      ? selectedValueRefs.map(normalizeRef)
      : [requiredRef];
  });

  return imageRefs
    .map((imageRef) =>
      imageForRef(registry, imageRef, locale, seenImageUrls, seenRefs)
    )
    .filter((image): image is TaxonomyTileImage => Boolean(image))
    .slice(0, maxImages);
}

export function getTaxonomyTileImages(
  registry: TaxonomyRegistry,
  ref: string,
  localeOrOptions: string | TaxonomyTileImageOptions = "en",
  maxImagesArg: number = 4
): TaxonomyTileImage[] {
  const locale = typeof localeOrOptions === "string" ? localeOrOptions : "en";
  const options = typeof localeOrOptions === "string" ? {} : localeOrOptions;
  const maxImages = options.maxImages || maxImagesArg;
  const normalizedRef = normalizeRef(ref);
  if (!registry.nodeByRef[normalizedRef]) return [];

  const seenImageUrls = new Set<string>();
  const seenRefs = new Set<string>();
  const childRefs = (registry.childrenByRef[normalizedRef] || []).map(
    normalizeRef
  );

  const ownImage = imageForRef(
    registry,
    normalizedRef,
    locale,
    seenImageUrls,
    seenRefs
  );
  if (ownImage) return [ownImage];

  const directChildImages = childRefs
    .map((childRef) =>
      imageForRef(registry, childRef, locale, seenImageUrls, seenRefs)
    )
    .filter((image): image is TaxonomyTileImage => Boolean(image))
    .slice(0, maxImages);
  if (directChildImages.length > 0) return directChildImages;

  const requiredImages = requiredRelationImages(
    registry,
    normalizedRef,
    locale,
    maxImages,
    seenImageUrls,
    seenRefs,
    options.selectedValuesByProp,
    options.requiredRefs
  );
  if (requiredImages.length > 0) return requiredImages;

  const descendantImages = nearestDescendantImages(
    registry,
    normalizedRef,
    locale,
    maxImages,
    seenImageUrls,
    seenRefs
  );
  if (descendantImages.length > 0) return descendantImages;

  return [];
}

function meaningfulRequiredRelations(
  registry: TaxonomyRegistry,
  ref: string
): string[] {
  const node = registry.nodeByRef[normalizeRef(ref)];
  const refs = node?.content.requiredRelations || [];
  return refs
    .map(normalizeRef)
    .filter(Boolean)
    .filter((requiredRef) => !requiredRef.startsWith("prop:"))
    .filter((requiredRef) => Boolean(registry.nodeByRef[requiredRef]));
}

function nearestMeaningfulParent(
  registry: TaxonomyRegistry,
  ref: string
): string {
  const ancestry = registry.ancestryByRef[normalizeRef(ref)] || [];
  const candidates = ancestry
    .map(normalizeRef)
    .filter((ancestorRef) => ancestorRef !== normalizeRef(ref))
    .filter((ancestorRef) => !GENERIC_GROUP_REFS.has(ancestorRef))
    .filter(
      (ancestorRef) => registry.nodeByRef[ancestorRef]?.family === "thing"
    );
  return candidates[candidates.length - 1] || "";
}

export function aggregateTaxonomyBrowseRefs(
  registry: TaxonomyRegistry,
  refs: string[],
  options: TaxonomyBrowseOptions = {}
): string[] {
  const normalizedRefs = [
    ...new Set(
      refs.map(normalizeRef).filter((ref) => Boolean(registry.nodeByRef[ref]))
    ),
  ];
  const currentThingRef = options.currentThingRef
    ? normalizeRef(options.currentThingRef)
    : "";
  const withoutCurrentThing = (candidateRefs: string[]) =>
    currentThingRef
      ? candidateRefs.filter((ref) => ref !== currentThingRef)
      : candidateRefs;
  if (normalizedRefs.length <= 1) return withoutCurrentThing(normalizedRefs);

  const refsByParent = new Map<string, string[]>();
  for (const ref of normalizedRefs) {
    const parentRef = nearestMeaningfulParent(registry, ref);
    const key = parentRef || ref;
    refsByParent.set(key, [...(refsByParent.get(key) || []), ref]);
  }

  const aggregated = Array.from(refsByParent.entries()).map(
    ([parentRef, groupRefs]) => {
      if (groupRefs.length > 1 && registry.nodeByRef[parentRef])
        return parentRef;
      return groupRefs[0]!;
    }
  );

  const deduped = [...new Set(aggregated)].filter((ref) => {
    const ancestry = registry.ancestryByRef[ref] || [];
    return !aggregated.some(
      (candidateRef) => candidateRef !== ref && ancestry.includes(candidateRef)
    );
  });

  if (currentThingRef && deduped.includes(currentThingRef)) {
    return withoutCurrentThing(normalizedRefs);
  }

  return withoutCurrentThing(deduped);
}

function sortRefsByDisplayLabel(
  registry: TaxonomyRegistry,
  refs: string[],
  locale: string
): string[] {
  return refs
    .slice()
    .sort((a, b) =>
      getTaxonomyDisplayLabel(registry, a, locale, "category").localeCompare(
        getTaxonomyDisplayLabel(registry, b, locale, "category"),
        locale
      )
    );
}

function labelForRequiredPattern(
  registry: TaxonomyRegistry,
  refs: string[],
  locale: string
): string {
  return refs
    .map((ref) => getTaxonomyDisplayLabel(registry, ref, locale, "category"))
    .join(" / ");
}

export function groupTaxonomyBrowseRefs(
  registry: TaxonomyRegistry,
  refs: string[],
  locale: string = "en",
  options: TaxonomyBrowseOptions = {}
): TaxonomyBrowseGroup[] {
  const normalizedRefs = aggregateTaxonomyBrowseRefs(registry, refs, options);
  if (normalizedRefs.length <= 1) {
    return normalizedRefs.map((ref) => ({ key: ref, refs: [ref] }));
  }

  const requiredPatterns = normalizedRefs.map((ref) =>
    meaningfulRequiredRelations(registry, ref)
  );
  if (requiredPatterns.every((pattern) => pattern.length > 0)) {
    const groupsByPattern = new Map<string, string[]>();
    for (let index = 0; index < normalizedRefs.length; index += 1) {
      const pattern = requiredPatterns[index]!.slice().sort();
      const key = pattern.join("|");
      groupsByPattern.set(key, [
        ...(groupsByPattern.get(key) || []),
        normalizedRefs[index]!,
      ]);
    }
    return Array.from(groupsByPattern.entries()).map(([key, groupRefs]) => {
      const patternRefs = key.split("|").filter(Boolean);
      return {
        key: `required:${key}`,
        label: labelForRequiredPattern(registry, patternRefs, locale),
        refs: sortRefsByDisplayLabel(registry, groupRefs, locale),
      };
    });
  }

  const groupsByParent = new Map<string, string[]>();
  for (const ref of normalizedRefs) {
    const parentRef = nearestMeaningfulParent(registry, ref);
    const key = parentRef || ref;
    groupsByParent.set(key, [...(groupsByParent.get(key) || []), ref]);
  }

  const groups = Array.from(groupsByParent.entries()).map(
    ([key, groupRefs]) => ({
      key: `parent:${key}`,
      label:
        groupRefs.length > 1 && registry.nodeByRef[key]
          ? getTaxonomyDisplayLabel(registry, key, locale, "category")
          : undefined,
      refs: sortRefsByDisplayLabel(registry, groupRefs, locale),
    })
  );

  const singletonRefs = groups.flatMap((group) =>
    group.label ? [] : group.refs
  );
  const labeledGroups = groups.filter((group) => group.label);
  if (labeledGroups.length === 0) {
    return [
      {
        key: "browse:items",
        refs: sortRefsByDisplayLabel(registry, singletonRefs, locale),
      },
    ];
  }
  if (singletonRefs.length > 0) {
    return [
      ...labeledGroups,
      {
        key: "browse:items",
        refs: sortRefsByDisplayLabel(registry, singletonRefs, locale),
      },
    ];
  }
  return labeledGroups;
}

export function displayTaxonomyBrowseGroups(
  groups: TaxonomyBrowseGroup[]
): TaxonomyBrowseGroup[] {
  const nonEmptyGroups = groups.filter((group) => group.refs.length > 0);
  if (nonEmptyGroups.length === 0) return [];

  const groupingMeaningfullyImprovesBrowsing =
    nonEmptyGroups.length > 1 &&
    nonEmptyGroups.every(
      (group) => Boolean(group.label) && group.refs.length > 1
    );

  if (groupingMeaningfullyImprovesBrowsing) return nonEmptyGroups;

  const flattenedRefs = [
    ...new Set(nonEmptyGroups.flatMap((group) => group.refs)),
  ];
  return [{ key: "browse:items", refs: flattenedRefs }];
}
