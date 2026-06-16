import { buildActiveMarketplaceState } from "@/utils/taxonomy/marketplace-scope";
import {
  buildMarketplaceResultsViewModel,
  deriveFilterImplications,
} from "@/utils/taxonomy/marketplace-results";
import { buildEffectiveListingTaxonomyFacts } from "@/utils/taxonomy/listing-facts";
import { buildRegistry } from "@/utils/taxonomy/registry";
import { validateProductTaxonomy } from "@/utils/taxonomy/validation";
import { ProductData } from "@/utils/parsers/product-parser-functions";
import { NostrEvent } from "@/utils/types/types";

const PUBKEY = "TAXONOSTR_PUBKEY";

function event(d: string, content: Record<string, unknown>): NostrEvent {
  return {
    id: `${d}-id`,
    pubkey: PUBKEY,
    created_at: 1772400000,
    kind: 30078,
    tags: [["d", d]],
    content: JSON.stringify(content),
    sig: `${d}-sig`,
  } as NostrEvent;
}

function product(
  id: string,
  leagueRef: string,
  conditionRef = "val:condition:used",
  sportRef?: string
): ProductData {
  return {
    id,
    pubkey: "seller",
    createdAt: 1772400000,
    title: id,
    summary: "",
    publishedAt: "",
    images: [`https://example.test/${id}.jpg`],
    categories: [],
    location: "",
    price: 10,
    currency: "USD",
    totalCost: 10,
    taxonomy: {
      primaryThingRef: "thing:artifact:trading_card",
      overlayValRefs: ["val:context:segment:collectible_cards"],
      requiredRefs: [],
      refAssertions: [
        ...(sportRef ? [{ propRef: "prop:sport", valueRef: sportRef }] : []),
        { propRef: "prop:league", valueRef: leagueRef },
        { propRef: "prop:condition", valueRef: conditionRef },
      ],
      literalAssertions: [],
    },
  };
}

function booleanProduct(id: string): ProductData {
  const listedProduct = product(
    id,
    "thing:organization:league:mlb",
    "val:condition:used",
    "val:sport:baseball"
  );
  listedProduct.taxonomy!.literalAssertions = [
    {
      propRef: "prop:autographed",
      valueTypeRef: "valtype:boolean",
      value: true,
    },
  ];
  return listedProduct;
}

function teamProduct(id: string): ProductData {
  const listedProduct = product(
    id,
    "thing:organization:league:nhl",
    "val:condition:used"
  );
  listedProduct.taxonomy!.refAssertions = [
    {
      propRef: "prop:team",
      valueRef: "thing:organization:sports_team:seattle_kraken",
    },
    { propRef: "prop:condition", valueRef: "val:condition:used" },
  ];
  return listedProduct;
}

function teamOnlyProduct(
  id: string,
  teamRef: string,
  conditionRef = "val:condition:used"
): ProductData {
  const listedProduct = product(
    id,
    "thing:organization:league:mlb",
    conditionRef
  );
  listedProduct.taxonomy!.refAssertions = [
    {
      propRef: "prop:team",
      valueRef: teamRef,
    },
    { propRef: "prop:condition", valueRef: conditionRef },
  ];
  return listedProduct;
}

function impliedSportProduct(id: string): ProductData {
  return {
    id,
    pubkey: "seller",
    createdAt: 1772400000,
    title: id,
    summary: "",
    publishedAt: "",
    images: [`https://example.test/${id}.jpg`],
    categories: [],
    location: "",
    price: 10,
    currency: "USD",
    totalCost: 10,
    taxonomy: {
      primaryThingRef: "thing:artifact:helmet:baseball_batting_helmet",
      overlayValRefs: ["val:context:segment:collectible_cards"],
      requiredRefs: ["val:sport:baseball"],
      refAssertions: [
        { propRef: "prop:condition", valueRef: "val:condition:used" },
      ],
      literalAssertions: [],
    },
  };
}

function orphanRequiredValueProduct(id: string): ProductData {
  const listedProduct = product(
    id,
    "thing:organization:league:mlb",
    "val:condition:used"
  );
  listedProduct.taxonomy!.requiredRefs = ["val:sport:baseball"];
  return listedProduct;
}

function registry() {
  return buildRegistry(
    [
      event("val:context", { labels: { en: "Context" } }),
      event("val:context:segment", {
        labels: { en: "Segment" },
        parents: ["val:context"],
      }),
      event("val:context:segment:collectible_cards", {
        labels: { en: "Collectible cards" },
        parents: ["val:context:segment"],
      }),
      event("thing:artifact", { labels: { en: "Artifact" } }),
      event("thing:artifact:trading_card", {
        labels: { en: "Trading card" },
        parents: ["thing:artifact"],
        relations: [
          "val:context:segment:collectible_cards",
          "prop:condition",
          "prop:sport",
        ],
      }),
      event("thing:artifact:helmet", {
        labels: { en: "Helmet" },
        parents: ["thing:artifact"],
        relations: ["val:context:segment:collectible_cards", "prop:condition"],
      }),
      event("thing:artifact:helmet:baseball_batting_helmet", {
        labels: { en: "Baseball batting helmet" },
        parents: ["thing:artifact:helmet"],
        requiredRelations: ["val:sport:baseball"],
      }),
      event("prop:condition", {
        labels: { en: "Condition" },
        relations: ["val:condition"],
      }),
      event("prop:autographed", {
        labels: { en: "Autographed" },
        relations: ["valtype:boolean"],
      }),
      event("prop:sport", {
        labels: { en: "Sport" },
        relations: ["val:sport", "prop:league"],
      }),
      event("prop:league", {
        labels: { en: "League" },
        relations: ["thing:organization:league", "prop:team"],
      }),
      event("prop:team", {
        labels: { en: "Team" },
        relations: ["thing:organization:sports_team"],
      }),
      event("valtype:boolean", { labels: { en: "Boolean" } }),
      event("val:condition", { labels: { en: "Condition values" } }),
      event("val:condition:used", {
        labels: { en: "Used" },
        parents: ["val:condition"],
      }),
      event("val:condition:graded", {
        labels: { en: "Graded" },
        parents: ["val:condition"],
      }),
      event("val:sport", { labels: { en: "Sport values" } }),
      event("val:sport:baseball", {
        labels: { en: "Baseball" },
        parents: ["val:sport"],
        relations: ["thing:organization:league:mlb"],
      }),
      event("val:sport:basketball", {
        labels: { en: "Basketball" },
        parents: ["val:sport"],
        relations: ["thing:organization:league:nba"],
      }),
      event("val:sport:football", {
        labels: { en: "Football" },
        parents: ["val:sport"],
        relations: ["thing:organization:league:bundesliga"],
      }),
      event("val:sport:ice_hockey", {
        labels: { en: "Ice hockey" },
        parents: ["val:sport"],
      }),
      event("val:sport:rugby_league", {
        labels: { en: "Rugby league" },
        parents: ["val:sport"],
      }),
      event("thing:organization", { labels: { en: "Organization" } }),
      event("thing:organization:league", {
        labels: { en: "League" },
        parents: ["thing:organization"],
      }),
      event("thing:organization:league:mlb", {
        labels: { en: "MLB" },
        parents: ["thing:organization:league"],
      }),
      event("thing:organization:league:nba", {
        labels: { en: "NBA" },
        parents: ["thing:organization:league"],
        relations: ["val:sport:basketball"],
      }),
      event("thing:organization:league:nhl", {
        labels: { en: "NHL" },
        parents: ["thing:organization:league"],
        relations: ["val:sport:ice_hockey"],
      }),
      event("thing:organization:league:bundesliga", {
        labels: { en: "Bundesliga" },
        parents: ["thing:organization:league"],
        relations: ["val:sport:football"],
      }),
      event("thing:organization:sports_team", {
        labels: { en: "Sports team" },
        parents: ["thing:organization"],
      }),
      event("thing:organization:sports_team:seattle_kraken", {
        labels: { en: "Seattle Kraken" },
        parents: ["thing:organization:sports_team"],
        relations: ["thing:organization:league:nhl"],
      }),
      event("thing:organization:sports_team:carolina_hurricanes", {
        labels: { en: "Carolina Hurricanes" },
        parents: ["thing:organization:sports_team"],
        relations: ["thing:organization:league:nhl"],
      }),
      event("thing:organization:sports_team:philadelphia_76ers", {
        labels: { en: "Philadelphia 76ers" },
        parents: ["thing:organization:sports_team"],
        relations: ["thing:organization:league:nba"],
      }),
      event("thing:organization:sports_team:bayern_munich", {
        labels: { en: "Bayern Munich" },
        parents: ["thing:organization:sports_team"],
        relations: ["thing:organization:league:bundesliga"],
      }),
    ],
    { trustedPubkeys: [PUBKEY] }
  );
}

describe("marketplace results view model", () => {
  it("promotes only observed taxonomy facets with browse-capable values", () => {
    const testRegistry = registry();
    const scopeState = buildActiveMarketplaceState(
      {
        thing: "thing:artifact:trading_card",
        context: "val:context:segment:collectible_cards",
      },
      testRegistry
    );

    const viewModel = buildMarketplaceResultsViewModel({
      products: [
        product(
          "mlb-card",
          "thing:organization:league:mlb",
          "val:condition:used",
          "val:sport:baseball"
        ),
        product(
          "nba-card",
          "thing:organization:league:nba",
          "val:condition:graded",
          "val:sport:basketball"
        ),
      ],
      registry: testRegistry,
      scopeState,
      selectedCategories: new Set(),
      selectedLocation: "",
      selectedSearch: "",
      selectedAspectFilters: {},
      locale: "en",
    });

    expect(
      viewModel.actualFacetFilters.map((filter) => filter.propRef)
    ).toEqual(["prop:sport", "prop:league", "prop:condition"]);
    expect(
      viewModel.actualFacetFilters.find(
        (filter) => filter.propRef === "prop:sport"
      )?.values
    ).toEqual([
      ["val:sport:baseball", "Baseball"],
      ["val:sport:basketball", "Basketball"],
    ]);
    expect(
      viewModel.actualFacetFilters.find(
        (filter) => filter.propRef === "prop:sport"
      )?.values
    ).not.toContainEqual(["val:sport:rugby_league", "Rugby league"]);
    expect(viewModel.promotedFacetSections).toEqual([]);
  });

  it("builds filters from observed listing assertions on context-only listing pages", () => {
    const testRegistry = registry();
    const scopeState = buildActiveMarketplaceState(
      {
        context: "val:context:segment:collectible_cards",
        listings: "1",
      },
      testRegistry
    );

    const viewModel = buildMarketplaceResultsViewModel({
      products: [
        product(
          "mlb-card",
          "thing:organization:league:mlb",
          "val:condition:used",
          "val:sport:baseball"
        ),
        product(
          "nba-card",
          "thing:organization:league:nba",
          "val:condition:graded",
          "val:sport:basketball"
        ),
      ],
      registry: testRegistry,
      scopeState,
      selectedCategories: new Set(),
      selectedLocation: "",
      selectedSearch: "",
      selectedAspectFilters: {},
      locale: "en",
    });

    expect(
      viewModel.actualFacetFilters.map((filter) => filter.propRef)
    ).toEqual(["prop:sport", "prop:league", "prop:condition"]);
    expect(
      viewModel.actualFacetFilters.find(
        (filter) => filter.propRef === "prop:league"
      )?.values
    ).toEqual([
      ["thing:organization:league:mlb", "MLB"],
      ["thing:organization:league:nba", "NBA"],
    ]);
  });

  it("keeps selected pv filters on context-only listing pages", () => {
    const testRegistry = registry();
    const scopeState = buildActiveMarketplaceState(
      {
        context: "val:context:segment:collectible_cards",
        listings: "1",
        pv: "prop:sport|val:sport:baseball",
      },
      testRegistry
    );

    const viewModel = buildMarketplaceResultsViewModel({
      products: [
        product(
          "mlb-card",
          "thing:organization:league:mlb",
          "val:condition:used",
          "val:sport:baseball"
        ),
        product(
          "nba-card",
          "thing:organization:league:nba",
          "val:condition:graded",
          "val:sport:basketball"
        ),
      ],
      registry: testRegistry,
      scopeState,
      selectedCategories: new Set(),
      selectedLocation: "",
      selectedSearch: "",
      selectedAspectFilters: {},
      locale: "en",
    });

    expect(scopeState.selectedValuesByProp).toEqual({
      "prop:sport": ["val:sport:baseball"],
    });
    expect(
      viewModel.filteredProducts.map((listedProduct) => listedProduct.id)
    ).toEqual(["mlb-card"]);
    expect(
      viewModel.actualFacetFilters.find(
        (filter) => filter.propRef === "prop:sport"
      )?.values
    ).toEqual([
      ["val:sport:baseball", "Baseball"],
      ["val:sport:basketball", "Basketball"],
    ]);
    expect(viewModel.selectedFacetChips).toEqual([
      {
        propRef: "prop:sport",
        valueRef: "val:sport:baseball",
        label: "Sport",
        valueLabel: "Baseball",
        source: "explicit",
        removable: true,
      },
    ]);
  });

  it("uses selected pv values to activate and narrow dependent filters", () => {
    const testRegistry = registry();
    const scopeState = buildActiveMarketplaceState(
      {
        thing: "thing:artifact:trading_card",
        context: "val:context:segment:collectible_cards",
        listings: "1",
        pv: "prop:sport|val:sport:baseball",
      },
      testRegistry
    );

    const viewModel = buildMarketplaceResultsViewModel({
      products: [
        product(
          "mlb-card",
          "thing:organization:league:mlb",
          "val:condition:used",
          "val:sport:baseball"
        ),
        product(
          "nba-card",
          "thing:organization:league:nba",
          "val:condition:graded",
          "val:sport:basketball"
        ),
      ],
      registry: testRegistry,
      scopeState,
      selectedCategories: new Set(),
      selectedLocation: "",
      selectedSearch: "",
      selectedAspectFilters: {},
      locale: "en",
    });

    expect(
      viewModel.filteredProducts.map((listedProduct) => listedProduct.id)
    ).toEqual(["mlb-card"]);
    expect(
      viewModel.actualFacetFilters.find(
        (filter) => filter.propRef === "prop:sport"
      )?.values
    ).toEqual([
      ["val:sport:baseball", "Baseball"],
      ["val:sport:basketball", "Basketball"],
    ]);
    expect(
      viewModel.actualFacetFilters.find(
        (filter) => filter.propRef === "prop:league"
      )?.values
    ).toEqual([["thing:organization:league:mlb", "MLB"]]);
    expect(
      viewModel.actualFacetFilters.find(
        (filter) => filter.propRef === "prop:league"
      )?.values
    ).not.toContainEqual(["thing:organization:league:nba", "NBA"]);
  });

  it("matches repeated pv values on the same prop as OR", () => {
    const testRegistry = registry();
    const scopeState = buildActiveMarketplaceState(
      {
        thing: "thing:artifact:trading_card",
        context: "val:context:segment:collectible_cards",
        listings: "1",
        pv: [
          "prop:sport|val:sport:baseball",
          "prop:sport|val:sport:basketball",
        ],
      },
      testRegistry
    );

    const viewModel = buildMarketplaceResultsViewModel({
      products: [
        product(
          "mlb-card",
          "thing:organization:league:mlb",
          "val:condition:used",
          "val:sport:baseball"
        ),
        product(
          "nba-card",
          "thing:organization:league:nba",
          "val:condition:graded",
          "val:sport:basketball"
        ),
        product(
          "rugby-card",
          "thing:organization:league:mlb",
          "val:condition:used",
          "val:sport:rugby_league"
        ),
      ],
      registry: testRegistry,
      scopeState,
      selectedCategories: new Set(),
      selectedLocation: "",
      selectedSearch: "",
      selectedAspectFilters: {},
      locale: "en",
    });

    expect(scopeState.selectedValuesByProp["prop:sport"]).toEqual([
      "val:sport:baseball",
      "val:sport:basketball",
    ]);
    expect(
      viewModel.filteredProducts.map((listedProduct) => listedProduct.id)
    ).toEqual(["mlb-card", "nba-card"]);
    expect(viewModel.selectedFacetChips.map((chip) => chip.valueRef)).toEqual([
      "val:sport:baseball",
      "val:sport:basketball",
    ]);
  });

  it("matches selected values on different props as AND", () => {
    const testRegistry = registry();
    const scopeState = buildActiveMarketplaceState(
      {
        thing: "thing:artifact:trading_card",
        context: "val:context:segment:collectible_cards",
        listings: "1",
        pv: [
          "prop:sport|val:sport:baseball",
          "prop:condition|val:condition:graded",
        ],
      },
      testRegistry
    );

    const viewModel = buildMarketplaceResultsViewModel({
      products: [
        product(
          "used-baseball",
          "thing:organization:league:mlb",
          "val:condition:used",
          "val:sport:baseball"
        ),
        product(
          "graded-baseball",
          "thing:organization:league:mlb",
          "val:condition:graded",
          "val:sport:baseball"
        ),
        product(
          "graded-basketball",
          "thing:organization:league:nba",
          "val:condition:graded",
          "val:sport:basketball"
        ),
      ],
      registry: testRegistry,
      scopeState,
      selectedCategories: new Set(),
      selectedLocation: "",
      selectedSearch: "",
      selectedAspectFilters: {},
      locale: "en",
    });

    expect(
      viewModel.filteredProducts.map((listedProduct) => listedProduct.id)
    ).toEqual(["graded-baseball"]);
  });

  it("derives filter implications through generic prop dependency and value relation graph", () => {
    const testRegistry = registry();

    expect(
      deriveFilterImplications(testRegistry, [
        { propRef: "prop:league", valueRef: "thing:organization:league:nhl" },
      ])
    ).toEqual([{ propRef: "prop:sport", valueRef: "val:sport:ice_hockey" }]);

    expect(
      deriveFilterImplications(testRegistry, [
        {
          propRef: "prop:team",
          valueRef: "thing:organization:sports_team:seattle_kraken",
        },
      ])
    ).toEqual([
      { propRef: "prop:league", valueRef: "thing:organization:league:nhl" },
      { propRef: "prop:sport", valueRef: "val:sport:ice_hockey" },
    ]);

    expect(
      deriveFilterImplications(testRegistry, [
        { propRef: "prop:sport", valueRef: "val:sport:baseball" },
      ])
    ).toEqual([]);
  });

  it("renders derived selected filter pills and uses derived facts for matching", () => {
    const testRegistry = registry();
    const scopeState = buildActiveMarketplaceState(
      {
        context: "val:context:segment:collectible_cards",
        listings: "1",
        pv: "prop:team|thing:organization:sports_team:seattle_kraken",
      },
      testRegistry
    );

    const viewModel = buildMarketplaceResultsViewModel({
      products: [
        teamProduct("kraken-card"),
        product(
          "mlb-card",
          "thing:organization:league:mlb",
          "val:condition:used",
          "val:sport:baseball"
        ),
      ],
      registry: testRegistry,
      scopeState,
      selectedCategories: new Set(),
      selectedLocation: "",
      selectedSearch: "",
      selectedAspectFilters: {},
      locale: "en",
    });

    expect(
      viewModel.filteredProducts.map((listedProduct) => listedProduct.id)
    ).toEqual(["kraken-card"]);
    expect(viewModel.selectedFacetChips).toEqual([
      {
        propRef: "prop:team",
        valueRef: "thing:organization:sports_team:seattle_kraken",
        label: "Team",
        valueLabel: "Seattle Kraken",
        source: "explicit",
        removable: true,
      },
      {
        propRef: "prop:league",
        valueRef: "thing:organization:league:nhl",
        label: "League",
        valueLabel: "NHL",
        source: "derived",
        derivedFrom: [
          "prop:team|thing:organization:sports_team:seattle_kraken",
        ],
        removable: false,
      },
      {
        propRef: "prop:sport",
        valueRef: "val:sport:ice_hockey",
        label: "Sport",
        valueLabel: "Ice hockey",
        source: "derived",
        derivedFrom: [
          "prop:team|thing:organization:sports_team:seattle_kraken",
        ],
        removable: false,
      },
    ]);
    expect(
      viewModel.actualFacetFilters.find(
        (filter) => filter.propRef === "prop:sport"
      )
    ).toBeUndefined();
  });

  it("keeps an explicit league filter editable and renders implied sport as chip-only", () => {
    const testRegistry = registry();
    const scopeState = buildActiveMarketplaceState(
      {
        context: "val:context:segment:collectible_cards",
        listings: "1",
        pv: "prop:league|thing:organization:league:bundesliga",
      },
      testRegistry
    );

    const viewModel = buildMarketplaceResultsViewModel({
      products: [
        teamOnlyProduct(
          "bayern-card",
          "thing:organization:sports_team:bayern_munich"
        ),
        teamOnlyProduct(
          "sixers-card",
          "thing:organization:sports_team:philadelphia_76ers"
        ),
      ],
      registry: testRegistry,
      scopeState,
      selectedCategories: new Set(),
      selectedLocation: "",
      selectedSearch: "",
      selectedAspectFilters: {},
      locale: "en",
    });

    expect(
      viewModel.filteredProducts.map((listedProduct) => listedProduct.id)
    ).toEqual(["bayern-card"]);
    expect(
      viewModel.actualFacetFilters.find(
        (filter) => filter.propRef === "prop:league"
      )
    ).toMatchObject({ explicit: true });
    expect(
      viewModel.actualFacetFilters.find(
        (filter) => filter.propRef === "prop:sport"
      )
    ).toBeUndefined();
    expect(
      viewModel.actualFacetFilters.find(
        (filter) => filter.propRef === "prop:team"
      )?.values
    ).toEqual([
      ["thing:organization:sports_team:bayern_munich", "Bayern Munich"],
    ]);
    expect(viewModel.selectedFacetChips).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          propRef: "prop:sport",
          valueRef: "val:sport:football",
          source: "derived",
          removable: false,
        }),
      ])
    );
  });

  it("keeps multi-value explicit league filters editable and narrows teams to selected leagues", () => {
    const testRegistry = registry();
    const scopeState = buildActiveMarketplaceState(
      {
        context: "val:context:segment:collectible_cards",
        listings: "1",
        pv: [
          "prop:league|thing:organization:league:nba",
          "prop:league|thing:organization:league:nhl",
        ],
      },
      testRegistry
    );

    const viewModel = buildMarketplaceResultsViewModel({
      products: [
        teamOnlyProduct(
          "hurricanes-card",
          "thing:organization:sports_team:carolina_hurricanes"
        ),
        teamOnlyProduct(
          "sixers-card",
          "thing:organization:sports_team:philadelphia_76ers"
        ),
        teamOnlyProduct(
          "bayern-card",
          "thing:organization:sports_team:bayern_munich"
        ),
      ],
      registry: testRegistry,
      scopeState,
      selectedCategories: new Set(),
      selectedLocation: "",
      selectedSearch: "",
      selectedAspectFilters: {},
      locale: "en",
    });

    expect(
      viewModel.filteredProducts.map((listedProduct) => listedProduct.id)
    ).toEqual(["hurricanes-card", "sixers-card"]);
    expect(
      viewModel.actualFacetFilters.find(
        (filter) => filter.propRef === "prop:league"
      )
    ).toMatchObject({ explicit: true });
    expect(
      viewModel.actualFacetFilters.find(
        (filter) => filter.propRef === "prop:sport"
      )
    ).toBeUndefined();
    expect(
      viewModel.actualFacetFilters.find(
        (filter) => filter.propRef === "prop:team"
      )?.values
    ).toEqual([
      [
        "thing:organization:sports_team:carolina_hurricanes",
        "Carolina Hurricanes",
      ],
      [
        "thing:organization:sports_team:philadelphia_76ers",
        "Philadelphia 76ers",
      ],
    ]);
    expect(
      viewModel.selectedFacetChips
        .filter((chip) => chip.propRef === "prop:sport")
        .map((chip) => chip.valueRef)
    ).toEqual(["val:sport:basketball", "val:sport:ice_hockey"]);
  });

  it("keeps explicit team filters editable and hides implied league and sport controls", () => {
    const testRegistry = registry();
    const scopeState = buildActiveMarketplaceState(
      {
        context: "val:context:segment:collectible_cards",
        listings: "1",
        pv: [
          "prop:team|thing:organization:sports_team:carolina_hurricanes",
          "prop:team|thing:organization:sports_team:philadelphia_76ers",
        ],
      },
      testRegistry
    );

    const viewModel = buildMarketplaceResultsViewModel({
      products: [
        teamOnlyProduct(
          "hurricanes-card",
          "thing:organization:sports_team:carolina_hurricanes"
        ),
        teamOnlyProduct(
          "sixers-card",
          "thing:organization:sports_team:philadelphia_76ers"
        ),
        teamOnlyProduct(
          "bayern-card",
          "thing:organization:sports_team:bayern_munich"
        ),
      ],
      registry: testRegistry,
      scopeState,
      selectedCategories: new Set(),
      selectedLocation: "",
      selectedSearch: "",
      selectedAspectFilters: {},
      locale: "en",
    });

    expect(
      viewModel.filteredProducts.map((listedProduct) => listedProduct.id)
    ).toEqual(["hurricanes-card", "sixers-card"]);
    expect(
      viewModel.actualFacetFilters.find(
        (filter) => filter.propRef === "prop:team"
      )
    ).toMatchObject({ explicit: true });
    expect(
      viewModel.actualFacetFilters.find(
        (filter) => filter.propRef === "prop:league"
      )
    ).toBeUndefined();
    expect(
      viewModel.actualFacetFilters.find(
        (filter) => filter.propRef === "prop:sport"
      )
    ).toBeUndefined();
    expect(
      viewModel.selectedFacetChips
        .filter((chip) => chip.propRef === "prop:league")
        .map((chip) => chip.valueRef)
    ).toEqual([
      "thing:organization:league:nhl",
      "thing:organization:league:nba",
    ]);
    expect(
      viewModel.selectedFacetChips
        .filter((chip) => chip.propRef === "prop:sport")
        .map((chip) => chip.valueRef)
    ).toEqual(["val:sport:ice_hockey", "val:sport:basketball"]);
  });

  it("renders selected pv values as chips and filters products", () => {
    const testRegistry = registry();
    const scopeState = buildActiveMarketplaceState(
      {
        thing: "thing:artifact:trading_card",
        context: "val:context:segment:collectible_cards",
        pv: "prop:sport|val:sport:baseball",
      },
      testRegistry
    );

    const viewModel = buildMarketplaceResultsViewModel({
      products: [
        product(
          "mlb-card",
          "thing:organization:league:mlb",
          "val:condition:used",
          "val:sport:baseball"
        ),
        product(
          "nba-card",
          "thing:organization:league:nba",
          "val:condition:used",
          "val:sport:basketball"
        ),
      ],
      registry: testRegistry,
      scopeState,
      selectedCategories: new Set(),
      selectedLocation: "",
      selectedSearch: "",
      selectedAspectFilters: {},
      locale: "en",
    });

    expect(
      viewModel.filteredProducts.map((listedProduct) => listedProduct.id)
    ).toEqual(["mlb-card"]);
    expect(
      viewModel.actualFacetFilters.find(
        (filter) => filter.propRef === "prop:sport"
      )?.values
    ).toEqual([
      ["val:sport:baseball", "Baseball"],
      ["val:sport:basketball", "Basketball"],
    ]);
    expect(viewModel.selectedFacetChips).toEqual([
      {
        propRef: "prop:sport",
        valueRef: "val:sport:baseball",
        label: "Sport",
        valueLabel: "Baseball",
        source: "explicit",
        removable: true,
      },
    ]);
    expect(viewModel.promotedFacetSections).toEqual([]);
  });

  it("marks true-only boolean literal facets for toggle chip rendering", () => {
    const testRegistry = registry();
    const scopeState = buildActiveMarketplaceState(
      {
        context: "val:context:segment:collectible_cards",
        listings: "1",
      },
      testRegistry
    );

    const viewModel = buildMarketplaceResultsViewModel({
      products: [booleanProduct("signed-card")],
      registry: testRegistry,
      scopeState,
      selectedCategories: new Set(),
      selectedLocation: "",
      selectedSearch: "",
      selectedAspectFilters: {},
      locale: "en",
    });

    expect(
      viewModel.actualFacetFilters.find(
        (filter) => filter.propRef === "prop:autographed"
      )
    ).toMatchObject({
      valueKind: "literal",
      booleanTrueOnly: true,
      values: [["true", "true"]],
    });
  });

  it("builds effective facts from trusted requiredRelations on the primary thing", () => {
    const testRegistry = registry();
    const facts = buildEffectiveListingTaxonomyFacts(
      impliedSportProduct("helmet").taxonomy,
      testRegistry
    );

    expect(facts.refAssertions).toEqual(
      expect.arrayContaining([
        { propRef: "prop:condition", valueRef: "val:condition:used" },
        { propRef: "prop:sport", valueRef: "val:sport:baseball" },
      ])
    );
    expect(facts.diagnostics).toEqual([]);

    const orphanFacts = buildEffectiveListingTaxonomyFacts(
      orphanRequiredValueProduct("orphan").taxonomy,
      testRegistry
    );
    expect(orphanFacts.refAssertions).not.toContainEqual({
      propRef: "prop:sport",
      valueRef: "val:sport:baseball",
    });
  });

  it("uses trusted implied required facts for facets and pv matching", () => {
    const testRegistry = registry();
    const scopeState = buildActiveMarketplaceState(
      {
        context: "val:context:segment:collectible_cards",
        listings: "1",
      },
      testRegistry
    );

    const viewModel = buildMarketplaceResultsViewModel({
      products: [
        impliedSportProduct("helmet"),
        orphanRequiredValueProduct("orphan"),
      ],
      registry: testRegistry,
      scopeState,
      selectedCategories: new Set(),
      selectedLocation: "",
      selectedSearch: "",
      selectedAspectFilters: {},
      locale: "en",
    });

    expect(
      viewModel.actualFacetFilters.find(
        (filter) => filter.propRef === "prop:sport"
      )?.values
    ).toEqual([["val:sport:baseball", "Baseball"]]);

    const thingScopeState = buildActiveMarketplaceState(
      {
        thing: "thing:artifact:helmet:baseball_batting_helmet",
        context: "val:context:segment:collectible_cards",
        listings: "1",
      },
      testRegistry
    );
    const thingScopeViewModel = buildMarketplaceResultsViewModel({
      products: [impliedSportProduct("helmet")],
      registry: testRegistry,
      scopeState: thingScopeState,
      selectedCategories: new Set(),
      selectedLocation: "",
      selectedSearch: "",
      selectedAspectFilters: {},
      locale: "en",
    });
    expect(thingScopeViewModel.selectedFacetChips).toEqual([
      {
        propRef: "prop:sport",
        valueRef: "val:sport:baseball",
        label: "Sport",
        valueLabel: "Baseball",
        source: "scope",
        removable: false,
      },
    ]);

    const filteredScopeState = buildActiveMarketplaceState(
      {
        context: "val:context:segment:collectible_cards",
        listings: "1",
        pv: "prop:sport|val:sport:baseball",
      },
      testRegistry
    );
    const filteredViewModel = buildMarketplaceResultsViewModel({
      products: [
        impliedSportProduct("helmet"),
        orphanRequiredValueProduct("orphan"),
      ],
      registry: testRegistry,
      scopeState: filteredScopeState,
      selectedCategories: new Set(),
      selectedLocation: "",
      selectedSearch: "",
      selectedAspectFilters: {},
      locale: "en",
    });

    expect(
      filteredViewModel.filteredProducts.map(
        (listedProduct) => listedProduct.id
      )
    ).toEqual(["helmet"]);
  });

  it("validates generated taxonomy assertions instead of treating bare values as filters", () => {
    const testRegistry = registry();
    const valid = validateProductTaxonomy(
      {
        primaryThingRef: "thing:artifact:trading_card",
        overlayValRefs: ["val:context:segment:collectible_cards"],
        requiredRefs: ["val:sport:baseball"],
        refAssertions: [
          { propRef: "prop:sport", valueRef: "val:sport:baseball" },
          { propRef: "prop:league", valueRef: "thing:organization:league:mlb" },
        ],
        literalAssertions: [],
      },
      testRegistry,
      { mode: "publish", content: "Markdown description" }
    );

    expect(valid.ok).toBe(true);
    expect(valid.errors).toEqual([]);
    expect(valid.warnings).toEqual([]);

    const bareValue = validateProductTaxonomy(
      {
        primaryThingRef: "thing:artifact:trading_card",
        overlayValRefs: ["val:context:segment:collectible_cards"],
        requiredRefs: ["val:sport:baseball"],
        refAssertions: [],
        literalAssertions: [],
      },
      testRegistry,
      { mode: "publish", content: "Markdown description" }
    );

    expect(bareValue.ok).toBe(true);
    expect(bareValue.warnings).toContain(
      "Required concrete value is not attached to a prop assertion and will not be filterable: val:sport:baseball"
    );

    const invalid = validateProductTaxonomy(
      {
        primaryThingRef: "thing:artifact:trading_card",
        overlayValRefs: ["val:context:segment:collectible_cards"],
        refAssertions: [
          { propRef: "prop:missing", valueRef: "val:sport:baseball" },
        ],
        literalAssertions: [],
      },
      testRegistry,
      { mode: "publish", content: '{"taxonomy":{}}' }
    );

    expect(invalid.ok).toBe(false);
    expect(invalid.errors).toEqual(
      expect.arrayContaining([
        "Listing content must be Markdown description text, not structured taxonomy JSON.",
        "Taxonomy ref assertion uses an unknown prop ref: prop:missing",
      ])
    );
  });
});
