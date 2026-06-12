import Link from "next/link";
import type { TaxonomyTileImage } from "@/utils/taxonomy/display";

export const TAXONOMY_BROWSE_TILE_GRID_CLASS =
  "grid grid-cols-2 justify-center justify-items-center gap-6 sm:grid-cols-3 lg:grid-cols-5";

export default function TaxonomyBrowseTile({
  label,
  image,
  tileImages,
  subtitle,
  onClick,
  href,
  taxonRef,
}: {
  label: string;
  image?: string;
  tileImages?: TaxonomyTileImage[];
  subtitle?: string;
  onClick?: () => void;
  href?: string;
  taxonRef?: string;
}) {
  const usesLogoTreatment = Boolean(
    taxonRef?.startsWith("thing:organization") ||
    taxonRef?.startsWith("thing:person")
  );
  const imageClassName = usesLogoTreatment
    ? "block h-full w-full object-contain object-center"
    : "block h-full w-full object-cover object-center";
  const resolvedImages =
    tileImages && tileImages.length > 0
      ? tileImages.slice(0, 4)
      : image
        ? [
            {
              src: image,
              alt: label,
              ref: taxonRef || "",
              fit: usesLogoTreatment
                ? ("contain" as const)
                : ("cover" as const),
            },
          ]
        : [];

  const renderImageCell = (
    tileImage?: TaxonomyTileImage,
    index: number = 0
  ) => (
    <div
      key={tileImage?.ref || `empty-${index}`}
      className="bg-default-100 dark:bg-default-800 h-full w-full"
    >
      {tileImage && (
        <img
          src={tileImage.src}
          alt={tileImage.alt}
          className={`block h-full w-full object-center ${tileImage.fit === "contain" ? "object-contain p-2" : "object-cover"}`}
        />
      )}
    </div>
  );

  const imageArea = (() => {
    if (resolvedImages.length === 0) {
      return (
        <div className="text-default-400 flex h-full w-full items-center justify-center text-3xl font-semibold">
          {label.slice(0, 1)}
        </div>
      );
    }
    if (resolvedImages.length === 1) {
      const tileImage = resolvedImages[0]!;
      return (
        <img
          src={tileImage.src}
          alt={tileImage.alt}
          className={
            tileImages && tileImages.length > 0
              ? `block h-full w-full object-center ${tileImage.fit === "contain" ? "object-contain p-2" : "object-cover"}`
              : imageClassName
          }
        />
      );
    }
    if (resolvedImages.length === 2) {
      return (
        <div className="grid h-full w-full grid-cols-2">
          {resolvedImages.map((tileImage, index) =>
            renderImageCell(tileImage, index)
          )}
        </div>
      );
    }
    return (
      <div className="grid h-full w-full grid-cols-2 grid-rows-2">
        {[0, 1, 2, 3].map((index) =>
          renderImageCell(resolvedImages[index], index)
        )}
      </div>
    );
  })();

  const content = (
    <>
      <div className="bg-default-100 dark:bg-default-800 relative aspect-square w-full overflow-hidden rounded-lg">
        {imageArea}
      </div>
      <div className="p-4 text-center">
        <p className="text-light-text dark:text-dark-text truncate text-base font-semibold">
          {label}
        </p>
        {subtitle && (
          <p className="text-default-500 mt-1 truncate text-xs">{subtitle}</p>
        )}
      </div>
    </>
  );

  const className =
    "group block w-full max-w-40 min-w-0 overflow-hidden rounded-lg border border-default-200 bg-white text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-default-800 dark:bg-neutral-900";

  if (href) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" className={className} onClick={onClick}>
      {content}
    </button>
  );
}
