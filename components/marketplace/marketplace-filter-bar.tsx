import { useEffect } from "react";
import { Button } from "@heroui/react";
import { ChevronDownIcon } from "@heroicons/react/24/outline";
import {
  MarketplaceFacetFilter,
  MarketplaceSelectedFacetChip,
} from "@/utils/taxonomy/marketplace-results";
import { TaxonomyPill } from "@/components/utility-components/taxonomy-chip";

export type MarketplaceLiteralFacetChip = {
  propRef: string;
  label: string;
  value: string;
  valueLabel: string;
};

type MarketplaceFilterBarProps = {
  filters: MarketplaceFacetFilter[];
  quickFilterLimit: number;
  selectedFacetChips: MarketplaceSelectedFacetChip[];
  selectedLiteralFacetChips: MarketplaceLiteralFacetChip[];
  filteredResultCount: number;
  baseScopeResultCount: number;
  openFilterRef: string;
  showAllFilters: boolean;
  selectedFilterValues: (propRef: string) => string[];
  onOpenFilterChange: (propRef: string) => void;
  onShowAllFiltersChange: (show: boolean) => void;
  onSelectFilterValue: (propRef: string, value: string) => void;
  onRemoveFacet: (propRef: string, valueRef: string) => void;
  onRemoveLiteralFacet: (propRef: string) => void;
};

export default function MarketplaceFilterBar({
  filters,
  quickFilterLimit,
  selectedFacetChips,
  selectedLiteralFacetChips,
  filteredResultCount,
  baseScopeResultCount,
  openFilterRef,
  showAllFilters,
  selectedFilterValues,
  onOpenFilterChange,
  onShowAllFiltersChange,
  onSelectFilterValue,
  onRemoveFacet,
  onRemoveLiteralFacet,
}: MarketplaceFilterBarProps) {
  useEffect(() => {
    if (!showAllFilters) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onShowAllFiltersChange(false);
        onOpenFilterChange("");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onOpenFilterChange, onShowAllFiltersChange, showAllFilters]);

  useEffect(() => {
    if (!openFilterRef) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest("[data-marketplace-filter-popover]")) return;
      onOpenFilterChange("");
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenFilterChange("");
    };
    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onOpenFilterChange, openFilterRef]);

  const availableFilterValues = (filter: MarketplaceFacetFilter) =>
    filter.values.filter(
      ([value]) => !selectedFilterValues(filter.propRef).includes(value)
    );

  const renderFilterControl = (filter: MarketplaceFacetFilter) => {
    const values = availableFilterValues(filter);
    const hasAvailableValues = values.length > 0;
    if (!hasAvailableValues && !filter.explicit) return null;
    if (filter.booleanTrueOnly) {
      return (
        <button
          key={filter.propRef}
          type="button"
          className="border-default-300 text-default-700 hover:border-shopstr-purple hover:text-shopstr-purple focus:ring-shopstr-purple/40 dark:border-default-700 dark:text-default-200 inline-flex items-center gap-2 rounded-full border bg-white px-3.5 py-2 text-sm font-medium transition focus:ring-2 focus:outline-none dark:bg-neutral-950"
          onClick={() => onSelectFilterValue(filter.propRef, "true")}
        >
          <span
            className="h-3.5 w-3.5 rounded border border-current"
            aria-hidden="true"
          />
          {filter.label}
        </button>
      );
    }

    const isOpen = openFilterRef === filter.propRef;
    return (
      <div
        key={filter.propRef}
        className="relative min-w-44"
        data-marketplace-filter-popover
      >
        <span className="text-default-700 dark:text-default-200 mb-2 block text-xs font-semibold">
          {filter.label}
        </span>
        <button
          type="button"
          className="border-default-300 text-default-700 hover:border-shopstr-purple hover:text-shopstr-purple focus:ring-shopstr-purple/40 disabled:text-default-400 disabled:hover:border-default-300 disabled:hover:text-default-400 dark:border-default-700 dark:text-default-200 dark:disabled:text-default-500 disabled:bg-default-50 flex w-full items-center justify-between gap-3 rounded-lg border bg-white px-3 py-2 text-left text-sm font-medium transition focus:ring-2 focus:outline-none disabled:cursor-not-allowed dark:bg-neutral-950 dark:disabled:bg-neutral-900"
          aria-expanded={isOpen}
          disabled={!hasAvailableValues}
          onClick={() => onOpenFilterChange(isOpen ? "" : filter.propRef)}
        >
          <span>{hasAvailableValues ? "Choose" : "No more values"}</span>
          <ChevronDownIcon
            className={`h-4 w-4 shrink-0 transition ${isOpen ? "rotate-180" : ""}`}
          />
        </button>
        {isOpen && hasAvailableValues && (
          <div className="border-default-200 dark:border-default-700 absolute left-0 z-40 mt-2 max-h-72 w-72 overflow-y-auto rounded-xl border bg-white p-2 shadow-lg dark:bg-neutral-900">
            {values.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className="text-default-700 hover:bg-default-100 hover:text-shopstr-purple focus:ring-shopstr-purple/30 dark:text-default-200 dark:hover:bg-default-800 block w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition focus:ring-2 focus:outline-none"
                onClick={() => onSelectFilterValue(filter.propRef, value)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  const quickFilters = filters.slice(0, quickFilterLimit);
  const overflowFilters = filters.slice(quickFilterLimit);
  const renderedQuickFilters = quickFilters
    .map(renderFilterControl)
    .filter(Boolean);
  const renderedOverflowFilters = overflowFilters
    .map(renderFilterControl)
    .filter(Boolean);
  const hasFilters =
    renderedQuickFilters.length > 0 || renderedOverflowFilters.length > 0;
  if (
    !hasFilters &&
    selectedFacetChips.length === 0 &&
    selectedLiteralFacetChips.length === 0
  )
    return null;

  return (
    <div className="border-default-200/70 dark:border-default-700/70 mb-5 rounded-xl border bg-white/85 p-4 shadow-sm dark:bg-neutral-900/75">
      <div className="flex flex-wrap items-center gap-2 pb-3">
        <p className="text-default-700 dark:text-default-200 mr-2 text-sm font-semibold">
          {filteredResultCount === baseScopeResultCount
            ? `Showing ${filteredResultCount} results`
            : `Showing ${filteredResultCount} of ${baseScopeResultCount} results`}
        </p>
        {selectedFacetChips.map((chip) => (
          <TaxonomyPill
            key={`${chip.propRef}:${chip.valueRef}`}
            label={
              <>
                <span
                  className={
                    chip.source === "explicit"
                      ? "text-white/70"
                      : "text-default-500 dark:text-default-400"
                  }
                >
                  {chip.label}:
                </span>
                <span>{chip.valueLabel}</span>
                {chip.source === "derived" && (
                  <span className="text-default-500 dark:text-default-400">
                    implied
                  </span>
                )}
              </>
            }
            variant={chip.source === "explicit" ? "filter" : "selected"}
            removable={chip.removable}
            removeLabel={`Remove ${chip.label}: ${chip.valueLabel}`}
            onRemove={
              chip.removable
                ? () => onRemoveFacet(chip.propRef, chip.valueRef)
                : undefined
            }
          />
        ))}
        {selectedLiteralFacetChips.map((chip) => (
          <TaxonomyPill
            key={`${chip.propRef}:${chip.value}`}
            label={
              <>
                <span className="text-white/70">{chip.label}:</span>
                <span>{chip.valueLabel}</span>
              </>
            }
            variant="filter"
            removable
            removeLabel={`Remove ${chip.label}: ${chip.valueLabel}`}
            onRemove={() => onRemoveLiteralFacet(chip.propRef)}
          />
        ))}
      </div>
      {hasFilters && (
        <div className="border-default-200/80 dark:border-default-700/80 flex flex-wrap items-end gap-4 border-t pt-4">
          {renderedQuickFilters}
          {renderedOverflowFilters.length > 0 && (
            <div className="relative">
              <Button
                size="sm"
                variant="flat"
                className="focus:ring-shopstr-purple/40 rounded-lg font-medium focus:ring-2"
                onClick={() => onShowAllFiltersChange(!showAllFilters)}
              >
                All filters
              </Button>
            </div>
          )}
        </div>
      )}
      {showAllFilters && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6"
          role="presentation"
          onClick={() => {
            onShowAllFiltersChange(false);
            onOpenFilterChange("");
          }}
        >
          <div
            className="border-default-200 dark:border-default-700 max-h-[82vh] w-full max-w-3xl overflow-hidden rounded-2xl border bg-white shadow-xl dark:bg-neutral-900"
            role="dialog"
            aria-modal="true"
            aria-label="All filters"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-default-200 dark:border-default-700 flex items-center justify-between border-b px-5 py-4">
              <div>
                <p className="text-default-800 dark:text-default-100 text-base font-semibold">
                  All filters
                </p>
                <p className="text-default-500 dark:text-default-400 text-sm">
                  Filter results in this listing scope.
                </p>
              </div>
              <button
                type="button"
                className="text-default-500 hover:bg-default-100 hover:text-default-800 focus:ring-shopstr-purple/40 dark:hover:bg-default-800 dark:hover:text-default-100 rounded-full px-3 py-1.5 text-lg leading-none transition focus:ring-2 focus:outline-none"
                aria-label="Close filters"
                onClick={() => {
                  onShowAllFiltersChange(false);
                  onOpenFilterChange("");
                }}
              >
                ×
              </button>
            </div>
            <div className="max-h-[65vh] overflow-y-auto p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                {renderedOverflowFilters}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
