import type { ReactNode } from "react";

type MarketplaceBreadcrumbsProps = {
  refs: string[];
  rootLabel?: string;
  rootHref?: string;
  getLabel: (ref: string) => string;
  getHref: (ref: string) => string;
  onNavigate: (href: string) => void;
  renderLink?: (href: string, children: ReactNode) => ReactNode;
};

const ELLIPSIS_REF = "__ellipsis__";
const ROOT_REF = "__root__";

export default function MarketplaceBreadcrumbs({
  refs,
  rootLabel = "Marketplace",
  rootHref = "/marketplace",
  getLabel,
  getHref,
  onNavigate,
  renderLink,
}: MarketplaceBreadcrumbsProps) {
  const allRefs = [ROOT_REF, ...refs];
  const visibleRefs =
    allRefs.length > 4
      ? [allRefs[0] || "", ELLIPSIS_REF, ...allRefs.slice(-3)].filter(Boolean)
      : allRefs;

  if (visibleRefs.length === 0) return null;

  const labelForRef = (ref: string) =>
    ref === ROOT_REF ? rootLabel : getLabel(ref);
  const hrefForRef = (ref: string) =>
    ref === ROOT_REF ? rootHref : getHref(ref);

  return (
    <>
      {visibleRefs.map((ref, index) => (
        <span
          key={`${ref}-${index}`}
          className="inline-flex items-center gap-2"
        >
          {index > 0 && <span>→</span>}
          {ref === ELLIPSIS_REF ? (
            <span aria-hidden="true">…</span>
          ) : index === visibleRefs.length - 1 ? (
            <span
              className="text-default-700 dark:text-default-200 font-semibold"
              aria-current="page"
            >
              {labelForRef(ref)}
            </span>
          ) : renderLink ? (
            renderLink(hrefForRef(ref), labelForRef(ref))
          ) : (
            <button
              className="hover:text-shopstr-purple"
              onClick={() => onNavigate(hrefForRef(ref))}
            >
              {labelForRef(ref)}
            </button>
          )}
        </span>
      ))}
    </>
  );
}
