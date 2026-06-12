import { useContext, useMemo } from "react";
import Link from "next/link";
import { ProductData } from "@/utils/parsers/product-parser-functions";
import { SiteLanguageContext, TaxonomyContext } from "@/utils/context/context";
import {
  getTaxonomyNodeLabel,
  normalizeTaxonomyRef,
} from "@/utils/taxonomy/registry";
import { getTaxonomyDisplayLabel } from "@/utils/taxonomy/display";
import { taxonomyHref } from "@/utils/taxonomy/routing";
import {
  isContextRef,
  isSegmentContextRef,
  uniqueRefs,
} from "@/utils/taxonomy/graph";
import { buildEffectiveListingTaxonomyFacts } from "@/utils/taxonomy/listing-facts";
import MarketplaceBreadcrumbs from "@/components/marketplace/marketplace-breadcrumbs";
import { TaxonomyPill } from "@/components/utility-components/taxonomy-chip";

const GENERIC_THING_REFS = new Set([
  "thing",
  "thing:good",
  "thing:artifact",
  "thing:service",
  "thing:organization",
  "thing:game",
  "thing:vehicle",
  "thing:real_estate",
]);

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function isBusinessFunctionRef(ref: string): boolean {
  return normalizeTaxonomyRef(ref).startsWith("val:business_function:");
}

export default function TaxonomySummary({
  productData,
  compact = false,
  showImages = true,
  maxOverlayChips,
  breadcrumbOnly = false,
  hideBreadcrumb = false,
  className = "",
}: {
  productData: ProductData;
  compact?: boolean;
  showImages?: boolean;
  maxOverlayChips?: number;
  breadcrumbOnly?: boolean;
  hideBreadcrumb?: boolean;
  className?: string;
}) {
  const { registry } = useContext(TaxonomyContext);
  const { siteLanguage } = useContext(SiteLanguageContext);
  const taxonomy = productData.taxonomy;

  const primaryThingRef = taxonomy?.primaryThingRef
    ? normalizeTaxonomyRef(taxonomy.primaryThingRef)
    : "";
  const overlayRefs = (taxonomy?.overlayValRefs || [])
    .concat(taxonomy?.requiredRefs || [])
    .map(normalizeTaxonomyRef)
    .filter((ref) => !isBusinessFunctionRef(ref));

  const breadcrumbRefs = useMemo(() => {
    if (!registry || !taxonomy) return [];
    const segmentPathRefs = overlayRefs
      .filter(isSegmentContextRef)
      .flatMap((ref) => registry.ancestryByRef[ref] || [ref])
      .map(normalizeTaxonomyRef)
      .filter(isSegmentContextRef)
      .filter((ref) => ref !== "val:context:segment");
    const thingPathRefs = primaryThingRef
      ? (registry.ancestryByRef[primaryThingRef] || [primaryThingRef])
          .map(normalizeTaxonomyRef)
          .filter((ref) => !GENERIC_THING_REFS.has(ref))
      : [];
    return uniqueRefs([...segmentPathRefs, ...thingPathRefs]);
  }, [overlayRefs, primaryThingRef, registry, taxonomy]);

  const imageRefs = useMemo(() => {
    if (!registry || !taxonomy) return [];
    const maxImages =
      maxOverlayChips || (compact ? 5 : Number.MAX_SAFE_INTEGER);
    return uniqueRefs(
      [
        primaryThingRef,
        ...overlayRefs,
        ...taxonomy.refAssertions.map((assertion) =>
          normalizeTaxonomyRef(assertion.valueRef)
        ),
      ]
        .filter((ref) => !isBusinessFunctionRef(ref))
        .filter((ref) => Boolean(registry.imageByRef[ref]))
    ).slice(0, maxImages);
  }, [
    compact,
    maxOverlayChips,
    overlayRefs,
    primaryThingRef,
    registry,
    taxonomy,
  ]);

  const chipRefs = useMemo(() => {
    if (!registry || !taxonomy) return [];
    const maxChips = maxOverlayChips || (compact ? 5 : Number.MAX_SAFE_INTEGER);
    return uniqueRefs([
      ...imageRefs,
      ...overlayRefs.filter(isContextRef),
      ...taxonomy.refAssertions
        .map((assertion) => normalizeTaxonomyRef(assertion.valueRef))
        .filter(isContextRef),
    ]).slice(0, maxChips);
  }, [compact, imageRefs, maxOverlayChips, overlayRefs, registry, taxonomy]);

  const totalChipRefCount = useMemo(() => {
    if (!registry || !taxonomy) return 0;
    return uniqueRefs(
      [
        primaryThingRef,
        ...overlayRefs,
        ...taxonomy.refAssertions.map((assertion) =>
          normalizeTaxonomyRef(assertion.valueRef)
        ),
      ]
        .filter((ref) => !isBusinessFunctionRef(ref))
        .filter((ref) => Boolean(registry.imageByRef[ref]) || isContextRef(ref))
    ).length;
  }, [overlayRefs, primaryThingRef, registry, taxonomy]);

  const valueRows = useMemo(() => {
    if (!registry || !taxonomy) return [];
    const chipRefSet = new Set(chipRefs);
    const facts = buildEffectiveListingTaxonomyFacts(taxonomy, registry);
    const refRows = facts.refAssertions
      .map((assertion) => ({
        key: `${assertion.propRef}:${assertion.valueRef}`,
        label: getTaxonomyNodeLabel(registry, assertion.propRef, siteLanguage),
        value: getTaxonomyNodeLabel(registry, assertion.valueRef, siteLanguage),
        valueRef: normalizeTaxonomyRef(assertion.valueRef),
      }))
      .filter((row) => !chipRefSet.has(row.valueRef));
    const literalRows = facts.literalAssertions.map((assertion) => ({
      key: `${assertion.propRef}:${String(assertion.value)}`,
      label: getTaxonomyNodeLabel(registry, assertion.propRef, siteLanguage),
      value:
        typeof assertion.value === "boolean"
          ? assertion.value
            ? "Yes"
            : "No"
          : String(assertion.value),
      valueRef: "",
    }));
    return [...refRows, ...literalRows];
  }, [chipRefs, registry, siteLanguage, taxonomy]);

  if (!registry || !taxonomy) return null;

  const breadcrumbBlock =
    breadcrumbRefs.length > 0 && !hideBreadcrumb ? (
      <div className="border-default-200/70 bg-default-50/70 dark:border-default-700/70 dark:bg-default-900/20 rounded-xl border px-4 py-3">
        <p className="text-default-500 text-xs font-semibold tracking-wide uppercase">
          Category path
        </p>
        <div className="text-default-700 dark:text-default-300 mt-2 flex flex-wrap items-center gap-2 text-sm">
          <MarketplaceBreadcrumbs
            refs={breadcrumbRefs}
            rootLabel="Marketplace"
            rootHref="/marketplace"
            getLabel={(ref) =>
              getTaxonomyDisplayLabel(registry, ref, siteLanguage, "breadcrumb")
            }
            getHref={(ref) => taxonomyHref(ref)}
            onNavigate={() => undefined}
            renderLink={(href, children) => (
              <Link
                href={href}
                className="hover:text-shopstr-purple dark:hover:text-shopstr-yellow hover:underline"
              >
                {children}
              </Link>
            )}
          />
        </div>
      </div>
    ) : null;

  if (breadcrumbOnly) {
    return breadcrumbBlock ? (
      <div className={className}>{breadcrumbBlock}</div>
    ) : null;
  }

  if (compact) {
    return (
      <div className={`space-y-2 ${className}`}>
        {showImages && chipRefs.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {chipRefs.map((ref) => (
              <Link key={ref} href={taxonomyHref(ref)} className="max-w-full">
                <TaxonomyPill
                  label={truncate(
                    getTaxonomyDisplayLabel(
                      registry,
                      ref,
                      siteLanguage,
                      "category"
                    ),
                    20
                  )}
                  imageUrl={registry.imageByRef[ref]}
                  variant="interactive"
                  size="sm"
                />
              </Link>
            ))}
            {totalChipRefCount > chipRefs.length && (
              <span className="border-default-200/70 text-default-500 dark:border-default-700/70 inline-flex items-center rounded-full border px-2 py-1 text-xs">
                +{totalChipRefCount - chipRefs.length} more
              </span>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {breadcrumbBlock}

      {showImages && chipRefs.length > 0 && (
        <div>
          <div className="flex flex-wrap gap-2">
            {chipRefs.map((ref) => (
              <Link key={ref} href={taxonomyHref(ref)} className="max-w-full">
                <TaxonomyPill
                  label={truncate(
                    getTaxonomyDisplayLabel(
                      registry,
                      ref,
                      siteLanguage,
                      "category"
                    ),
                    36
                  )}
                  imageUrl={registry.imageByRef[ref]}
                  variant="interactive"
                />
              </Link>
            ))}
          </div>
        </div>
      )}

      {valueRows.length > 0 && (
        <div className="space-y-2">
          <p className="text-default-500 text-xs font-semibold tracking-wide uppercase">
            Details
          </p>
          <div className="divide-default-200/70 border-default-200/70 dark:divide-default-700/70 dark:border-default-700/70 divide-y rounded-xl border">
            {valueRows.map((row) => (
              <div
                key={row.key}
                className="flex flex-col gap-1 px-4 py-3 text-sm md:flex-row md:items-start md:justify-between md:gap-6"
              >
                <span className="text-default-700 dark:text-default-200 font-medium">
                  {row.label}
                </span>
                <span className="text-default-500 dark:text-default-300">
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
