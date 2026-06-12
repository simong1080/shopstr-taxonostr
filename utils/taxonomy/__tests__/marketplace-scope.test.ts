import { buildRegistry } from "@/utils/taxonomy/registry";
import {
  activeScopeKeys,
  applicableProps,
  contextChangesResolvedTaxonomyState,
  relatedContextOptions,
  requiredProps,
  thingPath,
} from "@/utils/taxonomy/client-state";
import {
  buildMarketplaceScopeFromQuery,
  buildMarketplaceHref,
  buildMarketplaceNavigationHref,
  buildMarketplaceScopeNavigation,
  buildMarketplaceScopeSidebarSections,
  buildMarketplaceResolverTrace,
  deriveMarketplaceListingVisibility,
  getAutoActiveRequiredRefs,
  getDirectContextChildren,
  getDirectThingChildren,
  filterThingRefsForActiveContext,
  getMeaningfulOverlayContexts,
} from "@/utils/taxonomy/marketplace-scope";
import { getTaxonomySearchSuggestions } from "@/utils/taxonomy/search";
import {
  aggregateTaxonomyBrowseRefs,
  getTaxonomyTileImages,
} from "@/utils/taxonomy/display";
import { normalizeMarketplaceUrlQuery } from "@/utils/taxonomy/routing";
import { TaxonomyState } from "@/utils/taxonomy/types";
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

function makeState(overrides: Partial<TaxonomyState> = {}): TaxonomyState {
  return {
    segmentRef: null,
    thingRef: null,
    thingPath: [],
    semanticContextRefs: [],
    selectedValuesByProp: {},
    selectedLiteralsByProp: {},
    quarantinedLegacyRefs: [],
    ...overrides,
  };
}

describe("marketplace taxonomy scope helpers", () => {
  const registry = buildRegistry(
    [
      event("val:context", { labels: { en: "Context" } }),
      event("val:context:segment", {
        labels: { en: "Segment" },
        parents: ["val:context"],
      }),
      event("val:context:segment:arts_and_entertainment", {
        labels: { en: "Arts & entertainment" },
        parents: ["val:context:segment"],
      }),
      event("val:context:segment:collectibles", {
        labels: { en: "Collectibles" },
        parents: ["val:context:segment:arts_and_entertainment"],
      }),
      event("val:context:segment:memorabilia", {
        labels: { en: "Memorabilia" },
        parents: ["val:context:segment:collectibles"],
      }),
      event("val:context:segment:collectible_cards", {
        labels: { en: "Collectible cards" },
        parents: ["val:context:segment:collectibles"],
      }),
      event("val:context:segment:sporting_goods", {
        labels: { en: "Sporting goods" },
        parents: ["val:context:segment"],
      }),
      event("val:context:usecase:display", {
        labels: { en: "Display" },
        parents: ["val:context"],
        relations: ["prop:display_style"],
      }),
      event("thing:artifact", { labels: { en: "Artifact" } }),
      event("thing:artifact:trading_card", {
        labels: { en: "Trading card" },
        parents: ["thing:artifact"],
        relations: ["val:context:segment:collectibles", "prop:condition"],
      }),
      event("thing:artifact:trading_card:single_card", {
        labels: { en: "Single card" },
        parents: ["thing:artifact:trading_card"],
        relations: ["prop:sport", "prop:league", "prop:team"],
      }),
      event("thing:artifact:trading_card:required_sport_card", {
        labels: { en: "Required sport card" },
        parents: ["thing:artifact:trading_card"],
        relations: ["prop:sport", "prop:league", "prop:team"],
        requiredRelations: ["prop:sport"],
      }),
      event("thing:artifact:trading_card:baseball_required_card", {
        labels: { en: "Baseball required card" },
        parents: ["thing:artifact:trading_card"],
        requiredRelations: ["val:sport:baseball"],
      }),
      event("thing:artifact:trading_card:required_sport_league_card", {
        labels: { en: "Required sport league card" },
        parents: ["thing:artifact:trading_card"],
        relations: ["prop:sport", "prop:league", "prop:team"],
        requiredRelations: ["prop:sport", "prop:league"],
      }),
      event("thing:artifact:trading_card:promo_card", {
        labels: { en: "Promo card" },
        parents: ["thing:artifact:trading_card"],
        relations: ["val:context:segment:collectibles"],
        image: { url: "https://example.test/promo-card.png" },
      }),
      event("thing:artifact:collectible_card_game", {
        labels: { en: "Collectible card game" },
        parents: ["thing:artifact"],
        relations: ["val:context:segment:collectible_cards", "prop:card_game"],
        requiredRelations: ["prop:card_game"],
      }),
      event("thing:artifact:collectible_card_game:case", {
        labels: { en: "Case" },
        parents: ["thing:artifact:collectible_card_game"],
      }),
      event("thing:artifact:collectible_card_game:deck_box", {
        labels: { en: "Deck box" },
        parents: ["thing:artifact:collectible_card_game"],
        requiredRelations: ["thing:game:card_game:cardfight_vanguard"],
      }),
      event("thing:artifact:collectible_card_game:box", {
        labels: { en: "Box" },
        parents: ["thing:artifact:collectible_card_game"],
      }),
      event("thing:artifact:ball", {
        labels: { en: "Ball" },
        parents: ["thing:artifact"],
        image: { url: "https://example.test/ball-own.png" },
        relations: [
          "val:context:segment:sporting_goods",
          "val:context:segment:memorabilia",
          "val:context:usecase:display",
          "prop:sport",
        ],
        requiredRelations: [
          "prop:condition",
          "val:context:segment:memorabilia",
        ],
      }),
      event("thing:artifact:ball:baseball", {
        labels: { en: "Baseball" },
        parents: ["thing:artifact:ball"],
        image: { url: "https://example.test/baseball.png" },
      }),
      event("thing:artifact:ball:basketball", {
        labels: { en: "Basketball" },
        parents: ["thing:artifact:ball"],
        relations: ["val:context:segment:sporting_goods"],
        image: { url: "https://example.test/basketball.png" },
      }),
      event("thing:artifact:ball:tennis_ball", {
        labels: { en: "Tennis ball" },
        parents: ["thing:artifact:ball"],
        relations: ["val:context:segment:sporting_goods"],
      }),
      event("thing:artifact:bat", {
        labels: { en: "Bat" },
        parents: ["thing:artifact"],
      }),
      event("thing:artifact:bat:baseball_bat", {
        labels: { en: "Baseball bat" },
        parents: ["thing:artifact:bat"],
        relations: ["val:context:segment:sporting_goods"],
      }),
      event("thing:artifact:bat:cricket_bat", {
        labels: { en: "Cricket bat" },
        parents: ["thing:artifact:bat"],
        relations: ["val:context:segment:sporting_goods"],
      }),
      event("thing:artifact:puck", {
        labels: { en: "Puck" },
        parents: ["thing:artifact"],
        relations: ["val:context:segment:sporting_goods"],
      }),
      event("thing:artifact:image_parent", {
        labels: { en: "Image parent" },
        parents: ["thing:artifact"],
      }),
      event("thing:artifact:image_parent:direct", {
        labels: { en: "Direct image" },
        parents: ["thing:artifact:image_parent"],
        image: { url: "https://example.test/direct.png" },
      }),
      event("thing:artifact:image_parent:branch", {
        labels: { en: "Branch" },
        parents: ["thing:artifact:image_parent"],
      }),
      event("thing:artifact:image_parent:branch:deep", {
        labels: { en: "Deep image" },
        parents: ["thing:artifact:image_parent:branch"],
        image: { url: "https://example.test/deep.png" },
      }),
      event("thing:artifact:deep_image_parent", {
        labels: { en: "Deep image parent" },
        parents: ["thing:artifact"],
      }),
      event("thing:artifact:deep_image_parent:branch", {
        labels: { en: "Deep branch" },
        parents: ["thing:artifact:deep_image_parent"],
      }),
      event("thing:artifact:deep_image_parent:branch:leaf", {
        labels: { en: "Deep leaf" },
        parents: ["thing:artifact:deep_image_parent:branch"],
        image: { url: "https://example.test/deep-leaf.png" },
      }),
      event("thing:artifact:many_images", {
        labels: { en: "Many images" },
        parents: ["thing:artifact"],
      }),
      event("thing:artifact:many_images:a", {
        labels: { en: "Image A" },
        parents: ["thing:artifact:many_images"],
        image: { url: "https://example.test/a.png" },
      }),
      event("thing:artifact:many_images:b", {
        labels: { en: "Image B" },
        parents: ["thing:artifact:many_images"],
        image: { url: "https://example.test/b.png" },
      }),
      event("thing:artifact:many_images:c", {
        labels: { en: "Image C" },
        parents: ["thing:artifact:many_images"],
        image: { url: "https://example.test/b.png" },
      }),
      event("thing:artifact:many_images:d", {
        labels: { en: "Image D" },
        parents: ["thing:artifact:many_images"],
        image: { url: "https://example.test/d.png" },
      }),
      event("thing:artifact:many_images:e", {
        labels: { en: "Image E" },
        parents: ["thing:artifact:many_images"],
        image: { url: "https://example.test/e.png" },
      }),
      event("thing:artifact:no_images", {
        labels: { en: "No images" },
        parents: ["thing:artifact"],
      }),
      event("thing:artifact:no_images:child", {
        labels: { en: "No image child" },
        parents: ["thing:artifact:no_images"],
      }),
      event("thing:artifact:helmet", {
        labels: { en: "Helmet" },
        parents: ["thing:artifact"],
        relations: ["val:context:segment:memorabilia"],
      }),
      event("thing:artifact:helmet:safety_helmet", {
        labels: { en: "Safety helmet" },
        parents: ["thing:artifact:helmet"],
      }),
      event("thing:artifact:helmet:baseball_batting_helmet", {
        labels: { en: "Baseball batting helmet" },
        parents: ["thing:artifact:helmet"],
        relations: ["val:context:segment:sporting_goods"],
      }),
      event("thing:artifact:helmet:cycling_helmet", {
        labels: { en: "Cycling helmet" },
        parents: ["thing:artifact:helmet"],
        relations: ["val:context:segment:sporting_goods"],
      }),
      event("thing:artifact:helmet:tactical_helmet", {
        labels: { en: "Tactical helmet" },
        parents: ["thing:artifact:helmet"],
      }),
      event("thing:artifact:helmet:hockey_helmet", {
        labels: { en: "Hockey helmet" },
        parents: ["thing:artifact:helmet"],
      }),
      event("thing:artifact:mask", {
        labels: { en: "Mask" },
        parents: ["thing:artifact"],
      }),
      event("thing:artifact:mask:safety_mask", {
        labels: { en: "Safety mask" },
        parents: ["thing:artifact:mask"],
      }),
      event("thing:artifact:mask:sports_mask", {
        labels: { en: "Sports mask" },
        parents: ["thing:artifact:mask"],
        relations: ["val:context:segment:memorabilia"],
      }),
      event("thing:organization", { labels: { en: "Organization" } }),
      event("thing:organization:league", {
        labels: { en: "League" },
        parents: ["thing:organization"],
      }),
      event("thing:organization:league:mlb", {
        labels: { en: "MLB" },
        parents: ["thing:organization:league"],
        relations: ["val:sport:baseball"],
      }),
      event("thing:organization:sports_team", {
        labels: { en: "Sports team" },
        parents: ["thing:organization"],
      }),
      event("thing:organization:sports_team:new_york_mets", {
        labels: { en: "New York Mets" },
        parents: ["thing:organization:sports_team"],
        relations: ["thing:organization:league:mlb"],
      }),
      event("thing:organization:company", {
        labels: { en: "Company" },
        parents: ["thing:organization"],
      }),
      event("thing:organization:company:manufacturer", {
        labels: { en: "Manufacturer" },
        parents: ["thing:organization:company"],
      }),
      event("thing:organization:company:manufacturer:american_tobacco", {
        labels: { en: "American Tobacco" },
        parents: ["thing:organization:company:manufacturer"],
        image: { url: "https://example.test/american-tobacco.png" },
      }),
      event("thing:game", { labels: { en: "Game" } }),
      event("thing:game:card_game", {
        labels: { en: "Card game" },
        parents: ["thing:game"],
      }),
      event("thing:game:card_game:cardfight_vanguard", {
        labels: { en: "Cardfight Vanguard" },
        parents: ["thing:game:card_game"],
        image: { url: "https://example.test/cardfight-vanguard.png" },
      }),
      event("thing:game:chess", {
        labels: { en: "Chess" },
        parents: ["thing:game"],
        image: { url: "https://example.test/chess.png" },
      }),
      event("prop:condition", {
        labels: { en: "Condition" },
        relations: ["val:condition"],
      }),
      event("prop:sport", {
        labels: { en: "Sport" },
        relations: ["val:sport"],
      }),
      event("prop:league", {
        labels: { en: "League" },
        relations: ["thing:organization:league"],
      }),
      event("prop:team", {
        labels: { en: "Team" },
        relations: ["thing:organization:sports_team"],
      }),
      event("prop:card_game", {
        labels: { en: "Card game" },
        relations: ["thing:game:card_game"],
      }),
      event("prop:display_style", {
        labels: { en: "Display style" },
        relations: ["val:display_style"],
      }),
      event("val:condition", { labels: { en: "Condition values" } }),
      event("val:sport", { labels: { en: "Sports" } }),
      event("val:sport:baseball", {
        labels: { en: "Baseball" },
        parents: ["val:sport"],
        image: { url: "https://example.test/baseball-value.png" },
      }),
      event("val:sport:gridiron_football", {
        labels: { en: "Gridiron football" },
        parents: ["val:sport"],
      }),
      event("val:display_style", { labels: { en: "Display styles" } }),
    ],
    { trustedPubkeys: [PUBKEY] }
  );

  it("returns only direct context children", () => {
    expect(
      getDirectContextChildren(
        registry,
        "val:context:segment:arts_and_entertainment"
      )
    ).toEqual(["val:context:segment:collectibles"]);
  });

  it("treats selected prop filters as listings intent so filters remain visible", () => {
    const scope = buildMarketplaceScopeFromQuery(
      {
        context: "val:context:segment:arts_and_entertainment",
        pv: "prop:sport|val:sport:baseball",
      },
      registry
    );

    expect(scope.selectedValuesByProp).toEqual({
      "prop:sport": ["val:sport:baseball"],
    });
    expect(scope.pageMode).toBe("listings");
    expect(scope.showListings).toBe(true);
  });

  it("serializes navigation targets from rebuilt marketplace scope state", () => {
    const currentScope = buildMarketplaceScopeFromQuery(
      {
        context: "val:context:segment:collectible_cards",
        thing: "thing:artifact:trading_card:single_card",
        pv: "prop:sport|val:sport:baseball",
        listings: "1",
      },
      registry
    );

    expect(
      buildMarketplaceNavigationHref({
        registry,
        currentScopeState: currentScope,
        targetContextRef: "val:context:segment:arts_and_entertainment",
        targetThingRef: "",
        listingsIntent: true,
      })
    ).toBe(
      "/marketplace?context=val%3Acontext%3Asegment%3Aarts_and_entertainment&pv=prop%3Asport%7Cval%3Asport%3Abaseball&listings=1"
    );
  });

  it("canonicalizes legacy taxon thing and context aliases", () => {
    expect(
      normalizeMarketplaceUrlQuery({
        query: { taxon: "thing:artifact:ball" },
        registry,
      })
    ).toMatchObject({
      href: "/marketplace?thing=thing%3Aartifact%3Aball",
      changed: true,
      diagnostics: [],
    });

    expect(
      normalizeMarketplaceUrlQuery({
        query: { taxon: "val:context:segment:sporting_goods" },
        registry,
      })
    ).toMatchObject({
      href: "/marketplace?context=val%3Acontext%3Asegment%3Asporting_goods",
      changed: true,
      diagnostics: [],
    });
  });

  it("canonicalizes non-context taxon values to prop filters in listings mode", () => {
    expect(
      normalizeMarketplaceUrlQuery({
        query: { taxon: "val:sport:gridiron_football" },
        registry,
      })
    ).toMatchObject({
      href: "/marketplace?listings=1&pv=prop%3Asport%7Cval%3Asport%3Agridiron_football",
      changed: true,
      diagnostics: [],
    });
  });

  it("drops ambiguous taxon values and invalid pv params with diagnostics", () => {
    const ambiguousRegistry = buildRegistry(
      [
        event("val:sport", { labels: { en: "Sport" } }),
        event("val:sport:baseball", {
          labels: { en: "Baseball" },
          parents: ["val:sport"],
        }),
        event("prop:sport", {
          labels: { en: "Sport" },
          relations: ["val:sport"],
        }),
        event("prop:second_sport", {
          labels: { en: "Second sport" },
          relations: ["val:sport"],
        }),
      ],
      { trustedPubkeys: [PUBKEY] }
    );
    const ambiguous = normalizeMarketplaceUrlQuery({
      query: { taxon: "val:sport:baseball", page: "3" },
      registry: ambiguousRegistry,
    });

    expect(ambiguous.href).toBe("/marketplace?page=3");
    expect(ambiguous.changed).toBe(true);
    expect(ambiguous.diagnostics).toContain(
      "Dropped ambiguous or unrecognized taxon value ref: val:sport:baseball"
    );

    const invalidPv = normalizeMarketplaceUrlQuery({
      query: {
        context: "val:context:segment:sporting_goods",
        pv: [
          "prop:sport|val:sport:baseball",
          "prop:missing|val:sport:baseball",
        ],
        page: "4",
      },
      registry,
    });

    expect(invalidPv.href).toBe(
      "/marketplace?context=val%3Acontext%3Asegment%3Asporting_goods&pv=prop%3Asport%7Cval%3Asport%3Abaseball"
    );
    expect(invalidPv.diagnostics).toContain(
      "Dropped invalid pv: prop:missing|val:sport:baseball"
    );
  });

  it("is idempotent for canonical marketplace URLs", () => {
    expect(
      normalizeMarketplaceUrlQuery({
        query: {
          context: "val:context:segment:sporting_goods",
          listings: "1",
          pv: "prop:sport|val:sport:gridiron_football",
        },
        registry,
      })
    ).toMatchObject({
      href: "/marketplace?context=val%3Acontext%3Asegment%3Asporting_goods&listings=1&pv=prop%3Asport%7Cval%3Asport%3Agridiron_football",
      changed: false,
    });
  });

  it("returns direct thing children before treating a thing page as terminal", () => {
    expect(
      getDirectThingChildren(registry, "thing:artifact:trading_card")
    ).toEqual([
      "thing:artifact:trading_card:single_card",
      "thing:artifact:trading_card:required_sport_card",
      "thing:artifact:trading_card:baseball_required_card",
      "thing:artifact:trading_card:required_sport_league_card",
      "thing:artifact:trading_card:promo_card",
    ]);
    expect(
      getDirectThingChildren(
        registry,
        "thing:organization:company:manufacturer"
      )
    ).toEqual(["thing:organization:company:manufacturer:american_tobacco"]);
  });

  it("proves child things inherit parent relations and requiredRelations", () => {
    const state = makeState({
      thingRef: "thing:artifact:ball:baseball",
      thingPath: thingPath("thing:artifact:ball:baseball", registry),
    });

    expect(
      relatedContextOptions("thing:artifact:ball:baseball", registry)
    ).toContain("val:context:segment:memorabilia");
    expect(
      getAutoActiveRequiredRefs(registry, "thing:artifact:ball:baseball")
    ).toContain("val:context:segment:memorabilia");
    expect(applicableProps(state, registry)).toContain("prop:sport");
    expect(requiredProps(state, registry)).toContain("prop:condition");
    expect(activeScopeKeys(state, registry)).toContain("memorabilia");
  });

  it("keeps inherited required props unresolved until a value is selected", () => {
    const scope = buildMarketplaceScopeFromQuery(
      { thing: "thing:artifact:ball:baseball" },
      registry
    );
    expect(scope.autoActiveRequiredRefs).toContain(
      "val:context:segment:memorabilia"
    );
    expect(scope.unresolvedRequiredPropRefs).toContain("prop:condition");
    expect(scope.navigationItems).toEqual([]);
    expect(scope.showListings).toBe(true);
  });

  it("filters related overlay contexts to only contexts that add distinct props", () => {
    const state = {
      segmentRef: null,
      thingRef: "thing:artifact:ball:baseball",
      thingPath: thingPath("thing:artifact:ball:baseball", registry),
      semanticContextRefs: [],
      selectedValuesByProp: {},
      selectedLiteralsByProp: {},
      quarantinedLegacyRefs: [],
    };
    expect(
      contextChangesResolvedTaxonomyState(
        registry,
        state,
        "val:context:usecase:display"
      )
    ).toBe(true);
    expect(
      contextChangesResolvedTaxonomyState(
        registry,
        state,
        "val:context:segment:memorabilia"
      )
    ).toBe(false);
    expect(
      getMeaningfulOverlayContexts(registry, "thing:artifact:ball:baseball", {
        contextRef: "",
      })
    ).toEqual(["val:context:usecase:display"]);
  });

  it("keeps listing results off pages that still have direct children", () => {
    const scope = buildMarketplaceScopeFromQuery(
      { thing: "thing:organization:company:manufacturer" },
      registry
    );
    expect(scope.directThingRefs).toEqual([
      "thing:organization:company:manufacturer:american_tobacco",
    ]);
    expect(scope.showListings).toBe(false);
  });

  it("shows direct child contexts and reverse-related compatible things together", () => {
    const scope = buildMarketplaceScopeFromQuery(
      { context: "val:context:segment:collectibles" },
      registry
    );
    expect(scope.relatedThingRefs).toContain(
      "thing:artifact:trading_card:promo_card"
    );
    expect(scope.navigationItems).toContainEqual({
      kind: "context",
      ref: "val:context:segment:memorabilia",
    });
    expect(scope.navigationItems).toContainEqual({
      kind: "context",
      ref: "val:context:segment:collectible_cards",
    });
    expect(scope.navigationItems).toContainEqual({
      kind: "thing",
      ref: "thing:artifact:trading_card:promo_card",
    });
    expect(
      scope.navigationItems.every(
        (item) => item.kind === "context" || item.kind === "thing"
      )
    ).toBe(true);
    expect(scope.showListings).toBe(false);
  });

  it("uses the same context and thing refs for listings-mode scope navigation", () => {
    const scope = buildMarketplaceScopeFromQuery(
      { context: "val:context:segment:collectibles", listings: "1" },
      registry
    );
    const navigation = buildMarketplaceScopeNavigation(scope);

    expect(navigation).toContainEqual({
      kind: "contexts",
      refs: expect.arrayContaining([
        "val:context:segment:memorabilia",
        "val:context:segment:collectible_cards",
      ]),
    });
    expect(navigation).toContainEqual({
      kind: "compatibleThings",
      refs: expect.arrayContaining(["thing:artifact:trading_card:promo_card"]),
    });
  });

  it("builds a two-generation local sidebar with exactly one current node", () => {
    const scope = buildMarketplaceScopeFromQuery(
      {
        context: "val:context:segment:collectible_cards",
        thing: "thing:artifact:trading_card",
        listings: "1",
      },
      registry
    );
    const sections = buildMarketplaceScopeSidebarSections(registry, scope);
    const nodes = sections.flatMap((section) => section.items);

    expect(
      nodes.filter((node) => node.isCurrent).map((node) => node.ref)
    ).toEqual(["thing:artifact:trading_card"]);
    expect(nodes).toContainEqual(
      expect.objectContaining({
        ref: "val:context:segment:collectible_cards",
        kind: "context",
        isCurrent: false,
      })
    );
    expect(nodes).not.toContainEqual(
      expect.objectContaining({
        ref: "thing:artifact:trading_card:single_card:rookie_card",
      })
    );
  });

  it("shows root context and thing navigation in root listings mode sidebar", () => {
    const scope = buildMarketplaceScopeFromQuery({ listings: "1" }, registry);
    const sections = buildMarketplaceScopeSidebarSections(registry, scope);

    expect(scope.pageMode).toBe("listings");
    expect(sections).toContainEqual(
      expect.objectContaining({
        id: "root:val:context:segment",
        kind: "context",
        label: "Shop by Segment",
        items: expect.arrayContaining([
          expect.objectContaining({
            kind: "context",
            ref: "val:context:segment:arts_and_entertainment",
            depth: 0,
            isCurrent: false,
          }),
        ]),
      })
    );
    expect(sections).toContainEqual(
      expect.objectContaining({
        id: "root:thing:artifact",
        kind: "thing",
        label: "Item type",
        items: expect.arrayContaining([
          expect.objectContaining({
            kind: "thing",
            ref: "thing:artifact:trading_card",
            depth: 0,
            isCurrent: false,
          }),
          expect.objectContaining({
            kind: "thing",
            ref: "thing:artifact:ball",
            depth: 0,
            isCurrent: false,
          }),
        ]),
      })
    );
    expect(
      sections.flatMap((section) => section.items.map((item) => item.ref))
    ).not.toContain("thing:artifact");
  });

  it("expands invisible active root anchors without rendering them as current items", () => {
    const scope = buildMarketplaceScopeFromQuery(
      { thing: "thing:artifact", listings: "1" },
      registry
    );
    const sections = buildMarketplaceScopeSidebarSections(registry, scope);
    const items = sections.flatMap((section) => section.items);

    expect(scope.pageMode).toBe("listings");
    expect(scope.thingRef).toBe("thing:artifact");
    expect(items.map((item) => item.ref)).toContain(
      "thing:artifact:trading_card"
    );
    expect(items.map((item) => item.ref)).toContain("thing:artifact:ball");
    expect(items.map((item) => item.ref)).not.toContain("thing:artifact");
    expect(items.filter((item) => item.isCurrent)).toEqual([]);
  });

  it("shows compatible contexts in the local sidebar for thing-only listings scopes", () => {
    const supplyRegistry = buildRegistry(
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
        event("val:context:usecase", {
          labels: { en: "Use case" },
          parents: ["val:context"],
        }),
        event("val:context:usecase:protection", {
          labels: { en: "Protection" },
          parents: ["val:context:usecase"],
        }),
        event("val:context:usecase:storage", {
          labels: { en: "Storage" },
          parents: ["val:context:usecase"],
        }),
        event("thing:artifact", { labels: { en: "Artifact" } }),
        event("thing:artifact:card_supply", {
          labels: { en: "Card supply" },
          parents: ["thing:artifact"],
          relations: [
            "val:context:segment:collectible_cards",
            "val:context:usecase:protection",
            "val:context:usecase:storage",
          ],
        }),
      ],
      { trustedPubkeys: [PUBKEY] }
    );
    const scope = buildMarketplaceScopeFromQuery(
      { thing: "thing:artifact:card_supply", listings: "1" },
      supplyRegistry
    );
    const sections = buildMarketplaceScopeSidebarSections(
      supplyRegistry,
      scope
    );
    const compatibleContextRefs = sections
      .filter((section) => section.id === "local:compatible-contexts")
      .flatMap((section) => section.items.map((item) => item.ref));

    expect(compatibleContextRefs).toEqual([
      "val:context:segment:collectible_cards",
      "val:context:usecase:protection",
      "val:context:usecase:storage",
    ]);
    expect(
      buildMarketplaceNavigationHref({
        registry: supplyRegistry,
        currentScopeState: scope,
        targetThingRef: "thing:artifact:card_supply",
        targetContextRef: "val:context:usecase:storage",
        listingsIntent: true,
      })
    ).toBe(
      "/marketplace?thing=thing%3Aartifact%3Acard_supply&context=val%3Acontext%3Ausecase%3Astorage&listings=1"
    );
  });

  it("renders thing-only local sidebar as related categories plus current thing children", () => {
    const scope = buildMarketplaceScopeFromQuery(
      { thing: "thing:artifact:ball", listings: "1" },
      registry
    );
    const sections = buildMarketplaceScopeSidebarSections(registry, scope);
    const categorySection = sections.find(
      (section) => section.id === "local:compatible-contexts"
    );
    const thingSection = sections.find(
      (section) => section.id === "local:thing-branch"
    );

    expect(categorySection).toEqual(
      expect.objectContaining({
        label: "Category",
        kind: "context",
      })
    );
    expect(categorySection?.items).toContainEqual(
      expect.objectContaining({
        ref: "val:context:segment:memorabilia",
        depth: 0,
        isCurrent: false,
      })
    );
    expect(categorySection?.items).toContainEqual(
      expect.objectContaining({
        ref: "val:context:usecase:display",
        depth: 0,
        isCurrent: false,
      })
    );
    expect(categorySection?.items).toContainEqual(
      expect.objectContaining({
        ref: "val:context:segment:sporting_goods",
        depth: 0,
        isCurrent: false,
      })
    );

    expect(thingSection).toEqual(
      expect.objectContaining({
        label: "Item type",
        kind: "thing",
      })
    );
    expect(thingSection?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ref: "thing:artifact:ball",
          depth: 0,
          isCurrent: true,
        }),
        expect.objectContaining({
          ref: "thing:artifact:ball:baseball",
          depth: 1,
          isCurrent: false,
        }),
        expect.objectContaining({
          ref: "thing:artifact:ball:basketball",
          depth: 1,
          isCurrent: false,
        }),
      ])
    );
    expect(sections.map((section) => section.label)).not.toContain(
      "More item type"
    );
    expect(sections.map((section) => section.label)).not.toContain("More Ball");
  });

  it("projects context-only compatible leaf things to useful local sidebar refinements", () => {
    const scope = buildMarketplaceScopeFromQuery(
      { context: "val:context:segment:sporting_goods", listings: "1" },
      registry
    );
    const sections = buildMarketplaceScopeSidebarSections(registry, scope);
    const categorySection = sections.find(
      (section) => section.id === "local:context-branch"
    );

    expect(scope.relatedThingRefs).toEqual(
      expect.arrayContaining([
        "thing:artifact:ball",
        "thing:artifact:bat",
        "thing:artifact:helmet",
        "thing:artifact:puck",
      ])
    );
    expect(scope.relatedThingRefs).not.toEqual(
      expect.arrayContaining([
        "thing:artifact:ball:baseball",
        "thing:artifact:ball:basketball",
        "thing:artifact:bat:baseball_bat",
        "thing:artifact:helmet:cycling_helmet",
      ])
    );
    expect(categorySection).toEqual(
      expect.objectContaining({
        label: "Category",
        kind: "context",
      })
    );
    expect(categorySection?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ref: "val:context:segment:sporting_goods",
          depth: 0,
          isCurrent: true,
        }),
        expect.objectContaining({ ref: "thing:artifact:ball", depth: 1 }),
        expect.objectContaining({ ref: "thing:artifact:bat", depth: 1 }),
        expect.objectContaining({ ref: "thing:artifact:puck", depth: 1 }),
        expect.objectContaining({ ref: "thing:artifact:helmet", depth: 1 }),
      ])
    );
    expect(sections.map((section) => section.label)).not.toContain(
      "Shop by Products"
    );
  });

  it("shows direct child things after selecting a projected context refinement", () => {
    const scope = buildMarketplaceScopeFromQuery(
      {
        context: "val:context:segment:sporting_goods",
        thing: "thing:artifact:ball",
        listings: "1",
      },
      registry
    );
    const sections = buildMarketplaceScopeSidebarSections(registry, scope);
    const thingSection = sections.find(
      (section) => section.id === "local:thing-branch"
    );

    expect(thingSection?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ref: "thing:artifact:ball",
          depth: 0,
          isCurrent: true,
        }),
        expect.objectContaining({
          ref: "thing:artifact:ball:baseball",
          depth: 1,
          isCurrent: false,
        }),
        expect.objectContaining({
          ref: "thing:artifact:ball:basketball",
          depth: 1,
          isCurrent: false,
        }),
        expect.objectContaining({
          ref: "thing:artifact:ball:tennis_ball",
          depth: 1,
          isCurrent: false,
        }),
      ])
    );
  });

  it("shows compatible thing roots when a selected segment has no child segments", () => {
    const scope = buildMarketplaceScopeFromQuery(
      { context: "val:context:segment:collectible_cards" },
      registry
    );

    expect(scope.directContextRefs).toEqual([]);
    expect(scope.navigationItems).toEqual([
      { kind: "thing", ref: "thing:artifact:collectible_card_game" },
    ]);
    expect(scope.browseDepth).toBeGreaterThanOrEqual(3);
    expect(scope.showListings).toBe(true);
  });

  it("aggregates multiple related terminal things to the nearest useful browse parent", () => {
    expect(
      aggregateTaxonomyBrowseRefs(registry, [
        "thing:artifact:ball:baseball",
        "thing:artifact:ball:basketball",
        "thing:artifact:trading_card:single_card",
      ])
    ).toEqual([
      "thing:artifact:ball",
      "thing:artifact:trading_card:single_card",
    ]);
  });

  it("does not render the current thing as its own navigation item", () => {
    const scope = buildMarketplaceScopeFromQuery(
      { thing: "thing:artifact:ball" },
      registry
    );
    const thingRefs = scope.navigationItems.flatMap((item) =>
      item.kind === "thing" ? [item.ref] : []
    );

    expect(thingRefs).not.toContain("thing:artifact:ball");
    expect(thingRefs).toEqual([
      "thing:artifact:ball:baseball",
      "thing:artifact:ball:basketball",
      "thing:artifact:ball:tennis_ball",
    ]);
  });

  it("enters listings mode at meaningful browse depth three even with child things", () => {
    const scope = buildMarketplaceScopeFromQuery(
      {
        thing: "thing:artifact:trading_card",
        context: "val:context:segment:collectibles",
      },
      registry
    );

    expect(scope.navigationItems).toEqual([]);
    expect(scope.childThingRefinementRefs).toContain(
      "thing:artifact:trading_card:single_card"
    );
    expect(scope.childThingRefinementRefs).toContain(
      "thing:artifact:trading_card:promo_card"
    );
    expect(scope.browseDepth).toBe(3);
    expect(scope.pageMode).toBe("listings");
    expect(scope.showListings).toBe(true);

    const shallowScope = buildMarketplaceScopeFromQuery(
      {
        thing: "thing:artifact:trading_card",
        context: "val:context:segment:arts_and_entertainment",
      },
      registry
    );
    expect(shallowScope.browseDepth).toBe(2);
    expect(shallowScope.pageMode).toBe("browse");
    expect(shallowScope.showListings).toBe(false);
  });

  it("uses structural child things instead of required prop browse grids", () => {
    const batRegistry = buildRegistry(
      [
        event("val:context", { labels: { en: "Context" } }),
        event("val:context:segment", {
          labels: { en: "Segment" },
          parents: ["val:context"],
        }),
        event("val:context:segment:memorabilia", {
          labels: { en: "Memorabilia" },
          parents: ["val:context:segment"],
        }),
        event("val:context:segment:memorabilia:sports_memorabilia", {
          labels: { en: "Sports memorabilia" },
          parents: ["val:context:segment:memorabilia"],
          requiredRelations: ["prop:sport"],
        }),
        event("thing:artifact", { labels: { en: "Artifact" } }),
        event("thing:artifact:bat", {
          labels: { en: "Bat" },
          parents: ["thing:artifact"],
          relations: [
            "val:context:segment:memorabilia:sports_memorabilia",
            "prop:condition",
          ],
        }),
        event("thing:artifact:bat:baseball_bat", {
          labels: { en: "Baseball bat" },
          parents: ["thing:artifact:bat"],
          requiredRelations: ["val:sport:baseball"],
        }),
        event("thing:artifact:bat:cricket_bat", {
          labels: { en: "Cricket bat" },
          parents: ["thing:artifact:bat"],
          requiredRelations: ["val:sport:cricket"],
        }),
        event("prop:sport", {
          labels: { en: "Sport" },
          relations: ["val:sport"],
        }),
        event("prop:condition", {
          labels: { en: "Condition" },
          relations: ["val:condition"],
        }),
        event("val:sport", { labels: { en: "Sport" } }),
        event("val:sport:baseball", {
          labels: { en: "Baseball" },
          parents: ["val:sport"],
        }),
        event("val:sport:cricket", {
          labels: { en: "Cricket" },
          parents: ["val:sport"],
        }),
        event("val:condition", { labels: { en: "Condition" } }),
      ],
      { trustedPubkeys: [PUBKEY] }
    );

    const scope = buildMarketplaceScopeFromQuery(
      {
        thing: "thing:artifact:bat",
        context: "val:context:segment:memorabilia:sports_memorabilia",
      },
      batRegistry
    );

    expect(scope.navigationItems).toEqual([]);
    expect(scope.unresolvedRequiredPropRefs).toEqual(["prop:sport"]);
    expect(scope.childThingRefinementRefs).toEqual([
      "thing:artifact:bat:baseball_bat",
      "thing:artifact:bat:cricket_bat",
    ]);
    expect(scope.pageMode).toBe("listings");
    expect(scope.showListings).toBe(true);

    const baseballScope = buildMarketplaceScopeFromQuery(
      {
        thing: "thing:artifact:bat",
        context: "val:context:segment:memorabilia:sports_memorabilia",
        pv: "prop:sport|val:sport:baseball",
      },
      batRegistry
    );

    expect(baseballScope.selectedValuesByProp["prop:sport"]).toEqual([
      "val:sport:baseball",
    ]);
    expect(baseballScope.childThingRefinementRefs).toEqual([
      "thing:artifact:bat:baseball_bat",
    ]);
    expect(baseballScope.childThingRefinementRefs).not.toContain(
      "thing:artifact:bat:cricket_bat"
    );
    expect(baseballScope.pageMode).toBe("listings");
    expect(baseballScope.showListings).toBe(true);

    const thingOnlyScope = buildMarketplaceScopeFromQuery(
      { thing: "thing:artifact:bat" },
      batRegistry
    );
    expect(
      buildMarketplaceNavigationHref({
        registry: batRegistry,
        currentScopeState: thingOnlyScope,
        targetThingRef: "thing:artifact:bat:cricket_bat",
        targetContextRef: "",
        listingsIntent: false,
      })
    ).toBe("/marketplace?thing=thing%3Aartifact%3Abat%3Acricket_bat");

    expect(
      buildMarketplaceNavigationHref({
        registry: batRegistry,
        currentScopeState: scope,
        targetThingRef: "thing:artifact:bat:cricket_bat",
        targetContextRef: "val:context:segment:memorabilia:sports_memorabilia",
        listingsIntent: true,
      })
    ).toBe(
      "/marketplace?thing=thing%3Aartifact%3Abat%3Acricket_bat&context=val%3Acontext%3Asegment%3Amemorabilia%3Asports_memorabilia&listings=1"
    );
  });

  it("filters thing children by active context before rendering navigation", () => {
    const scope = buildMarketplaceScopeFromQuery(
      {
        thing: "thing:artifact:mask",
        context: "val:context:segment:memorabilia",
      },
      registry
    );
    expect(scope.navigationItems).toEqual([]);
    expect(scope.childThingRefinementRefs).toEqual([
      "thing:artifact:mask:sports_mask",
    ]);
    expect(scope.childThingRefinementRefs).not.toContain(
      "thing:artifact:mask:safety_mask"
    );
    expect(scope.childThingRefinementRefs).not.toContain("thing:artifact:mask");
    expect(scope.showListings).toBe(true);
  });

  it("documents that generic parent context relations make all child things compatible", () => {
    const helmetChildren = [
      "thing:artifact:helmet:safety_helmet",
      "thing:artifact:helmet:tactical_helmet",
      "thing:artifact:helmet:hockey_helmet",
    ];

    expect(
      filterThingRefsForActiveContext(
        registry,
        helmetChildren,
        "val:context:segment:memorabilia"
      )
    ).toEqual(helmetChildren);
  });

  it("keeps context aggregation but expands a collapsed result on the matching thing page", () => {
    const ballChildren = [
      "thing:artifact:ball:baseball",
      "thing:artifact:ball:basketball",
    ];

    expect(aggregateTaxonomyBrowseRefs(registry, ballChildren)).toEqual([
      "thing:artifact:ball",
    ]);
    expect(
      aggregateTaxonomyBrowseRefs(registry, ballChildren, {
        currentThingRef: "thing:artifact:ball",
      })
    ).toEqual(ballChildren);
  });

  it("uses a terminal node's own image for taxonomy browse tiles", () => {
    expect(
      getTaxonomyTileImages(registry, "thing:artifact:trading_card:promo_card")
    ).toEqual([
      {
        src: "https://example.test/promo-card.png",
        alt: "Promo card",
        ref: "thing:artifact:trading_card:promo_card",
        fit: "cover",
      },
    ]);
  });

  it("uses a node's own image before child images for taxonomy browse tiles", () => {
    expect(
      getTaxonomyTileImages(registry, "thing:artifact:ball").map(
        (image) => image.src
      )
    ).toEqual(["https://example.test/ball-own.png"]);
  });

  it("uses direct child images for parent taxonomy browse tiles without an own image", () => {
    expect(
      getTaxonomyTileImages(registry, "thing:artifact:image_parent").map(
        (image) => image.src
      )
    ).toEqual(["https://example.test/direct.png"]);
  });

  it("falls back to nearest descendant images when direct children have none", () => {
    expect(
      getTaxonomyTileImages(registry, "thing:artifact:deep_image_parent").map(
        (image) => image.src
      )
    ).toEqual(["https://example.test/deep-leaf.png"]);
  });

  it("uses concrete required relation images before nearest descendants", () => {
    expect(
      getTaxonomyTileImages(
        registry,
        "thing:artifact:trading_card:baseball_required_card"
      )
    ).toEqual([
      {
        src: "https://example.test/baseball-value.png",
        alt: "Baseball",
        ref: "val:sport:baseball",
        fit: "cover",
      },
    ]);
  });

  it("uses selected required prop value images before nearest descendants", () => {
    expect(
      getTaxonomyTileImages(
        registry,
        "thing:artifact:collectible_card_game:case",
        {
          selectedValuesByProp: {
            "prop:card_game": ["thing:game:card_game:cardfight_vanguard"],
          },
        }
      )
    ).toEqual([
      {
        src: "https://example.test/cardfight-vanguard.png",
        alt: "Cardfight Vanguard",
        ref: "thing:game:card_game:cardfight_vanguard",
        fit: "contain",
      },
    ]);
  });

  it("uses concrete required thing images as fallback", () => {
    expect(
      getTaxonomyTileImages(
        registry,
        "thing:artifact:collectible_card_game:deck_box"
      )
    ).toEqual([
      {
        src: "https://example.test/cardfight-vanguard.png",
        alt: "Cardfight Vanguard",
        ref: "thing:game:card_game:cardfight_vanguard",
        fit: "contain",
      },
    ]);
  });

  it("dedupes taxonomy tile images and limits collages to four images", () => {
    expect(
      getTaxonomyTileImages(registry, "thing:artifact:many_images").map(
        (image) => image.src
      )
    ).toEqual([
      "https://example.test/a.png",
      "https://example.test/b.png",
      "https://example.test/d.png",
      "https://example.test/e.png",
    ]);
  });

  it("marks organization images as logo-safe contain images", () => {
    expect(
      getTaxonomyTileImages(
        registry,
        "thing:organization:company:manufacturer:american_tobacco"
      )[0]?.fit
    ).toBe("contain");
  });

  it("marks game images as contain images and does not replace own game images with child collages", () => {
    expect(getTaxonomyTileImages(registry, "thing:game:chess")).toEqual([
      {
        src: "https://example.test/chess.png",
        alt: "Chess",
        ref: "thing:game:chess",
        fit: "contain",
      },
    ]);
  });

  it("returns no tile images when a node and its children have no images", () => {
    expect(getTaxonomyTileImages(registry, "thing:artifact:no_images")).toEqual(
      []
    );
  });

  it("does not create pre-listing navigation from optional props with value or thing options", () => {
    const baseScope = buildMarketplaceScopeFromQuery(
      {
        thing: "thing:artifact:trading_card:single_card",
        context: "val:context:segment:collectibles",
      },
      registry
    );
    expect(baseScope.navigationItems).toEqual([]);
    expect(baseScope.showListings).toBe(true);

    const sportScope = buildMarketplaceScopeFromQuery(
      {
        thing: "thing:artifact:trading_card:single_card",
        context: "val:context:segment:collectibles",
        value: "val:sport:baseball",
      },
      registry
    );
    expect(sportScope.selectedValuesByProp["prop:sport"]).toBeUndefined();
    expect(sportScope.navigationItems).toEqual([]);
    expect(sportScope.showListings).toBe(true);
  });

  it("keeps listing visibility as derived marketplace UI policy", () => {
    expect(
      deriveMarketplaceListingVisibility({
        explicitListings: false,
        hasTaxonomyNavigation: true,
      })
    ).toBe(false);
    expect(
      deriveMarketplaceListingVisibility({
        explicitListings: false,
        hasTaxonomyNavigation: false,
      })
    ).toBe(true);
    expect(
      deriveMarketplaceListingVisibility({
        explicitListings: true,
        hasTaxonomyNavigation: true,
      })
    ).toBe(true);

    expect(
      buildMarketplaceScopeFromQuery(
        { thing: "thing:missing", context: "val:context:segment:missing" },
        null
      ).showListings
    ).toBe(true);
  });

  it("traces registry, active scope, optional props, and browse decisions separately", () => {
    const trace = buildMarketplaceResolverTrace(
      {
        thing: "thing:artifact:trading_card:single_card",
        context: "val:context:segment:collectibles",
      },
      registry,
      {
        url: "/marketplace?thing=thing:artifact:trading_card:single_card&context=val:context:segment:collectibles",
      }
    );

    expect(trace.registryLookup.selectedThingExists).toBe(true);
    expect(
      trace.registryLookup.selectedContextRefsExist[
        "val:context:segment:collectibles"
      ]
    ).toBe(true);
    expect(trace.activeScope).toMatchObject({
      thingRef: "thing:artifact:trading_card:single_card",
      contextRefs: {
        selected: ["val:context:segment:collectibles"],
        required: [],
      },
      selectedValuesByProp: {},
      selectedLiteralsByProp: {},
    });
    expect(trace.closure.inheritedRelations).toContain("prop:sport");
    expect(trace.optionalChoices.optionalPropRefs).toContain("prop:sport");
    expect(trace.requirements.requiredPropRefs).not.toContain("prop:sport");
    expect(trace.requirements.unresolvedRequiredPropRefs).not.toContain(
      "prop:sport"
    );
    expect(trace.browse.navigationItems).toEqual([]);
    expect(trace.browse.terminal).toBe(true);
    expect(trace.listings).toMatchObject({
      shouldShowListings: true,
      matchedListingCount: 0,
      filtersFromActualListingsOnly: false,
      filterProps: [],
    });
  });

  it("traces thing child filtering by active context before terminal listing decisions", () => {
    const trace = buildMarketplaceResolverTrace(
      {
        thing: "thing:artifact:mask",
        context: "val:context:segment:memorabilia",
      },
      registry
    );

    expect(trace.browse.directThingChildren).toEqual([
      "thing:artifact:mask:safety_mask",
      "thing:artifact:mask:sports_mask",
    ]);
    expect(trace.browse.contextCompatibleThingChildren).toEqual([
      "thing:artifact:mask:sports_mask",
    ]);
    expect(trace.browse.navigationItems).toEqual([]);
    expect(trace.browse.terminal).toBe(true);
  });

  it("restores selected prop values from generic pv query params", () => {
    const scope = buildMarketplaceScopeFromQuery(
      {
        thing: "thing:artifact:collectible_card_game:case",
        context: "val:context:segment:collectible_cards",
        pv: "prop:card_game|thing:game:card_game:cardfight_vanguard",
      },
      registry
    );

    expect(scope.selectedValuesByProp["prop:card_game"]).toEqual([
      "thing:game:card_game:cardfight_vanguard",
    ]);
    expect(scope.unresolvedRequiredPropRefs).toEqual([]);
    expect(scope.navigationItems).toEqual([]);
    expect(scope.showListings).toBe(true);
  });

  it("drops malformed pv query params instead of admitting unreachable refs", () => {
    const scope = buildMarketplaceScopeFromQuery(
      {
        thing: "thing:artifact:collectible_card_game:case",
        context: "val:context:segment:collectible_cards",
        pv: "prop%ZZcard_game|thing:game:card_game:cardfight_vanguard",
      },
      registry
    );

    expect(scope.selectedValuesByProp).toEqual({});
  });

  it("writes selected prop values to generic pv query params", () => {
    expect(
      buildMarketplaceHref({
        thingRef: "thing:artifact:collectible_card_game:case",
        contextRef: "val:context:segment:collectible_cards",
        selectedValuesByProp: {
          "prop:card_game": ["thing:game:card_game:cardfight_vanguard"],
        },
      })
    ).toBe(
      "/marketplace?thing=thing%3Aartifact%3Acollectible_card_game%3Acase&context=val%3Acontext%3Asegment%3Acollectible_cards&pv=prop%3Acard_game%7Cthing%3Agame%3Acard_game%3Acardfight_vanguard"
    );
  });

  it("activates inherited required props at the branch level while exposing child thing refinements", () => {
    const scope = buildMarketplaceScopeFromQuery(
      {
        thing: "thing:artifact:collectible_card_game",
        context: "val:context:segment:collectible_cards",
      },
      registry
    );

    expect(scope.unresolvedRequiredPropRefs).toEqual(["prop:card_game"]);
    expect(scope.navigationItems).toEqual([]);
    expect(scope.childThingRefinementRefs).toEqual([
      "thing:artifact:collectible_card_game:case",
      "thing:artifact:collectible_card_game:deck_box",
      "thing:artifact:collectible_card_game:box",
    ]);
    expect(scope.pageMode).toBe("listings");
    expect(scope.showListings).toBe(true);
  });

  it("does not show the inherited required selector after its pv value is selected", () => {
    const scope = buildMarketplaceScopeFromQuery(
      {
        thing: "thing:artifact:collectible_card_game",
        context: "val:context:segment:collectible_cards",
        pv: "prop:card_game|thing:game:card_game:cardfight_vanguard",
      },
      registry
    );

    expect(scope.selectedValuesByProp["prop:card_game"]).toEqual([
      "thing:game:card_game:cardfight_vanguard",
    ]);
    expect(scope.unresolvedRequiredPropRefs).toEqual([]);
    expect(scope.navigationItems).not.toContainEqual(
      expect.objectContaining({ propRef: "prop:card_game" })
    );
  });

  it("infers legacy bare values only for an unambiguous unresolved required prop", () => {
    const scope = buildMarketplaceScopeFromQuery(
      {
        thing: "thing:artifact:collectible_card_game:case",
        context: "val:context:segment:collectible_cards",
        value: "thing:game:card_game:cardfight_vanguard",
      },
      registry
    );

    expect(scope.selectedValuesByProp["prop:card_game"]).toEqual([
      "thing:game:card_game:cardfight_vanguard",
    ]);
    expect(scope.unresolvedRequiredPropRefs).toEqual([]);
  });

  it("keeps unresolved required props out of browse navigation", () => {
    const requiredScope = buildMarketplaceScopeFromQuery(
      {
        thing: "thing:artifact:trading_card:required_sport_card",
        context: "val:context:segment:collectibles",
      },
      registry
    );
    expect(requiredScope.unresolvedRequiredPropRefs).toEqual(["prop:sport"]);
    expect(requiredScope.navigationItems).toEqual([]);
    expect(requiredScope.showListings).toBe(true);

    const resolvedScope = buildMarketplaceScopeFromQuery(
      {
        thing: "thing:artifact:trading_card:required_sport_card",
        context: "val:context:segment:collectibles",
        value: "val:sport:baseball",
      },
      registry
    );
    expect(resolvedScope.selectedValuesByProp["prop:sport"]).toEqual([
      "val:sport:baseball",
    ]);
    expect(resolvedScope.navigationItems).toEqual([]);
    expect(resolvedScope.showListings).toBe(true);
  });

  it("keeps dependent required props out of browse navigation", () => {
    const sportScope = buildMarketplaceScopeFromQuery(
      {
        thing: "thing:artifact:trading_card:required_sport_league_card",
        context: "val:context:segment:collectibles",
        value: "val:sport:baseball",
      },
      registry
    );
    expect(sportScope.unresolvedRequiredPropRefs).toEqual(["prop:league"]);
    expect(sportScope.navigationItems).toEqual([]);
    expect(sportScope.showListings).toBe(true);

    const leagueScope = buildMarketplaceScopeFromQuery(
      {
        thing: "thing:artifact:trading_card:required_sport_league_card",
        context: "val:context:segment:collectibles",
        value: ["val:sport:baseball", "thing:organization:league:mlb"],
      },
      registry
    );
    expect(leagueScope.selectedValuesByProp["prop:league"]).toEqual([
      "thing:organization:league:mlb",
    ]);
    expect(leagueScope.navigationItems).toEqual([]);
    expect(leagueScope.showListings).toBe(true);
  });

  it("does not expose prop values as marketplace browse sections", () => {
    const browseRegistry = buildRegistry(
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
            "prop:league",
            "prop:team",
          ],
        }),
        event("prop:condition", {
          labels: { en: "Condition" },
          relations: ["val:condition"],
        }),
        event("prop:league", {
          labels: { en: "League" },
          relations: ["thing:organization:league"],
        }),
        event("prop:team", {
          labels: { en: "Team" },
          relations: ["thing:organization:sports_team"],
        }),
        event("val:condition", { labels: { en: "Condition values" } }),
        event("val:condition:graded", {
          labels: { en: "Graded" },
          parents: ["val:condition"],
        }),
        event("val:condition:used", {
          labels: { en: "Used" },
          parents: ["val:condition"],
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
        event("thing:organization:sports_team", {
          labels: { en: "Team" },
          parents: ["thing:organization"],
        }),
        event("thing:organization:sports_team:mets", {
          labels: { en: "Mets" },
          parents: ["thing:organization:sports_team"],
        }),
      ],
      { trustedPubkeys: [PUBKEY] }
    );

    const scope = buildMarketplaceScopeFromQuery(
      {
        thing: "thing:artifact:trading_card",
        context: "val:context:segment:collectible_cards",
      },
      browseRegistry
    );

    expect(scope.browseSections).toEqual([]);
  });

  it("keeps required props out of browse sections and browse navigation", () => {
    const browseRegistry = buildRegistry(
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
            "prop:card_number",
            "prop:autographed",
            "prop:grade_value",
          ],
        }),
        event("prop:condition", {
          labels: { en: "Condition" },
          relations: ["val:condition"],
        }),
        event("prop:card_number", {
          labels: { en: "Card number" },
          relations: ["valtype:text"],
        }),
        event("prop:autographed", {
          labels: { en: "Autographed" },
          relations: ["valtype:boolean"],
        }),
        event("prop:grade_value", {
          labels: { en: "Grade value" },
          relations: ["val:grade_value"],
        }),
        event("valtype:text", { labels: { en: "Text" } }),
        event("valtype:boolean", { labels: { en: "Boolean" } }),
        event("val:condition", { labels: { en: "Condition values" } }),
        event("val:condition:graded", {
          labels: { en: "Graded" },
          parents: ["val:condition"],
        }),
        event("val:grade_value", { labels: { en: "Grade values" } }),
        event("val:grade_value:gem_mint_10", {
          labels: { en: "Gem Mint 10" },
          parents: ["val:grade_value"],
        }),
      ],
      { trustedPubkeys: [PUBKEY] }
    );

    const selectedScope = buildMarketplaceScopeFromQuery(
      {
        thing: "thing:artifact:trading_card",
        context: "val:context:segment:collectible_cards",
        pv: "prop:condition|val:condition:graded",
      },
      browseRegistry
    );
    expect(selectedScope.browseSections).toEqual([]);

    const requiredBrowseRegistry = buildRegistry(
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
          ],
          requiredRelations: ["prop:condition"],
        }),
        event("prop:condition", {
          labels: { en: "Condition" },
          relations: ["val:condition"],
        }),
        event("val:condition", { labels: { en: "Condition values" } }),
        event("val:condition:graded", {
          labels: { en: "Graded" },
          parents: ["val:condition"],
        }),
      ],
      { trustedPubkeys: [PUBKEY] }
    );
    const requiredScope = buildMarketplaceScopeFromQuery(
      {
        thing: "thing:artifact:trading_card",
        context: "val:context:segment:collectible_cards",
      },
      requiredBrowseRegistry
    );
    expect(requiredScope.navigationItems).toEqual([]);
    expect(requiredScope.browseSections).toEqual([]);
  });

  it("builds search suggestions from authored labels and immediate parent labels", () => {
    expect(getTaxonomySearchSuggestions(registry, "american", "en")).toEqual([
      {
        ref: "thing:organization:company:manufacturer:american_tobacco",
        label: "American Tobacco",
        parentLabel: "Manufacturer",
        image: "https://example.test/american-tobacco.png",
      },
    ]);
  });
});
