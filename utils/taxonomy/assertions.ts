import {
  ProductTaxonomy,
  ProductTaxonomyLiteralAssertion,
  ProductTaxonomyRefAssertion,
  TaxonomyRegistry,
} from "@/utils/taxonomy/types";
import {
  createEmptyProductTaxonomy,
  normalizeTaxonomyRef,
} from "@/utils/taxonomy/registry";

export const TAXONOMY_TAG = "taxonomy";

export type TaxonomyListingTag = [string, string, ...string[]];

function isSegmentContextRef(ref: string): boolean {
  return normalizeTaxonomyRef(ref).startsWith("val:context:segment:");
}

function assertOnePrimarySegmentOverlay(taxonomy: ProductTaxonomy): void {
  const segmentRefs = (taxonomy.overlayValRefs || [])
    .map((ref) => normalizeTaxonomyRef(ref || ""))
    .filter(isSegmentContextRef);
  if (segmentRefs.length !== 1) {
    throw new Error(
      "Taxonostr listing taxonomy must include exactly one primary segment overlay."
    );
  }
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

export function encodeTaxonomyAssertions(
  taxonomy?: ProductTaxonomy
): TaxonomyListingTag[] {
  if (!taxonomy) return [];
  assertOnePrimarySegmentOverlay(taxonomy);

  const tags: TaxonomyListingTag[] = [];
  if (taxonomy.primaryThingRef) {
    tags.push([
      TAXONOMY_TAG,
      "thing",
      normalizeTaxonomyRef(taxonomy.primaryThingRef),
    ]);
  }
  for (const ref of taxonomy.overlayValRefs || []) {
    tags.push([TAXONOMY_TAG, "overlay", normalizeTaxonomyRef(ref)]);
  }
  for (const ref of taxonomy.requiredRefs || []) {
    tags.push([TAXONOMY_TAG, "required", normalizeTaxonomyRef(ref)]);
  }
  for (const assertion of taxonomy.refAssertions) {
    tags.push([
      TAXONOMY_TAG,
      "ref",
      normalizeTaxonomyRef(assertion.propRef),
      normalizeTaxonomyRef(assertion.valueRef),
    ]);
  }
  for (const assertion of taxonomy.literalAssertions) {
    tags.push([
      TAXONOMY_TAG,
      "literal",
      normalizeTaxonomyRef(assertion.propRef),
      assertion.valueTypeRef
        ? normalizeTaxonomyRef(assertion.valueTypeRef)
        : "",
      JSON.stringify(assertion.value),
    ]);
  }
  return tags;
}

export function getTaxonomyRefsForIndexing(
  taxonomy?: ProductTaxonomy
): string[] {
  if (!taxonomy) return [];
  return [
    taxonomy.primaryThingRef,
    ...(taxonomy.overlayValRefs || []),
    ...(taxonomy.requiredRefs || []),
    ...taxonomy.refAssertions.flatMap((assertion) => [
      assertion.propRef,
      assertion.valueRef,
    ]),
    ...taxonomy.literalAssertions.flatMap((assertion) => [
      assertion.propRef,
      assertion.valueTypeRef,
    ]),
  ]
    .map((ref) => normalizeTaxonomyRef(ref || ""))
    .filter(Boolean)
    .filter((ref, index, refs) => refs.indexOf(ref) === index);
}

export function encodeTaxonomyAddressTags(
  taxonomy: ProductTaxonomy | undefined,
  registry: TaxonomyRegistry | null | undefined
): Array<["a", string]> {
  if (!registry) return [];
  return getTaxonomyRefsForIndexing(taxonomy)
    .map((ref) => registry.nodeByRef[ref]?.coordinate || "")
    .filter(Boolean)
    .filter(
      (coordinate, index, coordinates) =>
        coordinates.indexOf(coordinate) === index
    )
    .map((coordinate) => ["a", coordinate]);
}

export function decodeTaxonomyAssertions(tags: string[][]): ProductTaxonomy {
  const taxonomy = createEmptyProductTaxonomy();

  for (const tag of tags) {
    if (tag[0] !== TAXONOMY_TAG) continue;
    const role = tag[1];
    switch (role) {
      case "thing":
        if (!taxonomy.primaryThingRef && tag[2])
          taxonomy.primaryThingRef = normalizeTaxonomyRef(tag[2]);
        break;
      case "overlay":
        if (tag[2]) taxonomy.overlayValRefs.push(normalizeTaxonomyRef(tag[2]));
        break;
      case "required":
        if (tag[2])
          taxonomy.requiredRefs = [
            ...(taxonomy.requiredRefs || []),
            normalizeTaxonomyRef(tag[2]),
          ];
        break;
      case "ref":
        if (tag[2] && tag[3]) {
          taxonomy.refAssertions.push({
            propRef: normalizeTaxonomyRef(tag[2]),
            valueRef: normalizeTaxonomyRef(tag[3]),
          } satisfies ProductTaxonomyRefAssertion);
        }
        break;
      case "literal":
        if (tag[2]) {
          taxonomy.literalAssertions.push({
            propRef: normalizeTaxonomyRef(tag[2]),
            valueTypeRef: tag[3] ? normalizeTaxonomyRef(tag[3]) : undefined,
            value: tag[4] ? safeParseJson(tag[4]) : null,
          } satisfies ProductTaxonomyLiteralAssertion);
        }
        break;
      default:
        break;
    }
  }

  taxonomy.overlayValRefs = [...new Set(taxonomy.overlayValRefs)];
  taxonomy.requiredRefs = [...new Set(taxonomy.requiredRefs || [])];
  return taxonomy;
}

export function getOverlayContextRefs(taxonomy?: ProductTaxonomy): string[] {
  return (taxonomy?.overlayValRefs || []).filter((ref) =>
    normalizeTaxonomyRef(ref).startsWith("val:context:")
  );
}

export function getOverlayBusinessFunctionRefs(
  taxonomy?: ProductTaxonomy
): string[] {
  return (taxonomy?.overlayValRefs || []).filter((ref) =>
    normalizeTaxonomyRef(ref).startsWith("val:business_function:")
  );
}
