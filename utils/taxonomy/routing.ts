import { normalizeRef } from "@/utils/taxonomy/registry";
import { uniqueRefs } from "@/utils/taxonomy/graph";
import {
  buildResolvedTaxonomyState,
  thingPath,
} from "@/utils/taxonomy/client-state";
import { isSameOrDescendant } from "@/utils/taxonomy/registry";
import { TaxonomyRegistry, TaxonomyState } from "@/utils/taxonomy/types";
import { ParsedUrlQuery } from "querystring";

export function buildMarketplaceHref({
  thingRef,
  contextRef,
  valueRefs,
  selectedValuesByProp,
}: {
  thingRef?: string;
  contextRef?: string;
  valueRefs?: string[];
  selectedValuesByProp?: Record<string, string[]>;
}): string {
  const query = new URLSearchParams();
  const normalizedThingRef = normalizeRef(thingRef || "");
  const normalizedContextRef = normalizeRef(contextRef || "");
  if (normalizedThingRef) query.set("thing", normalizedThingRef);
  if (normalizedContextRef) query.set("context", normalizedContextRef);
  for (const valueRef of uniqueRefs(valueRefs || []))
    query.append("value", valueRef);
  for (const [propRef, propValueRefs] of Object.entries(
    selectedValuesByProp || {}
  )) {
    const normalizedPropRef = normalizeRef(propRef);
    for (const valueRef of uniqueRefs(propValueRefs || [])) {
      query.append("pv", `${normalizedPropRef}|${valueRef}`);
    }
  }
  const queryString = query.toString();
  return queryString ? `/marketplace?${queryString}` : "/marketplace";
}

export type NormalizeMarketplaceUrlResult = {
  href: string;
  changed: boolean;
  diagnostics: string[];
};

const KNOWN_MARKETPLACE_PARAMS = new Set([
  "q",
  "search",
  "location",
  "sort",
  "page",
  "category",
  "categories",
  "legacyCategory",
  "legacy_category",
]);

function queryValues(value: string | string[] | undefined): string[] {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function firstQueryValue(value: string | string[] | undefined): string {
  return queryValues(value)[0] || "";
}

function decodeQueryRef(value: string): string {
  try {
    return normalizeRef(decodeURIComponent(value));
  } catch {
    return normalizeRef(value);
  }
}

function appendKnownMarketplaceParams(
  params: URLSearchParams,
  query: ParsedUrlQuery,
  options: { dropPage: boolean }
): void {
  for (const key of Object.keys(query).sort()) {
    if (!KNOWN_MARKETPLACE_PARAMS.has(key)) continue;
    if (options.dropPage && key === "page") continue;
    for (const value of queryValues(query[key])) {
      if (value) params.append(key, value);
    }
  }
}

function inferUniquePropForValue(
  registry: TaxonomyRegistry,
  valueRef: string
): string {
  const normalizedValueRef = normalizeRef(valueRef);
  const matchingPropRefs = Object.keys(registry.nodeByRef)
    .filter((ref) => registry.nodeByRef[ref]?.family === "prop")
    .filter((propRef) =>
      (registry.propRootsByRef[propRef] || []).some(
        (rootRef) =>
          normalizeRef(rootRef) === normalizedValueRef ||
          isSameOrDescendant(registry, normalizedValueRef, rootRef)
      )
    )
    .sort();
  return matchingPropRefs.length === 1 ? matchingPropRefs[0] || "" : "";
}

function marketplaceTaxonomyStateForRouting(
  registry: TaxonomyRegistry,
  thingRef: string,
  contextRef: string,
  selectedValuesByProp: Record<string, string[]>
): TaxonomyState {
  const normalizedContextRef = normalizeRef(contextRef);
  return {
    segmentRef: normalizedContextRef.startsWith("val:context:segment:")
      ? normalizedContextRef
      : null,
    thingRef: thingRef || null,
    thingPath: thingRef ? thingPath(thingRef, registry) : [],
    semanticContextRefs:
      normalizedContextRef &&
      !normalizedContextRef.startsWith("val:context:segment:")
        ? [normalizedContextRef]
        : [],
    selectedValuesByProp,
    selectedLiteralsByProp: {},
    quarantinedLegacyRefs: [],
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

function valueAllowedForCanonicalScope(params: {
  registry: TaxonomyRegistry;
  contextRef: string;
  thingRef: string;
  selectedValuesByProp: Record<string, string[]>;
  propRef: string;
  valueRef: string;
}): boolean {
  const {
    registry,
    contextRef,
    thingRef,
    selectedValuesByProp,
    propRef,
    valueRef,
  } = params;
  if (
    !registry.nodeByRef[propRef] ||
    registry.nodeByRef[propRef]?.family !== "prop"
  )
    return false;
  if (
    !registry.nodeByRef[valueRef] ||
    !valueMatchesPropRoot(registry, propRef, valueRef)
  )
    return false;
  if (!contextRef && !thingRef) return true;

  const state = marketplaceTaxonomyStateForRouting(
    registry,
    thingRef,
    contextRef,
    selectedValuesByProp
  );
  const resolved = buildResolvedTaxonomyState(state, registry);
  const availableValues = resolved.availableValues[propRef] || [];
  if (availableValues.length === 0) return true;
  return availableValues.some(
    (optionRef) =>
      normalizeRef(optionRef) === normalizeRef(valueRef) ||
      isSameOrDescendant(registry, valueRef, optionRef)
  );
}

function parsePvParam(
  value: string
): { propRef: string; valueRef: string } | null {
  const [rawPropRef, rawValueRef] = value.split("|");
  const propRef = rawPropRef ? decodeQueryRef(rawPropRef) : "";
  const valueRef = rawValueRef ? decodeQueryRef(rawValueRef) : "";
  return propRef && valueRef ? { propRef, valueRef } : null;
}

export function normalizeMarketplaceUrlQuery({
  pathname = "/marketplace",
  query,
  registry,
}: {
  pathname?: string;
  query: ParsedUrlQuery;
  registry?: TaxonomyRegistry | null;
}): NormalizeMarketplaceUrlResult {
  const diagnostics: string[] = [];
  if (!registry) {
    return {
      href: pathname,
      changed: false,
      diagnostics: ["registry unavailable"],
    };
  }

  const taxonRef = decodeQueryRef(firstQueryValue(query.taxon));
  let contextRef = decodeQueryRef(firstQueryValue(query.context));
  let thingRef = decodeQueryRef(firstQueryValue(query.thing));
  let forceListings = firstQueryValue(query.listings) === "1";

  if (taxonRef) {
    if (taxonRef.startsWith("thing:")) {
      if (registry.nodeByRef[taxonRef]) thingRef = taxonRef;
      else diagnostics.push(`Dropped unknown taxon thing ref: ${taxonRef}`);
    } else if (taxonRef.startsWith("val:context:")) {
      if (registry.nodeByRef[taxonRef]) contextRef = taxonRef;
      else diagnostics.push(`Dropped unknown taxon context ref: ${taxonRef}`);
    } else if (taxonRef.startsWith("val:")) {
      const propRef = inferUniquePropForValue(registry, taxonRef);
      if (propRef) {
        forceListings = true;
        query = {
          ...query,
          pv: [...queryValues(query.pv), `${propRef}|${taxonRef}`],
        };
      } else {
        diagnostics.push(
          `Dropped ambiguous or unrecognized taxon value ref: ${taxonRef}`
        );
      }
    } else if (taxonRef.startsWith("prop:")) {
      diagnostics.push(
        `Dropped taxon prop ref; prop focus is not a browse scope: ${taxonRef}`
      );
    } else {
      diagnostics.push(`Dropped unsupported taxon ref: ${taxonRef}`);
    }
  }

  if (
    contextRef &&
    (!contextRef.startsWith("val:context:") || !registry.nodeByRef[contextRef])
  ) {
    diagnostics.push(`Dropped invalid context ref: ${contextRef}`);
    contextRef = "";
  }
  if (
    thingRef &&
    (!thingRef.startsWith("thing:") || !registry.nodeByRef[thingRef])
  ) {
    diagnostics.push(`Dropped invalid thing ref: ${thingRef}`);
    thingRef = "";
  }

  const selectedValuesByProp: Record<string, string[]> = {};
  let droppedPv = false;
  for (const pair of queryValues(query.pv).flatMap(
    (value) => parsePvParam(value) || []
  )) {
    const probeSelectedValues = {
      ...selectedValuesByProp,
      [pair.propRef]: uniqueRefs([
        ...(selectedValuesByProp[pair.propRef] || []),
        pair.valueRef,
      ]),
    };
    if (
      valueAllowedForCanonicalScope({
        registry,
        contextRef,
        thingRef,
        selectedValuesByProp: probeSelectedValues,
        propRef: pair.propRef,
        valueRef: pair.valueRef,
      })
    ) {
      selectedValuesByProp[pair.propRef] =
        probeSelectedValues[pair.propRef] || [];
    } else {
      droppedPv = true;
      diagnostics.push(`Dropped invalid pv: ${pair.propRef}|${pair.valueRef}`);
    }
  }

  const params = new URLSearchParams();
  appendKnownMarketplaceParams(params, query, { dropPage: droppedPv });
  if (contextRef) params.set("context", contextRef);
  if (thingRef) params.set("thing", thingRef);
  if (forceListings) params.set("listings", "1");
  const sortedPairs = Object.entries(selectedValuesByProp)
    .flatMap(([propRef, valueRefs]) =>
      uniqueRefs(valueRefs).map((valueRef) => ({ propRef, valueRef }))
    )
    .sort(
      (a, b) =>
        a.propRef.localeCompare(b.propRef) ||
        a.valueRef.localeCompare(b.valueRef)
    );
  for (const pair of sortedPairs)
    params.append("pv", `${pair.propRef}|${pair.valueRef}`);

  const queryString = params.toString();
  const href = queryString ? `${pathname}?${queryString}` : pathname;

  const currentParams = new URLSearchParams();
  appendKnownMarketplaceParams(currentParams, query, { dropPage: false });
  if (firstQueryValue(query.context))
    currentParams.set("context", firstQueryValue(query.context));
  if (firstQueryValue(query.thing))
    currentParams.set("thing", firstQueryValue(query.thing));
  if (firstQueryValue(query.listings) === "1")
    currentParams.set("listings", "1");
  for (const pv of queryValues(query.pv)) currentParams.append("pv", pv);
  const currentQueryString = currentParams.toString();
  const currentHref = currentQueryString
    ? `${pathname}?${currentQueryString}`
    : pathname;

  return {
    href,
    changed: href !== currentHref || Boolean(taxonRef),
    diagnostics,
  };
}

export function taxonomyHref(
  ref: string,
  options: {
    activeContextRef?: string;
    selectedThingRef?: string;
    selectedContextRef?: string;
    selectedValuesByProp?: Record<string, string[]>;
  } = {}
): string {
  const normalizedRef = normalizeRef(ref);
  if (normalizedRef.startsWith("thing:")) {
    return buildMarketplaceHref({
      thingRef: normalizedRef,
      contextRef: options.activeContextRef || "",
      selectedValuesByProp: options.selectedValuesByProp,
    });
  }
  if (normalizedRef.startsWith("val:context:")) {
    if (options.selectedThingRef && !options.selectedContextRef) {
      return buildMarketplaceHref({
        thingRef: options.selectedThingRef,
        contextRef: normalizedRef,
        selectedValuesByProp: options.selectedValuesByProp,
      });
    }
    return buildMarketplaceHref({
      contextRef: normalizedRef,
      selectedValuesByProp: options.selectedValuesByProp,
    });
  }
  return `/marketplace?taxon=${encodeURIComponent(normalizedRef)}`;
}

export function taxonomySuggestionHref(ref: string): string {
  return taxonomyHref(ref);
}
