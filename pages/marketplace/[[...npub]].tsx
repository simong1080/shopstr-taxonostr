import { useEffect } from "react";
import HomeFeed from "@/components/home/home-feed";
import MarketplaceBrowseSections, {
  MarketplaceBrowseSection,
} from "@/components/marketplace/marketplace-browse-sections";
import ProductCard from "@/components/utility-components/product-card";
import { GetServerSideProps } from "next";
import { OgMetaProps, DEFAULT_OG } from "@/components/og-head";
import { nip19 } from "nostr-tools";
import {
  fetchShopProfileByPubkeyFromDb,
  fetchProfilePubkeyByNameSlug,
} from "@/utils/db/db-service";
import {
  ProductContext,
  SiteLanguageContext,
  TaxonomyContext,
} from "@/utils/context/context";
import parseTags, {
  ProductData,
} from "@/utils/parsers/product-parser-functions";
import { getTaxonomyTileImages } from "@/utils/taxonomy/display";
import { buildMarketplaceNavSections } from "@/utils/taxonomy/marketplace-scope";
import { buildMarketplaceHref } from "@/utils/taxonomy/routing";
import { getNodeImage } from "@/utils/taxonomy/search";
import { NostrEvent } from "@/utils/types/types";
import { getListingSlug } from "@/utils/url-slugs";
import Link from "next/link";
import { useRouter } from "next/router";
import { useContext, useMemo } from "react";

type MarketplacePageProps = {
  ogMeta: OgMetaProps;
  focusedPubkey: string;
  setFocusedPubkey: (value: string) => void;
  selectedSection: string;
  setSelectedSection: (value: string) => void;
};

function shopEventToOgMeta(
  shopEvent: NostrEvent,
  urlPath: string
): OgMetaProps {
  try {
    const content = JSON.parse(shopEvent.content);
    return {
      title: content.name ? `${content.name} Shop` : "Shopstr Shop",
      description: content.about || "Check out this shop on Shopstr!",
      image: content.ui?.picture || "/shopstr-2000x2000.png",
      url: urlPath,
    };
  } catch {
    return {
      ...DEFAULT_OG,
      title: "Shopstr Shop",
      description: "Check out this shop on Shopstr!",
      url: urlPath,
    };
  }
}

export const getServerSideProps: GetServerSideProps = async (context) => {
  const { npub } = context.query;
  const identifier = Array.isArray(npub) ? npub[0] : npub;

  if (!identifier) {
    return { props: { ogMeta: DEFAULT_OG } };
  }

  const urlPath = `/marketplace/${identifier}`;

  try {
    let pubkey: string | null = null;

    if (identifier.startsWith("npub1")) {
      try {
        const decoded = nip19.decode(identifier);
        if (decoded.type === "npub") {
          pubkey = decoded.data as string;
        }
      } catch {}
    } else {
      pubkey = await fetchProfilePubkeyByNameSlug(identifier);
    }

    if (pubkey) {
      const shopEvent = await fetchShopProfileByPubkeyFromDb(pubkey);
      if (shopEvent) {
        return { props: { ogMeta: shopEventToOgMeta(shopEvent, urlPath) } };
      }
    }
  } catch (error) {
    console.error("SSR OG fetch error for marketplace:", error);
  }

  return {
    props: {
      ogMeta: {
        ...DEFAULT_OG,
        title: "Shopstr Shop",
        description: "Check out this shop on Shopstr!",
        url: urlPath,
      },
    },
  };
};

export default function SellerView({
  focusedPubkey,
  setFocusedPubkey,
  selectedSection,
  setSelectedSection,
}: MarketplacePageProps) {
  const router = useRouter();
  const hasTaxonomyScope = Boolean(
    router.query.context || router.query.thing || router.query.taxon
  );
  const isRootMarketplaceLanding =
    !focusedPubkey &&
    !hasTaxonomyScope &&
    Object.keys(router.query).length === 0;

  useEffect(() => {
    if (typeof window !== "undefined") {
      sessionStorage.removeItem("sf_seller_pubkey");
      sessionStorage.removeItem("sf_shop_slug");
      localStorage.removeItem("sf_seller_pubkey");
      localStorage.removeItem("sf_shop_slug");
    }
  }, []);

  if (isRootMarketplaceLanding) {
    return <MarketplaceRootLanding />;
  }

  return (
    <>
      {!focusedPubkey && !hasTaxonomyScope && (
        <div className="flex h-auto w-full items-center justify-center bg-white bg-cover bg-center pt-20 dark:bg-black">
          <img
            src="/shop-freely-light.png"
            alt="Shopstr Banner"
            className="hidden max-h-[210px] w-full items-center justify-center object-cover sm:flex dark:hidden"
          />
          <img
            src="/shop-freely-dark.png"
            alt="Shopstr Banner"
            className="hidden max-h-[210px] w-full items-center justify-center object-cover sm:hidden dark:sm:flex"
          />
          <img
            src="/shop-freely-light-sm.png"
            alt="Shopstr Banner"
            className="flex max-h-[210px] w-full items-center justify-center object-cover pb-4 sm:hidden dark:hidden"
          />
          <img
            src="/shop-freely-dark-sm.png"
            alt="Shopstr Banner"
            className="hidden max-h-[210px] w-full items-center justify-center object-cover pb-4 dark:flex dark:sm:hidden"
          />
        </div>
      )}
      <div
        className={`bg-light-bg dark:bg-dark-bg flex h-full min-h-screen flex-col ${
          focusedPubkey ? "pt-20" : ""
        }`}
      >
        <HomeFeed
          focusedPubkey={focusedPubkey}
          setFocusedPubkey={setFocusedPubkey}
          selectedSection={selectedSection}
          setSelectedSection={setSelectedSection}
        />
      </div>
    </>
  );
}

function MarketplaceRootLanding() {
  const { registry } = useContext(TaxonomyContext);
  const productContext = useContext(ProductContext);
  const { siteLanguage } = useContext(SiteLanguageContext);

  const marketplaceHomeBrowseSections = useMemo<
    MarketplaceBrowseSection[]
  >(() => {
    if (!registry) return [];
    return buildMarketplaceNavSections({
      mode: "root",
      registry,
      locale: siteLanguage,
    }).map((section) => ({
      key: section.id,
      title: section.label,
      items: section.items.map((item) => ({
        ref: item.ref,
        label: item.label,
        image: getNodeImage(registry, item.ref),
        tileImages: getTaxonomyTileImages(registry, item.ref, siteLanguage),
        href: buildMarketplaceHref({
          contextRef: item.kind === "context" ? item.ref : undefined,
          thingRef: item.kind === "thing" ? item.ref : undefined,
        }),
      })),
    }));
  }, [registry, siteLanguage]);

  const taxonomyListings = useMemo(() => {
    const productEvents = Array.isArray(productContext.productEvents)
      ? productContext.productEvents
      : [];
    return productEvents
      .filter((event: NostrEvent) => event.kind === 30402)
      .map((event: NostrEvent) => parseTags(event))
      .filter((productData): productData is ProductData =>
        Boolean(productData?.taxonomy)
      )
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [productContext.productEvents]);
  const recentTaxonomyListings = taxonomyListings.slice(0, 4);

  return (
    <div className="text-light-text dark:bg-dark-bg dark:text-dark-text min-h-screen bg-white">
      <ShopstrMarketplaceBanner />
      <main className="mx-auto max-w-7xl space-y-12 px-4 py-10">
        <MarketplaceBrowseSections sections={marketplaceHomeBrowseSections} />
        <section className="border-default-200/70 dark:border-default-800 border-t pt-10">
          <div className="mb-5 flex items-center justify-between gap-3">
            <h2 className="text-2xl font-semibold">Recently listed items</h2>
            {recentTaxonomyListings.length > 0 && (
              <Link
                href="/marketplace?listings=1"
                className="text-shopstr-purple dark:text-shopstr-yellow text-sm font-medium"
              >
                View all
              </Link>
            )}
          </div>
          {recentTaxonomyListings.length > 0 ? (
            <div className="grid grid-cols-1 justify-items-center gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {recentTaxonomyListings.map((productData) => (
                <ProductCard
                  key={productData.id}
                  productData={productData}
                  href={`/listing/${
                    getListingSlug(productData, taxonomyListings) ||
                    productData.id
                  }`}
                />
              ))}
            </div>
          ) : (
            <p className="text-default-500 text-sm">Nothing listed yet</p>
          )}
        </section>
      </main>
    </div>
  );
}

function ShopstrMarketplaceBanner() {
  return (
    <div className="flex h-auto w-full items-center justify-center bg-white bg-cover bg-center pt-20 dark:bg-black">
      <img
        src="/shop-freely-light.png"
        alt="Shopstr Banner"
        className="hidden max-h-[210px] w-full items-center justify-center object-cover sm:flex dark:hidden"
      />
      <img
        src="/shop-freely-dark.png"
        alt="Shopstr Banner"
        className="hidden max-h-[210px] w-full items-center justify-center object-cover sm:hidden dark:sm:flex"
      />
      <img
        src="/shop-freely-light-sm.png"
        alt="Shopstr Banner"
        className="flex max-h-[210px] w-full items-center justify-center object-cover pb-4 sm:hidden dark:hidden"
      />
      <img
        src="/shop-freely-dark-sm.png"
        alt="Shopstr Banner"
        className="hidden max-h-[210px] w-full items-center justify-center object-cover pb-4 dark:flex dark:sm:hidden"
      />
    </div>
  );
}
