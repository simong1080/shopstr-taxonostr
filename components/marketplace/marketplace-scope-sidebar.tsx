import { MarketplaceScopeSidebarSection } from "@/utils/taxonomy/marketplace-scope";

type MarketplaceScopeSidebarProps = {
  sections: MarketplaceScopeSidebarSection[];
  getHref: (item: MarketplaceScopeSidebarSection["items"][number]) => string;
  onNavigate: (href: string) => void;
};

export default function MarketplaceScopeSidebar({
  sections,
  getHref,
  onNavigate,
}: MarketplaceScopeSidebarProps) {
  const renderItem = (
    item: MarketplaceScopeSidebarSection["items"][number]
  ) => {
    const className = `block w-full rounded-md py-1.5 pr-2 text-left text-sm transition ${
      item.depth > 0 ? "pl-5" : "pl-2"
    } ${
      item.isCurrent
        ? "font-semibold text-shopstr-purple dark:text-shopstr-purple"
        : "text-default-700 hover:bg-default-100 hover:text-shopstr-purple dark:text-default-300 dark:hover:bg-default-800"
    }`;
    const label = (
      <span className="inline-flex max-w-full items-center gap-2">
        <span className="truncate">{item.label}</span>
      </span>
    );

    if (item.isCurrent) {
      return (
        <div key={item.ref} className={className} aria-current="page">
          {label}
        </div>
      );
    }

    return (
      <button
        key={item.ref}
        type="button"
        className={className}
        onClick={() => onNavigate(getHref(item))}
      >
        {label}
      </button>
    );
  };

  return (
    <aside className="border-default-200/70 dark:border-default-700/70 hidden w-56 shrink-0 rounded-xl border bg-white/80 p-4 text-left shadow-sm lg:block dark:bg-neutral-900/70">
      <p className="text-default-500 mb-4 text-xs font-semibold tracking-wide uppercase">
        Browse
      </p>
      <div className="space-y-5">
        {sections.map((section) => (
          <div key={section.id}>
            <p className="text-default-500 mb-2 text-xs font-medium">
              {section.label}
            </p>
            <div className="space-y-1">{section.items.map(renderItem)}</div>
          </div>
        ))}
      </div>
    </aside>
  );
}
