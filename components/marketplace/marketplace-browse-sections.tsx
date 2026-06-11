import TaxonomyBrowseTile, {
  TAXONOMY_BROWSE_TILE_GRID_CLASS,
} from "@/components/utility-components/taxonomy-browse-tile";
import { TaxonomyTileImage } from "@/utils/taxonomy/display";

export type MarketplaceBrowseTileItem = {
  ref: string;
  label: string;
  image?: string;
  tileImages?: TaxonomyTileImage[];
  href?: string;
  onClick?: () => void;
};

export type MarketplaceBrowseSection = {
  key: string;
  title?: string;
  groups?: Array<{
    key: string;
    label?: string;
    items: MarketplaceBrowseTileItem[];
  }>;
  items?: MarketplaceBrowseTileItem[];
};

type MarketplaceBrowseSectionsProps = {
  sections: MarketplaceBrowseSection[];
};

export default function MarketplaceBrowseSections({
  sections,
}: MarketplaceBrowseSectionsProps) {
  if (sections.length === 0) return null;

  return (
    <>
      {sections.map((section) => (
        <div key={section.key} className="mt-8">
          {section.title && (
            <p className="text-default-500 mb-3 text-left text-xs font-medium">
              {section.title}
            </p>
          )}
          {section.groups ? (
            section.groups.map((group) => (
              <div key={group.key} className="mb-6">
                {group.label && (
                  <p className="text-default-500 mb-3 text-left text-xs font-medium">
                    {group.label}
                  </p>
                )}
                <div
                  className={`mx-auto max-w-6xl ${TAXONOMY_BROWSE_TILE_GRID_CLASS}`}
                >
                  {group.items.map(renderTile)}
                </div>
              </div>
            ))
          ) : (
            <div
              className={`mx-auto max-w-6xl ${TAXONOMY_BROWSE_TILE_GRID_CLASS}`}
            >
              {(section.items || []).map(renderTile)}
            </div>
          )}
        </div>
      ))}
    </>
  );
}

function renderTile(item: MarketplaceBrowseTileItem) {
  return (
    <TaxonomyBrowseTile
      key={item.ref}
      taxonRef={item.ref}
      label={item.label}
      image={item.image}
      tileImages={item.tileImages}
      href={item.href}
      onClick={item.onClick}
    />
  );
}
