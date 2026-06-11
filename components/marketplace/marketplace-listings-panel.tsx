import { Pagination } from "@heroui/react";
import ProductCard from "@/components/utility-components/product-card";
import { ProductData } from "@/utils/parsers/product-parser-functions";

type MarketplaceListingsPanelProps = {
  products: ProductData[];
  totalPages: number;
  currentPage: number;
  isProductsLoading: boolean;
  shouldShowListings: boolean;
  wotFilter?: boolean;
  baseScopeResultCount: number;
  getProductHref: (product: ProductData) => string | null;
  onPageChange: (page: number) => void;
  onProductClick: (
    product: ProductData,
    event?: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>
  ) => void;
  filterBar?: React.ReactNode;
};

export default function MarketplaceListingsPanel({
  products,
  totalPages,
  currentPage,
  isProductsLoading,
  shouldShowListings,
  wotFilter,
  baseScopeResultCount,
  getProductHref,
  onPageChange,
  onProductClick,
  filterBar,
}: MarketplaceListingsPanelProps) {
  return (
    <>
      {filterBar}
      {products.length > 0 ? (
        <>
          <div className="grid max-w-full grid-cols-[repeat(auto-fill,minmax(300px,1fr))] justify-items-stretch gap-4 overflow-x-hidden pb-6">
            {products.map((productData, index) => (
              <ProductCard
                key={productData.id + "-" + index}
                productData={productData}
                onProductClick={onProductClick}
                href={getProductHref(productData)}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="mt-6 flex justify-center pb-4">
              <Pagination
                total={totalPages}
                page={currentPage}
                onChange={onPageChange}
                showControls
                classNames={{
                  cursor:
                    "bg-primary-yellow text-black font-bold border-2 border-black shadow-neo",
                  item: "bg-white text-black font-semibold border-2 border-black",
                  prev: "bg-white text-black border-2 border-black",
                  next: "bg-white text-black border-2 border-black",
                }}
              />
            </div>
          )}
        </>
      ) : (
        !isProductsLoading &&
        shouldShowListings && (
          <div className="mt-10 flex flex-grow items-center justify-center py-10">
            <div className="bg-light-fg dark:bg-dark-fg w-full max-w-lg rounded-lg p-8 text-center shadow-lg">
              <p className="text-light-text dark:text-dark-text text-3xl font-semibold">
                {wotFilter
                  ? "No products found..."
                  : baseScopeResultCount > 0
                    ? "No listings match these filters"
                    : "No listings found in this scope"}
              </p>
              <p className="text-light-text dark:text-dark-text mt-4 text-lg">
                {wotFilter
                  ? "Try turning off the trust filter!"
                  : "Try a broader category or remove a filter."}
              </p>
            </div>
          </div>
        )
      )}
    </>
  );
}
