import { Image } from "@heroui/react";
import { ReactNode } from "react";

export const TAXONOMY_CHIP_CLASS =
  "inline-flex max-w-full items-center gap-2 rounded-full border border-default-200/70 px-2.5 py-1.5 text-sm text-default-600 transition dark:border-default-700/70 dark:text-default-300";

export const TAXONOMY_CHIP_INTERACTIVE_CLASS = `${TAXONOMY_CHIP_CLASS} hover:border-shopstr-purple hover:text-shopstr-purple dark:hover:border-shopstr-yellow dark:hover:text-shopstr-yellow`;

export const TAXONOMY_CHIP_IMAGE_CLASS =
  "h-5 w-5 shrink-0 rounded-full object-cover";

type TaxonomyPillVariant = "default" | "interactive" | "selected" | "filter";
type TaxonomyPillSize = "sm" | "md";

export function TaxonomyChipImage({ src, alt }: { src: string; alt: string }) {
  return (
    <Image
      src={src}
      alt={alt}
      width={20}
      height={20}
      className={TAXONOMY_CHIP_IMAGE_CLASS}
    />
  );
}

export function TaxonomyChip({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`${TAXONOMY_CHIP_CLASS} ${className}`.trim()}>
      {children}
    </span>
  );
}

export function TaxonomyPill({
  label,
  imageUrl,
  selected = false,
  removable = false,
  onRemove,
  removeLabel,
  variant = selected ? "selected" : "default",
  size = "md",
  className = "",
}: {
  label: ReactNode;
  imageUrl?: string;
  selected?: boolean;
  removable?: boolean;
  onRemove?: () => void;
  removeLabel?: string;
  variant?: TaxonomyPillVariant;
  size?: TaxonomyPillSize;
  className?: string;
}) {
  const sizeClass =
    size === "sm" ? "px-2.5 py-1.5 text-sm" : "px-2.5 py-1.5 text-sm";
  const variantClass =
    variant === "filter"
      ? "border-shopstr-purple/50 bg-shopstr-purple font-medium text-white shadow-sm hover:bg-shopstr-purple/90 focus:outline-none focus:ring-2 focus:ring-shopstr-purple/40"
      : variant === "selected"
        ? "border-default-300 bg-default-100 font-medium text-default-800 dark:border-default-600 dark:bg-default-800 dark:text-default-100"
        : variant === "interactive"
          ? "border-default-200/70 text-default-600 hover:border-shopstr-purple hover:text-shopstr-purple dark:border-default-700/70 dark:text-default-300 dark:hover:border-shopstr-yellow dark:hover:text-shopstr-yellow"
          : "border-default-200/70 text-default-600 dark:border-default-700/70 dark:text-default-300";
  const removeClass =
    variant === "filter"
      ? "text-white/80 hover:bg-white/15 focus:ring-white/40"
      : "text-default-500 hover:bg-default-200/80 hover:text-default-800 focus:ring-shopstr-purple/30 dark:hover:bg-default-700 dark:hover:text-default-100";
  const content = (
    <>
      {imageUrl && <TaxonomyChipImage src={imageUrl} alt={String(label)} />}
      <span className="truncate">{label}</span>
      {removable && onRemove && (
        <button
          type="button"
          className={`-mr-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-sm leading-none focus:ring-2 focus:outline-none ${removeClass}`}
          aria-label={removeLabel || `Remove ${String(label)}`}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
        >
          ×
        </button>
      )}
    </>
  );
  const pillClassName =
    `inline-flex max-w-full items-center gap-2 rounded-full border transition ${sizeClass} ${variantClass} ${className}`.trim();

  return <span className={pillClassName}>{content}</span>;
}
