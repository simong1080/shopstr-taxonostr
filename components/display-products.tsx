import { useState, useEffect, useContext, useMemo } from "react";
import { deleteEvent } from "@/utils/nostr/nostr-helper-functions";
import { NostrEvent } from "../utils/types/types";
import {
  ProductContext,
  ProfileMapContext,
  FollowsContext,
  RelaysContext,
  SiteLanguageContext,
  TaxonomyContext,
} from "../utils/context/context";
import DisplayProductModal from "./display-product-modal";
import { SHOPSTRBUTTONCLASSNAMES } from "@/utils/STATIC-VARIABLES";
import { Button } from "@heroui/react";
import ShopstrSpinner from "./utility-components/shopstr-spinner";
import { useRouter } from "next/router";
import parseTags, {
  ProductData,
} from "@/utils/parsers/product-parser-functions";
import { parseZapsnagNote } from "@/utils/parsers/zapsnag-parser";
import {
  NostrContext,
  SignerContext,
} from "@/components/utility-components/nostr-context-provider";
import { getListingSlug } from "@/utils/url-slugs";
import {
  dedupeProductEvents,
  fetchNip50ProductSearch,
  getProductEventKey,
} from "@/utils/nostr/fetch-service";
import { nip19 } from "nostr-tools";
import { normalizeTaxonomyRef } from "@/utils/taxonomy/registry";
import MarketplaceBreadcrumbs from "@/components/marketplace/marketplace-breadcrumbs";
import MarketplaceBrowseSections, {
  MarketplaceBrowseSection,
} from "@/components/marketplace/marketplace-browse-sections";
import MarketplaceFilterBar, {
  MarketplaceLiteralFacetChip,
} from "@/components/marketplace/marketplace-filter-bar";
import MarketplaceListingsPanel from "@/components/marketplace/marketplace-listings-panel";
import MarketplaceScopeSidebar from "@/components/marketplace/marketplace-scope-sidebar";
import {
  buildActiveMarketplaceState,
  buildMarketplaceBrowseNavSections,
  buildMarketplaceNavSections,
  buildMarketplaceNavigationHref,
  getMarketplaceNavHref,
  MarketplaceNavSection,
  MarketplaceNavItem,
  shouldShowListingsForScope,
} from "@/utils/taxonomy/marketplace-scope";
import { getNodeImage } from "@/utils/taxonomy/search";
import {
  buildMarketplaceHref,
  normalizeMarketplaceUrlQuery,
} from "@/utils/taxonomy/routing";
import { buildMarketplaceResultsViewModel } from "@/utils/taxonomy/marketplace-results";
import {
  getTaxonomyDisplayLabel,
  getTaxonomyTileImages,
} from "@/utils/taxonomy/display";

const isNip19SearchQuery = (search: string) => {
  const normalizedSearch = search.trim();
  return (
    normalizedSearch.includes("naddr1") || normalizedSearch.includes("npub1")
  );
};

const DisplayProducts = ({
  focusedPubkey,
  selectedCategories,
  selectedLocation,
  selectedSearch,
  wotFilter,
  isMyListings,
  setCategories,
  onFilteredProductsChange,
  searchBarRef,
}: {
  focusedPubkey?: string;
  selectedCategories: Set<string>;
  selectedLocation: string;
  selectedSearch: string;
  wotFilter?: boolean;
  isMyListings?: boolean;
  setCategories?: (categories: string[]) => void;
  onFilteredProductsChange?: (products: ProductData[]) => void;
  searchBarRef?: React.RefObject<HTMLDivElement | null>;
}) => {
  const [productEvents, setProductEvents] = useState<ProductData[]>([]);
  const [isProductsLoading, setIsProductLoading] = useState(true);
  const [nip50ProductEvents, setNip50ProductEvents] = useState<NostrEvent[]>(
    []
  );
  const [isNip50SearchLoading, setIsNip50SearchLoading] = useState(false);
  const productEventContext = useContext(ProductContext);
  const profileMapContext = useContext(ProfileMapContext);
  const followsContext = useContext(FollowsContext);
  const relaysContext = useContext(RelaysContext);
  const [focusedProduct, setFocusedProduct] = useState<ProductData>();
  const [showModal, setShowModal] = useState(false);

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 42;
  const [filteredProducts, setFilteredProducts] = useState<ProductData[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [isInitialized, setIsInitialized] = useState(false);

  const router = useRouter();

  const { nostr } = useContext(NostrContext);
  const { signer, pubkey: userPubkey } = useContext(SignerContext);
  const { registry } = useContext(TaxonomyContext);
  const { siteLanguage } = useContext(SiteLanguageContext);
  const [selectedAspectFilters, setSelectedAspectFilters] = useState<
    Record<string, string>
  >({});
  const [showAllFilters, setShowAllFilters] = useState(false);
  const [openFilterRef, setOpenFilterRef] = useState("");
  const scopeState = buildActiveMarketplaceState(router.query, registry);
  const selectedContextRef = scopeState.contextRef;
  const selectedThingRef = scopeState.thingRef;
  const selectedContextNode =
    selectedContextRef && registry
      ? registry.nodeByRef[selectedContextRef]
      : undefined;
  const selectedThingNode =
    selectedThingRef && registry
      ? registry.nodeByRef[selectedThingRef]
      : undefined;
  const useFocusedShopListingMode = Boolean(focusedPubkey);
  const showTaxonostrMarketplaceChrome =
    !isMyListings && !useFocusedShopListingMode;
  const hasSearchQuery = selectedSearch.trim().length > 0;
  const forceListingsForSearch =
    showTaxonostrMarketplaceChrome && hasSearchQuery;
  const resultsScopeState = showTaxonostrMarketplaceChrome
    ? {
        ...scopeState,
        pageMode: forceListingsForSearch
          ? ("listings" as const)
          : scopeState.pageMode,
        showListings: forceListingsForSearch ? true : scopeState.showListings,
      }
    : {
        ...scopeState,
        contextRef: "",
        thingRef: "",
        selectedValuesByProp: {},
        autoActiveRequiredRefs: [],
        pageMode: "listings" as const,
        showListings: true,
      };
  const shouldShowListings = showTaxonostrMarketplaceChrome
    ? forceListingsForSearch || shouldShowListingsForScope(scopeState)
    : !isMyListings;
  const isListingResultPage =
    showTaxonostrMarketplaceChrome &&
    (forceListingsForSearch || scopeState.pageMode === "listings");
  const isMarketplaceBrowseHome =
    showTaxonostrMarketplaceChrome &&
    !forceListingsForSearch &&
    !selectedContextRef &&
    !selectedThingRef &&
    scopeState.pageMode === "browse";
  const selectedScopeValuesByProp = scopeState.selectedValuesByProp;
  const selectedScopeValuesKey = JSON.stringify(selectedScopeValuesByProp);
  const autoActiveRequiredRefsKey = scopeState.autoActiveRequiredRefs.join("|");
  const marketplaceResults = useMemo(
    () =>
      buildMarketplaceResultsViewModel({
        products: productEvents,
        registry,
        scopeState: resultsScopeState,
        selectedCategories,
        selectedLocation,
        selectedSearch,
        selectedAspectFilters,
        focusedPubkey,
        userPubkey,
        locale: siteLanguage,
      }),
    [
      productEvents,
      registry,
      selectedCategories,
      selectedLocation,
      selectedSearch,
      selectedAspectFilters,
      focusedPubkey,
      userPubkey,
      siteLanguage,
      selectedContextRef,
      selectedThingRef,
      shouldShowListings,
      selectedScopeValuesKey,
      autoActiveRequiredRefsKey,
    ]
  );
  const actualFacetFilters = marketplaceResults.actualFacetFilters;
  const selectedFacetChips = marketplaceResults.selectedFacetChips;
  const baseScopeResultCount = marketplaceResults.baseScopeResultCount;
  const filteredResultCount = marketplaceResults.filteredResultCount;
  const scopeNavigationSections =
    registry && isListingResultPage
      ? buildMarketplaceNavSections({
          mode: selectedContextRef || selectedThingRef ? "localScope" : "root",
          registry,
          scopeState,
          locale: siteLanguage,
        })
      : [];
  const quickFilterLimit = 8;
  const rootNavSections = useMemo(() => {
    if (!registry || !isMarketplaceBrowseHome) return [];
    return buildMarketplaceNavSections({
      mode: "root",
      registry,
      locale: siteLanguage,
    });
  }, [isMarketplaceBrowseHome, registry, siteLanguage]);
  const recentMarketplaceProducts = useMemo(
    () =>
      productEvents
        .filter(
          (product) =>
            product.currency &&
            product.images.length > 0 &&
            !product.contentWarning
        )
        .slice(0, 8),
    [productEvents]
  );

  const searchRelaysKey = Array.from(
    new Set([
      ...(relaysContext.relayList || []),
      ...(relaysContext.readRelayList || []),
    ])
  )
    .filter(Boolean)
    .join("|");

  useEffect(() => {
    if (!router.isReady || !registry || !showTaxonostrMarketplaceChrome) return;
    const normalized = normalizeMarketplaceUrlQuery({
      pathname: "/marketplace",
      query: router.query,
      registry,
    });
    if (!normalized.changed) return;
    router.replace(normalized.href, undefined, { shallow: true });
  }, [
    registry,
    router,
    router.isReady,
    router.query,
    showTaxonostrMarketplaceChrome,
  ]);

  // Load saved page from session storage on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const storageKey = focusedPubkey
        ? `marketplace-page-${focusedPubkey}`
        : "marketplace-page-general";
      const savedPage = sessionStorage.getItem(storageKey);
      if (savedPage) {
        const pageNum = parseInt(savedPage, 10);
        if (!isNaN(pageNum) && pageNum > 0) {
          setCurrentPage(pageNum);
        }
      }
      setIsInitialized(true);
    }
  }, [focusedPubkey]);

  useEffect(() => {
    setSelectedAspectFilters({});
    setShowAllFilters(false);
    setOpenFilterRef("");
    setCurrentPage(1);
    if (typeof window !== "undefined" && process.env.NODE_ENV !== "test") {
      window.scrollTo({ top: 0, behavior: "auto" });
    }
  }, [router.asPath]);

  useEffect(() => {
    const normalizedSearch = selectedSearch.trim();

    if (
      !normalizedSearch ||
      isNip19SearchQuery(normalizedSearch) ||
      !nostr ||
      typeof nostr.fetch !== "function"
    ) {
      setNip50ProductEvents([]);
      setIsNip50SearchLoading(false);
      return;
    }

    const relaysToSearch = searchRelaysKey ? searchRelaysKey.split("|") : [];

    let didCancel = false;
    setIsNip50SearchLoading(true);

    fetchNip50ProductSearch(nostr, relaysToSearch, normalizedSearch, {
      authors: focusedPubkey ? [focusedPubkey] : undefined,
    })
      .then(({ productEvents }) => {
        if (didCancel) return;
        setNip50ProductEvents(productEvents);
      })
      .catch((error) => {
        if (didCancel) return;
        setNip50ProductEvents([]);
        console.error("Failed to search products with NIP-50:", error);
      })
      .finally(() => {
        if (didCancel) return;
        setIsNip50SearchLoading(false);
      });

    return () => {
      didCancel = true;
    };
  }, [selectedSearch, focusedPubkey, nostr, searchRelaysKey]);

  useEffect(() => {
    if (!productEventContext) return;
    const hasProducts =
      productEventContext.productEvents &&
      productEventContext.productEvents.length > 0;
    const hasNip50Products = nip50ProductEvents.length > 0;
    const sourceProductEvents =
      selectedSearch.trim() && !isNip19SearchQuery(selectedSearch)
        ? dedupeProductEvents([
            ...nip50ProductEvents,
            ...[...(productEventContext.productEvents || [])].sort(
              (a: NostrEvent, b: NostrEvent) => b.created_at - a.created_at
            ),
          ])
        : [...(productEventContext.productEvents || [])].sort(
            (a: NostrEvent, b: NostrEvent) => b.created_at - a.created_at
          );

    if (hasProducts || hasNip50Products) {
      const parsedProductData: ProductData[] = [];
      sourceProductEvents.forEach((event) => {
        if (wotFilter) {
          if (!followsContext.isLoading && followsContext.followList) {
            const followList = followsContext.followList;
            if (followList.length > 0 && followList.includes(event.pubkey)) {
              let parsedData;
              if (event.kind === 1) {
                parsedData = parseZapsnagNote(event);
              } else {
                parsedData = parseTags(event);
              }
              if (parsedData) {
                parsedData.rawEvent = event;
                parsedProductData.push(parsedData);
              }
            }
          }
        } else {
          let parsedData;
          if (event.kind === 1) {
            parsedData = parseZapsnagNote(event);
          } else {
            parsedData = parseTags(event);
          }
          if (parsedData) parsedProductData.push(parsedData);
        }
      });
      setProductEvents(parsedProductData);
      if (
        parsedProductData.length >= itemsPerPage ||
        !productEventContext.isLoading
      ) {
        setIsProductLoading(false);
      }
    } else if (!productEventContext.isLoading) {
      setProductEvents([]);
      setIsProductLoading(false);
    }
  }, [productEventContext, wotFilter, nip50ProductEvents, selectedSearch]);

  useEffect(() => {
    if (focusedPubkey && setCategories) {
      const productCategories: string[] = [];
      productEvents.forEach((event) => {
        if (event.pubkey === focusedPubkey && !event.taxonomy) {
          productCategories.push(...event.categories);
        }
      });
      setCategories(productCategories);
    }
  }, [productEvents, focusedPubkey]);

  useEffect(() => {
    if (!productEvents || !isInitialized) return;

    const filtered = marketplaceResults.filteredProducts;

    setFilteredProducts(filtered);
    const newTotalPages = Math.max(
      1,
      Math.ceil(filtered.length / itemsPerPage)
    );
    setTotalPages(newTotalPages);

    // Check if filter actually changed (not just from initialization)
    const prevFiltersRef = `${selectedSearch}-${selectedLocation}-${Array.from(
      selectedCategories
    ).join(
      ","
    )}-${selectedContextRef}-${selectedThingRef}-${Object.values(selectedAspectFilters).join(",")}`;
    const currentFiltersRef = sessionStorage.getItem("last-filters-ref");

    if (currentFiltersRef && currentFiltersRef !== prevFiltersRef) {
      // Filters changed, reset to page 1
      setCurrentPage(1);
      if (typeof window !== "undefined") {
        const storageKey = focusedPubkey
          ? `marketplace-page-${focusedPubkey}`
          : "marketplace-page-general";
        sessionStorage.setItem(storageKey, "1");
      }
    } else if (currentPage > newTotalPages) {
      // Current page exceeds total pages, go to last page
      setCurrentPage(newTotalPages);
    }

    sessionStorage.setItem("last-filters-ref", prevFiltersRef);

    onFilteredProductsChange?.(filtered);
  }, [
    productEvents,
    marketplaceResults,
    selectedSearch,
    selectedLocation,
    selectedCategories,
    selectedContextRef,
    selectedThingRef,
    shouldShowListings,
    selectedAspectFilters,
    focusedPubkey,
    isInitialized,
  ]);

  // Scroll effect only on page change
  useEffect(() => {
    // Skip initial render (currentPage === 1)
    if (currentPage === 1) return;

    const timer = requestAnimationFrame(() => {
      if (searchBarRef?.current) {
        searchBarRef.current.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
        window.scrollBy(0, -80); // Adjust for fixed header
      } else {
        window.scrollTo({
          top: 0,
          behavior: "smooth",
        });
      }
    });

    return () => cancelAnimationFrame(timer);
  }, [currentPage, searchBarRef]);

  const handleDelete = async (productId: string) => {
    try {
      await deleteEvent(nostr!, signer!, [productId]);
      productEventContext.removeDeletedProductEvent(productId);
    } catch {
      return;
    }
  };

  const handleToggleModal = () => {
    setShowModal(!showModal);
  };

  const getProductHref = (product: ProductData) => {
    if (product.pubkey === userPubkey) {
      return null;
    }

    if (product.d === "zapsnag" || product.categories?.includes("zapsnag")) {
      return `/listing/${product.id}`;
    }

    const rawProductEvent = product.rawEvent;
    const isNip50SearchResult =
      rawProductEvent?.kind === 30402 &&
      nip50ProductEvents.some(
        (event: NostrEvent) =>
          event.kind === 30402 &&
          getProductEventKey(event) === getProductEventKey(rawProductEvent)
      );

    if (isNip50SearchResult) {
      const dTag = rawProductEvent.tags.find((tag) => tag[0] === "d")?.[1];
      if (dTag) {
        try {
          return `/listing/${nip19.naddrEncode({
            identifier: dTag,
            pubkey: rawProductEvent.pubkey,
            kind: rawProductEvent.kind,
          })}`;
        } catch {
          // Fall back to the slug path if this event cannot form a valid naddr.
        }
      }
    }

    const allParsed = productEventContext.productEvents
      .filter((e: NostrEvent) => e.kind !== 1)
      .map((e: NostrEvent) => parseTags(e))
      .filter((p: ProductData | undefined): p is ProductData => !!p);

    const slug = getListingSlug(product, allParsed);
    if (slug) {
      return `/listing/${slug}`;
    }

    return `/listing/${product.id}`;
  };

  const onProductClick = (
    product: ProductData,
    e?: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>
  ) => {
    setFocusedProduct(product);
    if (product.pubkey === userPubkey) {
      e?.preventDefault();
      setShowModal(true);
    } else {
      setShowModal(false);
    }
  };

  const getCurrentPageProducts = () => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;

    return filteredProducts.slice(startIndex, endIndex);
  };
  const currentPageProducts = getCurrentPageProducts();

  const contextPathRefs =
    registry && selectedContextRef
      ? (registry.ancestryByRef[selectedContextRef] || [selectedContextRef])
          .map(normalizeTaxonomyRef)
          .filter(
            (ref) =>
              ref.startsWith("val:context:") &&
              ref !== "val:context" &&
              ref !== "val:context:segment"
          )
      : [];
  const thingPathRefs =
    registry && selectedThingRef
      ? (registry.ancestryByRef[selectedThingRef] || [selectedThingRef])
          .map(normalizeTaxonomyRef)
          .filter(
            (ref) =>
              ref.startsWith("thing:") &&
              ref !== "thing" &&
              ref !== "thing:artifact"
          )
      : [];
  const breadcrumbRefs = [...contextPathRefs, ...thingPathRefs];
  const marketplaceNavHref = (
    item: MarketplaceNavItem,
    listingsIntent = isListingResultPage
  ) =>
    getMarketplaceNavHref({
      registry,
      currentScopeState: scopeState,
      item,
      listingsIntent,
    });

  const marketplaceFacetHref = (
    selectedValuesByProp: Record<string, string[]>
  ) =>
    buildMarketplaceNavigationHref({
      registry,
      currentScopeState: scopeState,
      targetThingRef: selectedThingRef,
      targetContextRef: selectedContextRef,
      selectedValuesByProp,
      listingsIntent: true,
    });

  const removeSelectedFacetHref = (propRef: string, valueRef: string) => {
    const nextSelectedValuesByProp: Record<string, string[]> =
      Object.fromEntries(
        Object.entries(selectedScopeValuesByProp).flatMap(
          ([currentPropRef, currentValueRefs]) => {
            if (currentPropRef !== propRef)
              return [[currentPropRef, currentValueRefs]];
            const nextValueRefs = currentValueRefs.filter(
              (currentValueRef) => currentValueRef !== valueRef
            );
            return nextValueRefs.length > 0
              ? [[currentPropRef, nextValueRefs]]
              : [];
          }
        )
      );
    return marketplaceFacetHref(nextSelectedValuesByProp);
  };

  const removeLiteralFilter = (propRef: string) => {
    setSelectedAspectFilters((current) => {
      const next = { ...current };
      delete next[propRef];
      return next;
    });
  };

  const selectedFilterValues = (propRef: string) => {
    const selectedScopeValues = selectedScopeValuesByProp[propRef] || [];
    if (selectedScopeValues.length > 0) return selectedScopeValues;
    const selectedLiteralValue = selectedAspectFilters[propRef];
    return selectedLiteralValue ? [selectedLiteralValue] : [];
  };

  const handleFacetFilterChange = (propRef: string, value: string) => {
    const normalizedValue = normalizeTaxonomyRef(value);
    const isTaxonomyRefValue = Boolean(
      value && registry?.nodeByRef[normalizedValue]
    );
    if (isTaxonomyRefValue || selectedScopeValuesByProp[propRef]?.length) {
      const nextSelectedValuesByProp = { ...selectedScopeValuesByProp };
      if (isTaxonomyRefValue) {
        nextSelectedValuesByProp[propRef] = Array.from(
          new Set([
            ...(nextSelectedValuesByProp[propRef] || []),
            normalizedValue,
          ])
        );
      } else {
        delete nextSelectedValuesByProp[propRef];
      }
      setOpenFilterRef("");
      router.push(marketplaceFacetHref(nextSelectedValuesByProp), undefined, {
        shallow: true,
      });
      return;
    }

    setOpenFilterRef("");
    setSelectedAspectFilters((current) => ({
      ...current,
      [propRef]: value,
    }));
  };

  const selectedLiteralFacetChips: MarketplaceLiteralFacetChip[] =
    actualFacetFilters.flatMap((filter) => {
      const value = selectedAspectFilters[filter.propRef];
      if (!value) return [];
      const valueLabel =
        filter.values.find(([candidate]) => candidate === value)?.[1] || value;
      return [
        {
          propRef: filter.propRef,
          label: filter.label,
          value,
          valueLabel,
        },
      ];
    });

  const renderFilterBar = () => {
    if (!isListingResultPage) return null;
    return (
      <MarketplaceFilterBar
        filters={actualFacetFilters}
        quickFilterLimit={quickFilterLimit}
        selectedFacetChips={selectedFacetChips}
        selectedLiteralFacetChips={selectedLiteralFacetChips}
        filteredResultCount={filteredResultCount}
        baseScopeResultCount={baseScopeResultCount}
        openFilterRef={openFilterRef}
        showAllFilters={showAllFilters}
        selectedFilterValues={selectedFilterValues}
        onOpenFilterChange={setOpenFilterRef}
        onShowAllFiltersChange={setShowAllFilters}
        onSelectFilterValue={handleFacetFilterChange}
        onRemoveFacet={(propRef, valueRef) =>
          router.push(removeSelectedFacetHref(propRef, valueRef), undefined, {
            shallow: true,
          })
        }
        onRemoveLiteralFacet={removeLiteralFilter}
      />
    );
  };

  const toBrowseTileItem = (item: MarketplaceNavItem) => ({
    ref: item.ref,
    label: item.label,
    image: registry ? getNodeImage(registry, item.ref) : undefined,
    tileImages: registry
      ? getTaxonomyTileImages(registry, item.ref, {
          selectedValuesByProp: selectedScopeValuesByProp,
        })
      : undefined,
    onClick: () =>
      router.push(marketplaceNavHref(item, false), undefined, {
        shallow: true,
      }),
  });

  const navSectionsToBrowseSections = (
    sections: MarketplaceNavSection[]
  ): MarketplaceBrowseSection[] =>
    sections.map((section) => ({
      key: section.id,
      title: section.label,
      items: section.items.map(toBrowseTileItem),
    }));

  const scopedBrowseNavSections =
    registry && !isMarketplaceBrowseHome && !isListingResultPage
      ? buildMarketplaceBrowseNavSections(registry, scopeState, siteLanguage)
      : [];
  const scopedBrowseSections = navSectionsToBrowseSections(
    scopedBrowseNavSections
  );

  const marketplaceHomeBrowseSections: MarketplaceBrowseSection[] =
    rootNavSections.map((section) => ({
      key: section.id,
      title: section.label,
      items: section.items.map((item) => ({
        ref: item.ref,
        label: item.label,
        image: registry ? getNodeImage(registry, item.ref) : undefined,
        tileImages: registry
          ? getTaxonomyTileImages(registry, item.ref, siteLanguage)
          : undefined,
        href: buildMarketplaceHref({
          contextRef: item.kind === "context" ? item.ref : undefined,
          thingRef: item.kind === "thing" ? item.ref : undefined,
        }),
      })),
    }));

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    // Save to session storage
    if (typeof window !== "undefined") {
      const storageKey = focusedPubkey
        ? `marketplace-page-${focusedPubkey}`
        : "marketplace-page-general";
      sessionStorage.setItem(storageKey, page.toString());
    }
  };

  const sidebarHref = (item: MarketplaceNavItem) => {
    return marketplaceNavHref(item, isListingResultPage);
  };

  const renderScopeNavigationSidebar = () => {
    if (!registry || !isListingResultPage) return null;
    return (
      <MarketplaceScopeSidebar
        sections={scopeNavigationSections}
        getHref={sidebarHref}
        onNavigate={(href) => router.push(href, undefined, { shallow: true })}
      />
    );
  };

  const renderListingResults = () => (
    <MarketplaceListingsPanel
      products={currentPageProducts}
      totalPages={totalPages}
      currentPage={currentPage}
      isProductsLoading={isProductsLoading}
      shouldShowListings={shouldShowListings}
      wotFilter={wotFilter}
      baseScopeResultCount={baseScopeResultCount}
      getProductHref={getProductHref}
      onPageChange={handlePageChange}
      onProductClick={onProductClick}
      filterBar={renderFilterBar()}
    />
  );

  return (
    <>
      <div className="bg-light-bg dark:bg-dark-bg w-full px-4 md:pl-4">
        {showTaxonostrMarketplaceChrome &&
          registry &&
          (selectedContextRef || selectedThingRef || isListingResultPage) && (
            <div className="border-default-200/70 dark:border-default-700/70 mb-6 rounded-xl border bg-white/80 px-6 py-6 shadow-sm dark:bg-neutral-900/70">
              <div
                className={`flex flex-wrap items-start gap-4 ${isListingResultPage ? "justify-between" : "justify-start text-left"}`}
              >
                <div>
                  <div
                    className={`text-default-500 mb-2 flex flex-wrap items-center gap-2 text-xs ${isListingResultPage ? "" : "justify-start"}`}
                  >
                    <MarketplaceBreadcrumbs
                      refs={breadcrumbRefs}
                      rootLabel="Marketplace"
                      rootHref="/marketplace"
                      getLabel={(ref) =>
                        getTaxonomyDisplayLabel(
                          registry,
                          ref,
                          siteLanguage,
                          "breadcrumb"
                        )
                      }
                      getHref={(ref) =>
                        marketplaceNavHref(
                          {
                            kind: ref.startsWith("thing:")
                              ? "thing"
                              : "context",
                            ref,
                            label: "",
                            depth: 0,
                            isCurrent: false,
                          },
                          false
                        )
                      }
                      onNavigate={(href) =>
                        router.push(href, undefined, { shallow: true })
                      }
                    />
                  </div>
                  <h1 className="text-light-text dark:text-dark-text text-2xl font-semibold">
                    {selectedThingRef && selectedThingNode
                      ? getTaxonomyDisplayLabel(
                          registry,
                          selectedThingRef,
                          siteLanguage,
                          "category"
                        )
                      : selectedContextRef && selectedContextNode
                        ? getTaxonomyDisplayLabel(
                            registry,
                            selectedContextRef,
                            siteLanguage,
                            "category"
                          )
                        : "Marketplace"}
                  </h1>
                </div>
                <div className="flex flex-wrap items-end justify-center gap-3"></div>
              </div>
              {!isListingResultPage && (
                <MarketplaceBrowseSections sections={scopedBrowseSections} />
              )}
            </div>
          )}
        {registry && isMarketplaceBrowseHome && rootNavSections.length > 0 && (
          <div className="border-default-200/70 dark:border-default-700/70 mb-8 rounded-xl border bg-white/80 px-6 py-6 shadow-sm dark:bg-neutral-900/70">
            <h1 className="text-light-text dark:text-dark-text mb-6 text-2xl font-semibold">
              Marketplace
            </h1>
            <div className="space-y-8">
              <MarketplaceBrowseSections
                sections={marketplaceHomeBrowseSections}
              />
            </div>
          </div>
        )}
        {!isMyListings &&
        (profileMapContext.isLoading ||
          productEventContext.isLoading ||
          isProductsLoading ||
          isNip50SearchLoading) ? (
          <div className="mt-6 mb-6 flex items-center justify-center">
            <ShopstrSpinner />
          </div>
        ) : null}
        {isMarketplaceBrowseHome && recentMarketplaceProducts.length > 0 && (
          <section className="mb-8">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-light-text dark:text-dark-text text-2xl font-semibold">
                Recently listed items
              </h2>
            </div>
            <MarketplaceListingsPanel
              products={recentMarketplaceProducts}
              totalPages={1}
              currentPage={1}
              isProductsLoading={isProductsLoading}
              shouldShowListings={false}
              wotFilter={wotFilter}
              baseScopeResultCount={recentMarketplaceProducts.length}
              getProductHref={getProductHref}
              onPageChange={handlePageChange}
              onProductClick={onProductClick}
            />
          </section>
        )}
        {isListingResultPage ? (
          <div className="flex items-start gap-6">
            {renderScopeNavigationSidebar()}
            <div className="min-w-0 flex-1">{renderListingResults()}</div>
          </div>
        ) : (
          renderListingResults()
        )}
        {isMyListings &&
          !isProductsLoading &&
          !productEvents.some((product) => product.pubkey === userPubkey) && (
            <div className="mt-20 flex flex-grow items-center justify-center py-10">
              <div className="bg-light-fg dark:bg-dark-fg w-full max-w-lg rounded-lg p-8 text-center shadow-lg">
                <p className="text-light-text dark:text-dark-text text-3xl font-semibold">
                  No products found...
                </p>
                <p className="text-light-text dark:text-dark-text mt-4 text-lg">
                  Try adding a new listing!
                </p>
                <Button
                  className={`${SHOPSTRBUTTONCLASSNAMES} mt-6`}
                  onClick={() => router.push("?addNewListing")}
                >
                  Add Listing
                </Button>
              </div>
            </div>
          )}
      </div>
      {focusedProduct && (
        <DisplayProductModal
          productData={focusedProduct}
          showModal={showModal}
          handleModalToggle={handleToggleModal}
          handleDelete={handleDelete}
        />
      )}
    </>
  );
};

export default DisplayProducts;
