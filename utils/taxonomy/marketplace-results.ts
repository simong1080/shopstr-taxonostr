import { nip19 } from "nostr-tools";
import { ProductData } from "@/utils/parsers/product-parser-functions";
import {
  isSameOrDescendant,
  normalizeTaxonomyRef,
} from "@/utils/taxonomy/registry";
import { getTaxonomyDisplayLabel } from "@/utils/taxonomy/display";
import {
  MarketplaceScopeState,
  shouldShowListingsForScope,
} from "@/utils/taxonomy/marketplace-scope";
import {
  getInheritedRequiredRelations,
  isContextRef,
  uniqueRefs,
} from "@/utils/taxonomy/graph";
import {
  ProductTaxonomyRefAssertion,
  TaxonomyRegistry,
} from "@/utils/taxonomy/types";
import { buildEffectiveListingTaxonomyFacts } from "@/utils/taxonomy/listing-facts";

export type MarketplaceFacetFilter = {
  propRef: string;
  label: string;
  values: Array<[string, string]>;
  valueKind: "ref" | "literal" | "mixed";
  booleanTrueOnly: boolean;
};

export type MarketplacePromotedFacetSection = {
  propRef: string;
  valueRefs: string[];
};

export type MarketplaceSelectedFacetChip = {
  propRef: string;
  valueRef: string;
  label: string;
  valueLabel: string;
  source: "explicit" | "scope" | "derived";
  derivedFrom?: string[];
  removable: boolean;
};

export type MarketplaceResultsViewModel = {
  filteredProducts: ProductData[];
  scopedListingProducts: ProductData[];
  baseScopeResultCount: number;
  filteredResultCount: number;
  actualFacetFilters: MarketplaceFacetFilter[];
  promotedFacetSections: MarketplacePromotedFacetSection[];
  selectedFacetChips: MarketplaceSelectedFacetChip[];
};

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function uniqueRefAssertions(
  assertions: ProductTaxonomyRefAssertion[]
): ProductTaxonomyRefAssertion[] {
  const seen = new Set<string>();
  const uniqueAssertions: ProductTaxonomyRefAssertion[] = [];
  for (const assertion of assertions) {
    const propRef = normalizeTaxonomyRef(assertion.propRef);
    const valueRef = normalizeTaxonomyRef(assertion.valueRef);
    if (!propRef || !valueRef) continue;
    const key = `${propRef}\u0000${valueRef}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueAssertions.push({ propRef, valueRef });
  }
  return uniqueAssertions;
}

function propRefsForValue(
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

function graphLinkedValueRefs(
  registry: TaxonomyRegistry,
  valueRef: string
): string[] {
  const ancestryRefs = registry.ancestryByRef[
    normalizeTaxonomyRef(valueRef)
  ] || [normalizeTaxonomyRef(valueRef)];
  return uniqueRefs([
    ...ancestryRefs.flatMap(
      (ref) => registry.relationsByRef[normalizeTaxonomyRef(ref)] || []
    ),
    ...ancestryRefs.flatMap(
      (ref) =>
        registry.nodeByRef[normalizeTaxonomyRef(ref)]?.content.relations || []
    ),
    ...ancestryRefs.flatMap((ref) =>
      getInheritedRequiredRelations(registry, ref)
    ),
  ]).filter((ref) => {
    if (
      isContextRef(ref) ||
      ref.startsWith("prop:") ||
      ref.startsWith("valtype:")
    )
      return false;
    const node = registry.nodeByRef[ref];
    return node?.family === "thing" || node?.family === "val";
  });
}

function propIsActivationAncestor(
  registry: TaxonomyRegistry,
  ancestorPropRef: string,
  childPropRef: string
): boolean {
  const normalizedAncestorPropRef = normalizeTaxonomyRef(ancestorPropRef);
  const normalizedChildPropRef = normalizeTaxonomyRef(childPropRef);
  if (!normalizedAncestorPropRef || !normalizedChildPropRef) return false;
  const visited = new Set<string>();
  const queue = [normalizedChildPropRef];
  let head = 0;

  while (head < queue.length) {
    const currentPropRef = queue[head++]!;
    if (visited.has(currentPropRef)) continue;
    visited.add(currentPropRef);
    const authoredParentPropRefs = Object.entries(registry.relationsByRef)
      .filter(([, relationRefs]) =>
        relationRefs.map(normalizeTaxonomyRef).includes(currentPropRef)
      )
      .map(([sourceRef]) => normalizeTaxonomyRef(sourceRef))
      .filter((sourceRef) => registry.nodeByRef[sourceRef]?.family === "prop");
    const parentPropRefs = (registry.reverseRefsByRef[currentPropRef] || [])
      .filter(
        (reverseRef) =>
          reverseRef.field === "relations" ||
          reverseRef.field === "requiredRelations"
      )
      .map((reverseRef) => normalizeTaxonomyRef(reverseRef.sourceRef))
      .filter((sourceRef) => registry.nodeByRef[sourceRef]?.family === "prop");
    const allParentPropRefs = uniqueRefs([
      ...parentPropRefs,
      ...authoredParentPropRefs,
    ]);
    if (allParentPropRefs.includes(normalizedAncestorPropRef)) return true;
    queue.push(...allParentPropRefs);
  }

  return false;
}

export function deriveFilterImplications(
  registry: TaxonomyRegistry,
  assertions: ProductTaxonomyRefAssertion[]
): ProductTaxonomyRefAssertion[] {
  const seeds = uniqueRefAssertions(assertions);
  const knownKeys = new Set(
    seeds.map((assertion) => `${assertion.propRef}\u0000${assertion.valueRef}`)
  );
  const derived: ProductTaxonomyRefAssertion[] = [];
  const queue = [...seeds];
  let head = 0;
  const maxSteps = Math.max(16, Object.keys(registry.nodeByRef).length * 2);

  while (head < queue.length && head < maxSteps) {
    const source = queue[head++]!;
    for (const linkedRef of graphLinkedValueRefs(registry, source.valueRef)) {
      const propRefs = propRefsForValue(registry, linkedRef);
      if (propRefs.length !== 1) continue;
      const propRef = propRefs[0]!;
      if (propRef === source.propRef) continue;
      if (!propIsActivationAncestor(registry, propRef, source.propRef))
        continue;
      const key = `${propRef}\u0000${linkedRef}`;
      if (knownKeys.has(key)) continue;
      knownKeys.add(key);
      const assertion = { propRef, valueRef: linkedRef };
      derived.push(assertion);
      queue.push(assertion);
    }
  }

  return derived;
}

function mergeSelectedValuesByProp(
  assertions: ProductTaxonomyRefAssertion[]
): Record<string, string[]> {
  const selectedValuesByProp: Record<string, string[]> = {};
  for (const assertion of assertions) {
    const propRef = normalizeTaxonomyRef(assertion.propRef);
    const valueRef = normalizeTaxonomyRef(assertion.valueRef);
    if (!propRef || !valueRef) continue;
    selectedValuesByProp[propRef] = uniqueRefs([
      ...(selectedValuesByProp[propRef] || []),
      valueRef,
    ]);
  }
  return selectedValuesByProp;
}

function taxonomyValueRefsForProduct(productData: ProductData): string[] {
  return [
    ...(productData.taxonomy?.overlayValRefs || []),
    ...(productData.taxonomy?.requiredRefs || []),
    ...(productData.taxonomy?.refAssertions || []).map(
      (assertion) => assertion.valueRef
    ),
  ];
}

function observedRefFacetValuesForProduct(
  productData: ProductData,
  registry?: TaxonomyRegistry | null
): Array<{ propRef: string; valueRef: string }> {
  const facts = buildEffectiveListingTaxonomyFacts(
    productData.taxonomy,
    registry
  );
  const assertions = registry
    ? uniqueRefAssertions([
        ...facts.refAssertions,
        ...deriveFilterImplications(registry, facts.refAssertions),
      ])
    : facts.refAssertions;
  return assertions.map((assertion) => ({
    propRef: normalizeTaxonomyRef(assertion.propRef),
    valueRef: normalizeTaxonomyRef(assertion.valueRef),
  }));
}

function observedLiteralFacetValuesForProduct(
  productData: ProductData,
  registry?: TaxonomyRegistry | null
): Array<{ propRef: string; value: string }> {
  const facts = buildEffectiveListingTaxonomyFacts(
    productData.taxonomy,
    registry
  );
  return facts.literalAssertions.map((assertion) => ({
    propRef: normalizeTaxonomyRef(assertion.propRef),
    value: String(assertion.value),
  }));
}

function productSatisfiesCategoryFilter(
  productData: ProductData,
  selectedCategories: Set<string>
): boolean {
  if (selectedCategories.size === 0) return true;
  if (productData.taxonomy) return true;
  const normalizedCategories = (productData.categories || []).map((category) =>
    category.toLowerCase()
  );
  return Array.from(selectedCategories).some((selectedCategory) =>
    normalizedCategories.some((category) =>
      category.includes(selectedCategory.toLowerCase())
    )
  );
}

function productSatisfiesLocationFilter(
  productData: ProductData,
  selectedLocation: string
): boolean {
  return !selectedLocation || productData.location === selectedLocation;
}

function productSatisfiesSearchFilter(
  productData: ProductData,
  selectedSearch: string
): boolean {
  if (!selectedSearch) return true;
  if (!productData.title) return false;

  if (selectedSearch.includes("naddr")) {
    try {
      const parsedNaddr = nip19.decode(selectedSearch);
      return parsedNaddr.type === "naddr"
        ? productData.d === parsedNaddr.data.identifier &&
            productData.pubkey === parsedNaddr.data.pubkey
        : false;
    } catch {
      return false;
    }
  }

  if (selectedSearch.includes("npub")) {
    try {
      const parsedNpub = nip19.decode(selectedSearch);
      return parsedNpub.type === "npub"
        ? parsedNpub.data === productData.pubkey
        : false;
    } catch {
      return false;
    }
  }

  const normalizedSearch = selectedSearch.toLowerCase();
  if (productData.title.toLowerCase().includes(normalizedSearch)) return true;
  if (productData.summary?.toLowerCase().includes(normalizedSearch))
    return true;
  const numericSearch = parseFloat(selectedSearch);
  return !isNaN(numericSearch) && productData.price === numericSearch;
}

function productSatisfiesTaxonomyScope(params: {
  productData: ProductData;
  registry?: TaxonomyRegistry | null;
  scopeState: MarketplaceScopeState;
  selectedCategories: Set<string>;
  selectedLocation: string;
  selectedSearch: string;
}): boolean {
  const {
    productData,
    registry,
    scopeState,
    selectedCategories,
    selectedLocation,
    selectedSearch,
  } = params;
  const selectedThingRef = scopeState.thingRef;
  const selectedContextRef = scopeState.contextRef;

  return (
    productSatisfiesCategoryFilter(productData, selectedCategories) &&
    productSatisfiesLocationFilter(productData, selectedLocation) &&
    productSatisfiesSearchFilter(productData, selectedSearch) &&
    (!selectedThingRef || !registry
      ? true
      : Boolean(
          productData.taxonomy?.primaryThingRef &&
          isSameOrDescendant(
            registry,
            productData.taxonomy.primaryThingRef,
            selectedThingRef
          )
        )) &&
    (!selectedContextRef || !registry
      ? true
      : taxonomyValueRefsForProduct(productData).some(
          (ref) => ref && isSameOrDescendant(registry, ref, selectedContextRef)
        ))
  );
}

export function productSatisfiesSelectedAspectFilters(
  productData: ProductData,
  filters: Record<string, string>,
  registry?: TaxonomyRegistry | null
): boolean {
  return Object.entries(filters).every(([propRef, valueRef]) => {
    if (!valueRef) return true;
    return (
      observedRefFacetValuesForProduct(productData, registry).some(
        (assertion) =>
          normalizeTaxonomyRef(assertion.propRef) ===
            normalizeTaxonomyRef(propRef) &&
          registry &&
          isSameOrDescendant(registry, assertion.valueRef, valueRef)
      ) ||
      observedLiteralFacetValuesForProduct(productData, registry).some(
        (assertion) =>
          normalizeTaxonomyRef(assertion.propRef) ===
            normalizeTaxonomyRef(propRef) &&
          String(assertion.value) === valueRef
      )
    );
  });
}

function productSatisfiesSelectedScopeValues(
  productData: ProductData,
  selectedValuesByProp: Record<string, string[]>,
  registry?: TaxonomyRegistry | null,
  excludedPropRef = ""
): boolean {
  if (!registry) return true;
  return Object.entries(selectedValuesByProp).every(([propRef, valueRefs]) => {
    const normalizedPropRef = normalizeTaxonomyRef(propRef);
    if (
      excludedPropRef &&
      normalizedPropRef === normalizeTaxonomyRef(excludedPropRef)
    )
      return true;
    const normalizedValueRefs = uniqueRefs(valueRefs.map(normalizeTaxonomyRef));
    if (normalizedValueRefs.length === 0) return true;
    return normalizedValueRefs.some((selectedValueRef) =>
      observedRefFacetValuesForProduct(productData, registry).some(
        (assertion) =>
          normalizeTaxonomyRef(assertion.propRef) === normalizedPropRef &&
          isSameOrDescendant(registry, assertion.valueRef, selectedValueRef)
      )
    );
  });
}

function productIsVisibleListing(
  product: ProductData,
  focusedPubkey?: string,
  userPubkey?: string
): boolean {
  if (focusedPubkey && product.pubkey !== focusedPubkey) return false;
  if (!product.currency) return false;
  if (product.images.length === 0) return false;
  if (product.contentWarning) return false;
  if (
    product.pubkey ===
      "3da2082b7aa5b76a8f0c134deab3f7848c3b5e3a3079c65947d88422b69c1755" &&
    userPubkey !== product.pubkey
  ) {
    return false;
  }
  return true;
}

export function buildMarketplaceResultsViewModel(params: {
  products: ProductData[];
  registry?: TaxonomyRegistry | null;
  scopeState: MarketplaceScopeState;
  selectedCategories: Set<string>;
  selectedLocation: string;
  selectedSearch: string;
  selectedAspectFilters: Record<string, string>;
  focusedPubkey?: string;
  userPubkey?: string;
  locale: string;
}): MarketplaceResultsViewModel {
  const {
    products,
    registry,
    scopeState,
    selectedCategories,
    selectedLocation,
    selectedSearch,
    selectedAspectFilters,
    focusedPubkey,
    userPubkey,
    locale,
  } = params;
  const shouldShowListings = shouldShowListingsForScope(scopeState);
  const visibleListingProducts = shouldShowListings
    ? products.filter((product) =>
        productIsVisibleListing(product, focusedPubkey, userPubkey)
      )
    : [];

  const scopedListingProducts = shouldShowListings
    ? visibleListingProducts.filter((product) => {
        return productSatisfiesTaxonomyScope({
          productData: product,
          registry,
          scopeState,
          selectedCategories,
          selectedLocation,
          selectedSearch,
        });
      })
    : [];

  const explicitFacetAssertions = registry
    ? Object.entries(scopeState.selectedValuesByProp).flatMap(
        ([propRef, valueRefs]) =>
          uniqueRefs(valueRefs.map(normalizeTaxonomyRef)).map((valueRef) => ({
            propRef: normalizeTaxonomyRef(propRef),
            valueRef,
          }))
      )
    : [];
  const scopeFacetAssertions = registry
    ? buildEffectiveListingTaxonomyFacts(
        {
          primaryThingRef: scopeState.thingRef || "",
          overlayValRefs: scopeState.contextRef ? [scopeState.contextRef] : [],
          requiredRefs: [],
          refAssertions: [],
          literalAssertions: [],
        },
        registry
      ).refAssertions
    : [];
  const selectedFacetAssertionsFor = (excludedPropRef = "") => {
    if (!registry) return [];
    const normalizedExcludedPropRef = normalizeTaxonomyRef(excludedPropRef);
    const baseAssertions = uniqueRefAssertions([
      ...explicitFacetAssertions,
      ...scopeFacetAssertions,
    ]).filter((assertion) => assertion.propRef !== normalizedExcludedPropRef);
    return uniqueRefAssertions([
      ...baseAssertions,
      ...deriveFilterImplications(registry, baseAssertions),
    ]).filter((assertion) => assertion.propRef !== normalizedExcludedPropRef);
  };
  const activeSelectedValuesByProp = mergeSelectedValuesByProp(
    selectedFacetAssertionsFor()
  );

  const scopeFilteredListingProducts = scopedListingProducts.filter((product) =>
    productSatisfiesSelectedScopeValues(
      product,
      activeSelectedValuesByProp,
      registry
    )
  );

  const scopedProductsForFilterOptions = (excludedPropRef: string) => {
    const selectedValuesForOptions = mergeSelectedValuesByProp(
      selectedFacetAssertionsFor(excludedPropRef)
    );
    const filters = Object.fromEntries(
      Object.entries(selectedAspectFilters).filter(
        ([propRef]) => propRef !== excludedPropRef
      )
    );
    return scopedListingProducts.filter((product) => {
      if (
        !productSatisfiesSelectedScopeValues(
          product,
          selectedValuesForOptions,
          registry,
          excludedPropRef
        )
      ) {
        return false;
      }
      return productSatisfiesSelectedAspectFilters(product, filters, registry);
    });
  };

  const selectedFacetChips: MarketplaceSelectedFacetChip[] = registry
    ? explicitFacetAssertions.map((assertion) => ({
        propRef: assertion.propRef,
        valueRef: assertion.valueRef,
        label: getTaxonomyDisplayLabel(
          registry,
          assertion.propRef,
          locale,
          "category"
        ),
        valueLabel: getTaxonomyDisplayLabel(
          registry,
          assertion.valueRef,
          locale,
          "category"
        ),
        source: "explicit" as const,
        removable: true,
      }))
    : [];
  if (registry) {
    const explicitChipKeys = new Set(
      selectedFacetChips.map((chip) => `${chip.propRef}\u0000${chip.valueRef}`)
    );
    const scopeChipKeys = new Set<string>();
    for (const assertion of scopeFacetAssertions) {
      const propRef = normalizeTaxonomyRef(assertion.propRef);
      const valueRef = normalizeTaxonomyRef(assertion.valueRef);
      const key = `${propRef}\u0000${valueRef}`;
      if (explicitChipKeys.has(key)) continue;
      scopeChipKeys.add(key);
      selectedFacetChips.push({
        propRef,
        valueRef,
        label: getTaxonomyDisplayLabel(registry, propRef, locale, "category"),
        valueLabel: getTaxonomyDisplayLabel(
          registry,
          valueRef,
          locale,
          "category"
        ),
        source: "scope",
        removable: false,
      });
    }
    const baseChipAssertions = uniqueRefAssertions([
      ...explicitFacetAssertions,
      ...scopeFacetAssertions,
    ]);
    for (const assertion of deriveFilterImplications(
      registry,
      baseChipAssertions
    )) {
      const propRef = normalizeTaxonomyRef(assertion.propRef);
      const valueRef = normalizeTaxonomyRef(assertion.valueRef);
      const key = `${propRef}\u0000${valueRef}`;
      if (explicitChipKeys.has(key) || scopeChipKeys.has(key)) continue;
      selectedFacetChips.push({
        propRef,
        valueRef,
        label: getTaxonomyDisplayLabel(registry, propRef, locale, "category"),
        valueLabel: getTaxonomyDisplayLabel(
          registry,
          valueRef,
          locale,
          "category"
        ),
        source: "derived",
        derivedFrom: baseChipAssertions.map(
          (baseAssertion) =>
            `${baseAssertion.propRef}|${baseAssertion.valueRef}`
        ),
        removable: false,
      });
    }
  }

  const observedRefPropRefs = uniqueStrings(
    scopedListingProducts.flatMap((product) =>
      observedRefFacetValuesForProduct(product, registry).map(
        (assertion) => assertion.propRef
      )
    )
  );
  const observedLiteralPropRefs = uniqueStrings(
    scopedListingProducts.flatMap((product) =>
      observedLiteralFacetValuesForProduct(product, registry).map(
        (assertion) => assertion.propRef
      )
    )
  );
  const observedPropRefs = uniqueStrings([
    ...observedRefPropRefs,
    ...observedLiteralPropRefs,
  ]);

  const actualFacetFilters =
    registry && shouldShowListings && scopedListingProducts.length > 0
      ? (() => {
          const propRefs = observedPropRefs;

          const filters = propRefs.map((propRef) => {
            const sourceProducts = scopedProductsForFilterOptions(propRef);
            const observedRefValues = uniqueStrings(
              sourceProducts.flatMap((product) =>
                observedRefFacetValuesForProduct(product, registry)
                  .filter((assertion) => assertion.propRef === propRef)
                  .map((assertion) => assertion.valueRef)
              )
            );
            const observedLiteralValues = uniqueStrings(
              sourceProducts.flatMap((product) =>
                observedLiteralFacetValuesForProduct(product, registry)
                  .filter((assertion) => assertion.propRef === propRef)
                  .map((assertion) => assertion.value)
              )
            );
            const registryKnownRefValues = observedRefValues.filter(
              (valueRef) => Boolean(registry.nodeByRef[valueRef])
            );
            const values = [
              ...new Map([
                ...registryKnownRefValues
                  .filter(() => Boolean(registry.nodeByRef[propRef]))
                  .map(
                    (valueRef) =>
                      [
                        valueRef,
                        getTaxonomyDisplayLabel(
                          registry,
                          valueRef,
                          locale,
                          "category"
                        ),
                      ] as const
                  ),
                ...observedLiteralValues
                  .filter(() => Boolean(registry.nodeByRef[propRef]))
                  .map((value) => [value, value] as const),
              ]).entries(),
            ].sort((a, b) => a[1].localeCompare(b[1], locale));

            const hasRefValues = sourceProducts.some((product) =>
              observedRefFacetValuesForProduct(product, registry).some(
                (assertion) => assertion.propRef === propRef
              )
            );
            const hasLiteralValues = sourceProducts.some((product) =>
              observedLiteralFacetValuesForProduct(product, registry).some(
                (assertion) => assertion.propRef === propRef
              )
            );
            const valueKind: MarketplaceFacetFilter["valueKind"] =
              hasRefValues && hasLiteralValues
                ? "mixed"
                : hasRefValues
                  ? "ref"
                  : "literal";
            const booleanTrueOnly =
              valueKind === "literal" &&
              values.length === 1 &&
              values[0]?.[0] === "true";

            return {
              propRef,
              label: getTaxonomyDisplayLabel(
                registry,
                propRef,
                locale,
                "category"
              ),
              values,
              valueKind,
              booleanTrueOnly,
            };
          });

          return filters.filter((filter) => filter.values.length > 0);
        })()
      : [];

  const promotedFacetSections: MarketplacePromotedFacetSection[] = [];

  const filteredProducts = shouldShowListings
    ? scopeFilteredListingProducts.filter((product) =>
        productSatisfiesSelectedAspectFilters(
          product,
          selectedAspectFilters,
          registry
        )
      )
    : [];
  return {
    filteredProducts,
    scopedListingProducts,
    baseScopeResultCount: scopedListingProducts.length,
    filteredResultCount: filteredProducts.length,
    actualFacetFilters,
    promotedFacetSections,
    selectedFacetChips,
  };
}
