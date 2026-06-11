import fs from "fs";
import path from "path";
import { buildRegistry } from "@/utils/taxonomy/registry";
import { TaxonomyState } from "@/utils/taxonomy/types";
import {
  applicableProps,
  buildPropRenderTree,
  buildResolvedTaxonomyState,
  decodeListingRefs,
  decodeListingOverlayRefs,
  listingRefs,
  propOptions,
  propOrder,
  reconcileTaxonomyState,
  requiredProps,
  resolvePropResolution,
  resolvePropOptions,
  thingPath,
} from "@/utils/taxonomy/client-state";
import {
  buildActiveListingState,
  buildListingTaxonomyRefAssertions,
  buildInitialListingStateForThing,
} from "@/utils/taxonomy/listing-state";
import { NostrEvent } from "@/utils/types/types";

const TRUSTED_TAXONOMY_PUBKEYS = [
  "TAXONOSTR_PUBKEY",
  "f94f8648aacec9880ba667fb422f886d77fa67ccbe538645b1e21d5d580e214e",
];

function loadFixtureEvents(): NostrEvent[] {
  const fixturePath = path.join(
    process.cwd(),
    "fixtures",
    "taxonomy",
    "taxonostr-authoring.jsonl"
  );
  return fs
    .readFileSync(fixturePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as NostrEvent);
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

function event(d: string, content: Record<string, unknown>): NostrEvent {
  return {
    id: `${d}-id`,
    pubkey: "TAXONOSTR_PUBKEY",
    created_at: 1772400000,
    kind: 30078,
    tags: [["d", d]],
    content: JSON.stringify(content),
    sig: `${d}-sig`,
  } as NostrEvent;
}

describe("taxonomy client state", () => {
  const registry = buildRegistry(loadFixtureEvents(), {
    trustedPubkeys: TRUSTED_TAXONOMY_PUBKEYS,
  });

  it("narrows league options to NBA/WNBA for basketball single cards", () => {
    const state = makeState({
      segmentRef: "val:context:segment:collectible_cards",
      thingRef: "thing:artifact:trading_card:single_card",
      thingPath: thingPath("thing:artifact:trading_card:single_card", registry),
      selectedValuesByProp: {
        "prop:sport": ["val:sport:basketball"],
      },
    });

    expect(propOptions("prop:league", state, registry)).toEqual([
      "thing:organization:league:nba",
      "thing:organization:league:wnba",
    ]);
    expect(propOptions("prop:condition", state, registry)).toContain(
      "val:condition:collectible_cards:mint"
    );
    expect(propOptions("prop:condition", state, registry)).not.toEqual([]);
  });

  it("uses the canonical state-aware prop option resolver", () => {
    const state = makeState({
      segmentRef: "val:context:segment:collectible_cards",
      thingRef: "thing:artifact:trading_card:single_card",
      thingPath: thingPath("thing:artifact:trading_card:single_card", registry),
      selectedValuesByProp: {
        "prop:sport": ["val:sport:basketball"],
      },
    });

    expect(resolvePropOptions("prop:league", state, registry)).toEqual(
      propOptions("prop:league", state, registry)
    );
  });

  it("returns no league options when narrowing is active and a sport has no compatible leagues", () => {
    const state = makeState({
      segmentRef: "val:context:segment:collectible_cards",
      thingRef: "thing:artifact:trading_card:single_card",
      thingPath: thingPath("thing:artifact:trading_card:single_card", registry),
      selectedValuesByProp: {
        "prop:sport": ["val:sport:rugby_union"],
      },
    });

    expect(propOptions("prop:league", state, registry)).toEqual([]);
  });

  it("narrows team options to NBA teams when league is nba", () => {
    const state = makeState({
      segmentRef: "val:context:segment:collectible_cards",
      thingRef: "thing:artifact:trading_card:single_card",
      thingPath: thingPath("thing:artifact:trading_card:single_card", registry),
      selectedValuesByProp: {
        "prop:league": ["thing:organization:league:nba"],
      },
    });

    const options = propOptions("prop:team", state, registry);
    expect(options).toContain(
      "thing:organization:sports_team:los_angeles_lakers"
    );
    expect(options).toContain("thing:organization:sports_team:new_york_knicks");
    expect(options).not.toContain(
      "thing:organization:sports_team:new_york_liberty"
    );
  });

  it("narrows team options through inferred transitive dependencies from sport", () => {
    const state = makeState({
      segmentRef: "val:context:segment:collectible_cards",
      thingRef: "thing:artifact:trading_card:single_card",
      thingPath: thingPath("thing:artifact:trading_card:single_card", registry),
      selectedValuesByProp: {
        "prop:sport": ["val:sport:basketball"],
      },
    });

    const options = propOptions("prop:team", state, registry);
    expect(options).toContain(
      "thing:organization:sports_team:los_angeles_lakers"
    );
    expect(options).toContain(
      "thing:organization:sports_team:new_york_liberty"
    );
    expect(options).not.toContain(
      "thing:organization:sports_team:new_york_yankees"
    );
  });

  it("shows only generic condition values for sporting goods puck", () => {
    const state = makeState({
      segmentRef: "val:context:segment:memorabilia",
      thingRef: "thing:artifact:puck",
      thingPath: thingPath("thing:artifact:puck", registry),
    });

    const options = propOptions("prop:condition", state, registry);
    expect(options).toContain("val:condition:good");
    expect(
      options.every(
        (option) => !option.startsWith("val:condition:collectible_cards:")
      )
    ).toBe(true);
  });

  it("includes descendant ball sports through intermediate value branches", () => {
    const state = makeState({
      segmentRef: "val:context:segment:memorabilia",
      thingRef: "thing:artifact:ball",
      thingPath: thingPath("thing:artifact:ball", registry),
    });

    const options = propOptions("prop:sport", state, registry);
    expect(options).toContain("val:sport:basketball");
    expect(options).toContain("val:sport:baseball");
    expect(options).toContain("val:sport:rugby_union");
  });

  it("resolves baseball ball sport from real listing scope while preserving authored segment props", () => {
    const registryWithSportsMemorabilia = buildRegistry(
      [
        ...loadFixtureEvents(),
        event("val:context:segment:memorabilia:sports_memorabilia", {
          parents: ["val:context:segment:memorabilia"],
          labels: { en: "Sports memorabilia" },
          requiredRelations: ["prop:sport"],
          relations: [
            "prop:is_game_used",
            "prop:player",
            "prop:team",
            "prop:franchise",
            "prop:league",
          ],
        }),
      ],
      { trustedPubkeys: TRUSTED_TAXONOMY_PUBKEYS }
    );
    const state = makeState({
      segmentRef: "val:context:segment:memorabilia:sports_memorabilia",
      thingRef: "thing:artifact:ball:baseball",
      thingPath: thingPath(
        "thing:artifact:ball:baseball",
        registryWithSportsMemorabilia
      ),
    });
    const listingState = buildActiveListingState(
      state,
      registryWithSportsMemorabilia
    );

    expect(
      resolvePropResolution("prop:sport", state, registryWithSportsMemorabilia)
    ).toMatchObject({
      valueRefs: ["val:sport:baseball"],
      source: "scope",
      resolved: true,
      explicit: false,
    });
    expect(requiredProps(state, registryWithSportsMemorabilia)).toContain(
      "prop:sport"
    );
    expect(listingState.missingRequiredPropRefs).not.toContain("prop:sport");
    expect(applicableProps(state, registryWithSportsMemorabilia)).not.toContain(
      "prop:league"
    );
    expect(applicableProps(state, registryWithSportsMemorabilia)).not.toContain(
      "prop:team"
    );
    expect(listingState.orderedApplicablePropRefs).not.toContain("prop:sport");
    expect(listingState.orderedApplicablePropRefs).not.toContain("prop:league");
    expect(listingState.orderedApplicablePropRefs).not.toContain("prop:team");
  });

  it("serializes scope-resolved prop assertions for listing facets without rendering the resolved field", () => {
    const registryWithSportsMemorabilia = buildRegistry(
      [
        ...loadFixtureEvents(),
        event("val:context:segment:memorabilia:sports_memorabilia", {
          parents: ["val:context:segment:memorabilia"],
          labels: { en: "Sports memorabilia" },
          requiredRelations: ["prop:sport"],
          relations: [
            "prop:is_game_used",
            "prop:player",
            "prop:team",
            "prop:franchise",
            "prop:league",
          ],
        }),
      ],
      { trustedPubkeys: TRUSTED_TAXONOMY_PUBKEYS }
    );
    const state = makeState({
      segmentRef: "val:context:segment:memorabilia:sports_memorabilia",
      thingRef: "thing:artifact:ball:baseball",
      thingPath: thingPath(
        "thing:artifact:ball:baseball",
        registryWithSportsMemorabilia
      ),
    });
    const listingState = buildActiveListingState(
      state,
      registryWithSportsMemorabilia
    );

    expect(listingState.orderedApplicablePropRefs).not.toContain("prop:sport");
    expect(buildListingTaxonomyRefAssertions(listingState)).toContainEqual({
      propRef: "prop:sport",
      valueRef: "val:sport:baseball",
    });
  });

  it("listing view model exposes the same prop options and render tree the form previously derived", () => {
    const state = makeState({
      segmentRef: "val:context:segment:collectible_cards",
      thingRef: "thing:artifact:trading_card:single_card",
      thingPath: thingPath("thing:artifact:trading_card:single_card", registry),
      selectedValuesByProp: {
        "prop:sport": ["val:sport:basketball"],
      },
    });
    const listingState = buildActiveListingState(state, registry);

    expect(listingState.availableValuesByProp["prop:league"]).toEqual(
      propOptions("prop:league", state, registry)
    );
    expect(listingState.propFieldTree).toEqual(
      buildPropRenderTree(listingState.orderedApplicablePropRefs, registry)
    );
  });

  it("listing thing selection helper seeds required concrete values through the listing adapter", () => {
    const registryWithRequiredSport = buildRegistry(
      [
        ...loadFixtureEvents(),
        event("thing:artifact:required_sport_item", {
          parents: ["thing:artifact"],
          labels: { en: "Required sport item" },
          relations: ["prop:sport"],
          requiredRelations: ["val:sport:baseball"],
        }),
      ],
      { trustedPubkeys: TRUSTED_TAXONOMY_PUBKEYS }
    );

    expect(
      buildInitialListingStateForThing(
        registryWithRequiredSport,
        "thing:artifact:required_sport_item"
      )
    ).toMatchObject({
      thingRef: "thing:artifact:required_sport_item",
      selectedValuesByProp: {
        "prop:sport": ["val:sport:baseball"],
      },
    });
  });

  it("serializes required concrete values as filterable prop assertions even when the prop is not authored on the thing", () => {
    const registryWithRequiredSport = buildRegistry(
      [
        ...loadFixtureEvents(),
        event("thing:artifact:required_concrete_sport_item", {
          parents: ["thing:artifact"],
          labels: { en: "Required concrete sport item" },
          requiredRelations: ["val:sport:baseball"],
        }),
      ],
      { trustedPubkeys: TRUSTED_TAXONOMY_PUBKEYS }
    );
    const state = makeState({
      segmentRef: "val:context:segment:sporting_goods",
      thingRef: "thing:artifact:required_concrete_sport_item",
      thingPath: thingPath(
        "thing:artifact:required_concrete_sport_item",
        registryWithRequiredSport
      ),
    });
    const listingState = buildActiveListingState(
      state,
      registryWithRequiredSport
    );

    expect(listingState.orderedApplicablePropRefs).not.toContain("prop:sport");
    expect(buildListingTaxonomyRefAssertions(listingState)).toContainEqual({
      propRef: "prop:sport",
      valueRef: "val:sport:baseball",
    });
  });

  it("listing adapter exposes required collectible card game options for generator filling", () => {
    const state = makeState({
      segmentRef: "val:context:segment:collectible_cards",
      thingRef: "thing:artifact:collectible_card_game:booster_pack",
      thingPath: thingPath(
        "thing:artifact:collectible_card_game:booster_pack",
        registry
      ),
    });
    const listingState = buildActiveListingState(state, registry);

    expect(listingState.requiredPropRefs).toContain("prop:card_game");
    expect(listingState.missingRequiredPropRefs).toContain("prop:card_game");
    expect(
      listingState.availableValuesByProp["prop:card_game"]?.length
    ).toBeGreaterThan(0);
  });

  it("reports a wrong fixed segment distinctly from a missing segment", () => {
    const registryWithFixedSegment = buildRegistry(
      [
        ...loadFixtureEvents(),
        event("thing:artifact:fixed_segment_item", {
          parents: ["thing:artifact"],
          labels: { en: "Fixed segment item" },
          requiredRelations: ["val:context:segment:memorabilia"],
        }),
      ],
      { trustedPubkeys: TRUSTED_TAXONOMY_PUBKEYS }
    );
    const state = makeState({
      segmentRef: "val:context:segment:sporting_goods",
      thingRef: "thing:artifact:fixed_segment_item",
      thingPath: thingPath(
        "thing:artifact:fixed_segment_item",
        registryWithFixedSegment
      ),
    });

    expect(
      buildActiveListingState(state, registryWithFixedSegment).submitBlockReason
    ).toBe("wrong_segment");
  });

  it("serializes only selected contexts as listing refs", () => {
    const state = makeState({
      segmentRef: "val:context:segment:memorabilia",
      semanticContextRefs: ["val:context:usecase:display"],
    });

    expect(listingRefs(state)).toEqual([
      "val:context:segment:memorabilia",
      "val:context:usecase:display",
    ]);
  });

  it("decodeListingOverlayRefs decodes only persisted overlay refs", () => {
    const decoded = decodeListingOverlayRefs(
      [
        "val:context:segment:memorabilia",
        "val:context:segment:collectible_cards",
        "val:legacy:unknown_marker",
      ],
      registry
    );

    expect(decoded.segmentRef).toBe("val:context:segment:memorabilia");
    expect(decoded.thingRef).toBeNull();
    expect(decoded.selectedValuesByProp).toEqual({});
    expect(decoded.quarantinedLegacyRefs).toEqual([
      "val:context:segment:collectible_cards",
      "val:legacy:unknown_marker",
    ]);
    expect(decodeListingRefs([], registry)).toEqual(
      decodeListingOverlayRefs([], registry)
    );
  });

  it("quarantines invalid segment refs instead of activating ghost segments", () => {
    const decoded = decodeListingOverlayRefs(
      ["val:context:segment:does_not_exist"],
      registry
    );

    expect(decoded.segmentRef).toBeNull();
    expect(decoded.semanticContextRefs).toEqual([]);
    expect(decoded.quarantinedLegacyRefs).toEqual([
      "val:context:segment:does_not_exist",
    ]);
  });

  it("thingPath for puck reflects its direct artifact parent path", () => {
    expect(thingPath("thing:artifact:puck", registry)).toEqual([
      "thing:artifact:puck",
    ]);
  });

  it("orders dependent props before downstream props from graph dependencies", () => {
    const state = makeState({
      segmentRef: "val:context:segment:collectible_cards",
      thingRef: "thing:artifact:trading_card:single_card",
      thingPath: thingPath("thing:artifact:trading_card:single_card", registry),
    });

    expect(
      propOrder(["prop:team", "prop:league", "prop:sport"], state, registry)
    ).toEqual(["prop:sport", "prop:league", "prop:team"]);
  });

  it("clears dependent league and team selections when sport is cleared", () => {
    const currentState = makeState({
      segmentRef: "val:context:segment:collectible_cards",
      thingRef: "thing:artifact:trading_card:single_card",
      thingPath: thingPath("thing:artifact:trading_card:single_card", registry),
      selectedValuesByProp: {
        "prop:sport": ["val:sport:basketball"],
        "prop:league": ["thing:organization:league:nba"],
        "prop:team": ["thing:organization:sports_team:los_angeles_lakers"],
      },
    });

    const reconciled = reconcileTaxonomyState(
      {
        ...currentState,
        selectedValuesByProp: {
          "prop:league": ["thing:organization:league:nba"],
          "prop:team": ["thing:organization:sports_team:los_angeles_lakers"],
        },
      },
      registry
    );

    expect(reconciled.selectedValuesByProp["prop:league"]).toBeUndefined();
    expect(reconciled.selectedValuesByProp["prop:team"]).toBeUndefined();
  });

  it("clears dependent team selections when league is cleared", () => {
    const currentState = makeState({
      segmentRef: "val:context:segment:collectible_cards",
      thingRef: "thing:artifact:trading_card:single_card",
      thingPath: thingPath("thing:artifact:trading_card:single_card", registry),
      selectedValuesByProp: {
        "prop:sport": ["val:sport:basketball"],
        "prop:league": ["thing:organization:league:nba"],
        "prop:team": ["thing:organization:sports_team:los_angeles_lakers"],
      },
    });

    const reconciled = reconcileTaxonomyState(
      {
        ...currentState,
        selectedValuesByProp: {
          "prop:sport": ["val:sport:basketball"],
          "prop:team": ["thing:organization:sports_team:los_angeles_lakers"],
        },
      },
      registry
    );

    expect(reconciled.selectedValuesByProp["prop:sport"]).toEqual([
      "val:sport:basketball",
    ]);
    expect(reconciled.selectedValuesByProp["prop:team"]).toBeUndefined();
  });

  it("reconciles transitive inferred dependencies when an upstream value changes", () => {
    const currentState = makeState({
      segmentRef: "val:context:segment:collectible_cards",
      thingRef: "thing:artifact:trading_card:single_card",
      thingPath: thingPath("thing:artifact:trading_card:single_card", registry),
      selectedValuesByProp: {
        "prop:sport": ["val:sport:basketball"],
        "prop:team": ["thing:organization:sports_team:los_angeles_lakers"],
      },
    });

    const reconciled = reconcileTaxonomyState(
      {
        ...currentState,
        selectedValuesByProp: {
          "prop:sport": ["val:sport:baseball"],
          "prop:team": ["thing:organization:sports_team:los_angeles_lakers"],
        },
      },
      registry
    );

    expect(reconciled.selectedValuesByProp["prop:sport"]).toEqual([
      "val:sport:baseball",
    ]);
    expect(reconciled.selectedValuesByProp["prop:team"]).toBeUndefined();
  });

  it("clears selected values and literals for props that are no longer applicable after category removal", () => {
    const reconciled = reconcileTaxonomyState(
      makeState({
        segmentRef: null,
        thingRef: null,
        thingPath: [],
        selectedValuesByProp: {
          "prop:league": ["thing:organization:league:nba"],
          "prop:team": ["thing:organization:sports_team:los_angeles_lakers"],
          "prop:condition": ["val:condition:good"],
        },
        selectedLiteralsByProp: {
          "prop:card_number": "23",
          "prop:subject_name": "Magic Johnson",
        },
      }),
      registry
    );

    expect(reconciled.selectedValuesByProp["prop:condition"]).toBeUndefined();
    expect(reconciled.selectedValuesByProp["prop:league"]).toBeUndefined();
    expect(reconciled.selectedValuesByProp["prop:team"]).toBeUndefined();
    expect(
      reconciled.selectedLiteralsByProp["prop:card_number"]
    ).toBeUndefined();
    expect(
      reconciled.selectedLiteralsByProp["prop:subject_name"]
    ).toBeUndefined();
  });
});

describe("nested prop activation", () => {
  const nestedRegistry = buildRegistry(
    [
      event("thing:artifact", { labels: { en: "Artifact" } }),
      event("thing:artifact:test_card", {
        labels: { en: "Test card" },
        parents: ["thing:artifact"],
        relations: [
          "prop:autographed",
          "prop:grading_company",
          "prop:sport",
          "prop:condition",
          "prop:card_game",
          "prop:serial_numbering",
          "prop:cycle_value",
          "prop:cycle_a",
        ],
      }),
      event("thing:artifact:baseball_ball", {
        labels: { en: "Baseball ball" },
        parents: ["thing:artifact"],
        relations: [
          "val:context:segment:sports_memorabilia",
          "val:sport:baseball",
          "prop:sport",
        ],
      }),
      event("thing:artifact:ambiguous_sports_item", {
        labels: { en: "Ambiguous sports item" },
        parents: ["thing:artifact"],
        relations: ["val:sport:baseball", "val:sport:basketball", "prop:sport"],
      }),
      event("val:context:segment", { labels: { en: "Segment" } }),
      event("val:context:segment:memorabilia", {
        labels: { en: "Memorabilia" },
        parents: ["val:context:segment"],
        relations: ["prop:autographed"],
      }),
      event("val:context:segment:sports_memorabilia", {
        labels: { en: "Sports memorabilia" },
        parents: ["val:context:segment:memorabilia"],
        requiredRelations: ["prop:sport"],
      }),
      event("prop:autographed", {
        labels: { en: "Autographed" },
        relations: [
          "valtype:boolean",
          "prop:authentication_company",
          "prop:inscription_text",
        ],
        requiredRelations: ["prop:authentication_company"],
      }),
      event("prop:authentication_company", {
        labels: { en: "Authentication company" },
        relations: [
          "thing:organization:company:authentication_company",
          "prop:cert_number",
        ],
      }),
      event("prop:inscription_text", {
        labels: { en: "Inscription text" },
        relations: ["valtype:text"],
      }),
      event("prop:cert_number", {
        labels: { en: "Certification number" },
        relations: ["valtype:text"],
      }),
      event("prop:grading_company", {
        labels: { en: "Grading company" },
        relations: [
          "thing:organization:company:grading_company",
          "prop:grade_value",
          "prop:cert_number",
        ],
      }),
      event("prop:grade_value", {
        labels: { en: "Grade value" },
        relations: ["val:grade_value"],
      }),
      event("prop:condition", {
        labels: { en: "Condition" },
        relations: ["val:condition"],
      }),
      event("prop:damage_type", {
        labels: { en: "Damage type" },
        relations: ["val:damage_type"],
      }),
      event("prop:repair_status", {
        labels: { en: "Repair status" },
        relations: ["val:repair_status"],
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
      event("prop:card_game", {
        labels: { en: "Card game" },
        relations: ["thing:game:card_game", "prop:card_set"],
      }),
      event("prop:card_set", {
        labels: { en: "Card set" },
        relations: ["valtype:text", "prop:card_name"],
      }),
      event("prop:card_name", {
        labels: { en: "Card name" },
        relations: ["valtype:text", "prop:card_number"],
      }),
      event("prop:card_number", {
        labels: { en: "Card number" },
        relations: ["valtype:text"],
      }),
      event("prop:serial_numbering", {
        labels: { en: "Serial numbering" },
        relations: ["valtype:text", "prop:print_run"],
      }),
      event("prop:print_run", {
        labels: { en: "Print run" },
        relations: ["valtype:integer"],
      }),
      event("prop:cycle_value", {
        labels: { en: "Cycle value" },
        relations: ["val:cycle_value"],
      }),
      event("prop:cycle_a", {
        labels: { en: "Cycle A" },
        relations: ["valtype:text", "prop:cycle_b"],
      }),
      event("prop:cycle_b", {
        labels: { en: "Cycle B" },
        relations: ["valtype:text", "prop:cycle_a"],
      }),
      event("valtype:boolean", { labels: { en: "Boolean" } }),
      event("valtype:text", { labels: { en: "Text" } }),
      event("valtype:integer", { labels: { en: "Integer" } }),
      event("val:sport", { labels: { en: "Sport values" } }),
      event("val:sport:baseball", {
        labels: { en: "Baseball" },
        parents: ["val:sport"],
      }),
      event("val:sport:basketball", {
        labels: { en: "Basketball" },
        parents: ["val:sport"],
      }),
      event("val:grade_value", { labels: { en: "Grade values" } }),
      event("val:grade_value:gem_mint_10", {
        labels: { en: "Gem Mint 10" },
        parents: ["val:grade_value"],
      }),
      event("val:condition", { labels: { en: "Condition values" } }),
      event("val:condition:graded", {
        labels: { en: "Graded" },
        parents: ["val:condition"],
        relations: ["prop:grading_company", "prop:grade_value"],
      }),
      event("val:condition:damaged", {
        labels: { en: "Damaged" },
        parents: ["val:condition"],
        relations: ["prop:repair_status"],
        requiredRelations: ["prop:damage_type"],
      }),
      event("val:damage_type", { labels: { en: "Damage types" } }),
      event("val:damage_type:corner", {
        labels: { en: "Corner" },
        parents: ["val:damage_type"],
      }),
      event("val:repair_status", { labels: { en: "Repair statuses" } }),
      event("val:repair_status:repaired", {
        labels: { en: "Repaired" },
        parents: ["val:repair_status"],
      }),
      event("val:cycle_value", { labels: { en: "Cycle values" } }),
      event("val:cycle_value:selected", {
        labels: { en: "Selected cycle" },
        parents: ["val:cycle_value"],
        relations: ["prop:cycle_a"],
      }),
      event("thing:organization", { labels: { en: "Organization" } }),
      event("thing:organization:company", {
        labels: { en: "Company" },
        parents: ["thing:organization"],
      }),
      event("thing:organization:company:authentication_company", {
        labels: { en: "Authentication company" },
        parents: ["thing:organization:company"],
      }),
      event("thing:organization:company:authentication_company:psa_dna", {
        labels: { en: "PSA/DNA" },
        parents: ["thing:organization:company:authentication_company"],
      }),
      event("thing:organization:company:grading_company", {
        labels: { en: "Grading company" },
        parents: ["thing:organization:company"],
      }),
      event("thing:organization:company:grading_company:psa", {
        labels: { en: "PSA" },
        parents: ["thing:organization:company:grading_company"],
      }),
      event("thing:organization:league", {
        labels: { en: "League" },
        parents: ["thing:organization"],
      }),
      event("thing:organization:league:nba", {
        labels: { en: "NBA" },
        parents: ["thing:organization:league"],
        relations: ["val:sport:basketball"],
      }),
      event("thing:organization:sports_team", {
        labels: { en: "Sports team" },
        parents: ["thing:organization"],
      }),
      event("thing:organization:sports_team:lakers", {
        labels: { en: "Lakers" },
        parents: ["thing:organization:sports_team"],
        relations: ["thing:organization:league:nba"],
      }),
      event("thing:game", { labels: { en: "Game" } }),
      event("thing:game:card_game", {
        labels: { en: "Card game" },
        parents: ["thing:game"],
      }),
      event("thing:game:card_game:magic", {
        labels: { en: "Magic" },
        parents: ["thing:game:card_game"],
      }),
    ],
    { trustedPubkeys: ["TAXONOSTR_PUBKEY"] }
  );

  function nestedState(overrides: Partial<TaxonomyState> = {}): TaxonomyState {
    return makeState({
      thingRef: "thing:artifact:test_card",
      thingPath: thingPath("thing:artifact:test_card", nestedRegistry),
      ...overrides,
    });
  }

  it("does not activate autograph child props for false booleans", () => {
    const props = applicableProps(
      nestedState({ selectedLiteralsByProp: { "prop:autographed": "false" } }),
      nestedRegistry
    );

    expect(props).toContain("prop:autographed");
    expect(props).not.toContain("prop:authentication_company");
    expect(props).not.toContain("prop:cert_number");
  });

  it("activates autograph child props only when boolean true", () => {
    const state = nestedState({
      selectedLiteralsByProp: { "prop:autographed": "true" },
    });
    const props = applicableProps(state, nestedRegistry);

    expect(props).toContain("prop:authentication_company");
    expect(props).toContain("prop:inscription_text");
    expect(props).not.toContain("prop:cert_number");
    expect(requiredProps(state, nestedRegistry)).toContain(
      "prop:authentication_company"
    );
  });

  it("activates cert number after authentication company is selected", () => {
    const props = applicableProps(
      nestedState({
        selectedLiteralsByProp: { "prop:autographed": "true" },
        selectedValuesByProp: {
          "prop:authentication_company": [
            "thing:organization:company:authentication_company:psa_dna",
          ],
        },
      }),
      nestedRegistry
    );

    expect(props).toContain("prop:cert_number");
  });

  it("reconciliation keeps a selected child prop whose parent is an answered boolean", () => {
    const reconciled = reconcileTaxonomyState(
      nestedState({
        selectedLiteralsByProp: { "prop:autographed": "true" },
        selectedValuesByProp: {
          "prop:authentication_company": [
            "thing:organization:company:authentication_company:psa_dna",
          ],
        },
      }),
      nestedRegistry
    );

    expect(
      reconciled.selectedValuesByProp["prop:authentication_company"]
    ).toEqual(["thing:organization:company:authentication_company:psa_dna"]);
  });

  it("reconciliation prunes a selected child prop when its boolean parent is false", () => {
    const reconciled = reconcileTaxonomyState(
      nestedState({
        selectedLiteralsByProp: { "prop:autographed": "false" },
        selectedValuesByProp: {
          "prop:authentication_company": [
            "thing:organization:company:authentication_company:psa_dna",
          ],
        },
      }),
      nestedRegistry
    );

    expect(
      reconciled.selectedValuesByProp["prop:authentication_company"]
    ).toBeUndefined();
  });

  it("reconciliation keeps selected descendants when text literal parents are answered", () => {
    const reconciled = reconcileTaxonomyState(
      nestedState({
        selectedLiteralsByProp: {
          "prop:serial_numbering": "1/5",
          "prop:print_run": "5",
        },
        selectedValuesByProp: {},
      }),
      nestedRegistry
    );

    expect(reconciled.selectedLiteralsByProp["prop:print_run"]).toEqual("5");
  });

  it("reconciliation prunes selected descendants when text literal parents are empty", () => {
    const reconciled = reconcileTaxonomyState(
      nestedState({
        selectedLiteralsByProp: {
          "prop:serial_numbering": "",
          "prop:print_run": "5",
        },
      }),
      nestedRegistry
    );

    expect(reconciled.selectedLiteralsByProp["prop:print_run"]).toBeUndefined();
  });

  it("activates grade value and cert number after grading company is selected", () => {
    const props = applicableProps(
      nestedState({
        selectedValuesByProp: {
          "prop:grading_company": [
            "thing:organization:company:grading_company:psa",
          ],
        },
      }),
      nestedRegistry
    );

    expect(props).toContain("prop:grade_value");
    expect(props).toContain("prop:cert_number");
  });

  it("activates league after sport and team after league", () => {
    const sportState = nestedState({
      selectedValuesByProp: { "prop:sport": ["val:sport:basketball"] },
    });
    expect(applicableProps(sportState, nestedRegistry)).toContain(
      "prop:league"
    );
    expect(propOptions("prop:league", sportState, nestedRegistry)).toEqual([
      "thing:organization:league:nba",
    ]);

    const leagueState = nestedState({
      selectedValuesByProp: {
        "prop:sport": ["val:sport:basketball"],
        "prop:league": ["thing:organization:league:nba"],
      },
    });
    expect(applicableProps(leagueState, nestedRegistry)).toContain("prop:team");
    expect(propOptions("prop:team", leagueState, nestedRegistry)).toEqual([
      "thing:organization:sports_team:lakers",
    ]);
  });

  it("resolves required sport from active scope without activating league or team", () => {
    const state = makeState({
      segmentRef: "val:context:segment:sports_memorabilia",
      thingRef: "thing:artifact:baseball_ball",
      thingPath: thingPath("thing:artifact:baseball_ball", nestedRegistry),
    });

    expect(
      resolvePropResolution("prop:sport", state, nestedRegistry)
    ).toMatchObject({
      valueRefs: ["val:sport:baseball"],
      source: "scope",
      resolved: true,
      explicit: false,
    });
    expect(requiredProps(state, nestedRegistry)).toContain("prop:sport");
    expect(applicableProps(state, nestedRegistry)).not.toContain("prop:league");
    expect(applicableProps(state, nestedRegistry)).not.toContain("prop:team");
    expect(
      buildActiveListingState(state, nestedRegistry).missingRequiredPropRefs
    ).not.toContain("prop:sport");
  });

  it("inherits applicable props from selected segment ancestry", () => {
    const state = makeState({
      segmentRef: "val:context:segment:sports_memorabilia",
      thingRef: "thing:artifact:baseball_ball",
      thingPath: thingPath("thing:artifact:baseball_ball", nestedRegistry),
    });

    expect(
      nestedRegistry.nodeByRef["val:context:segment:sports_memorabilia"]
        ?.content.parents
    ).toContain("val:context:segment:memorabilia");
    expect(applicableProps(state, nestedRegistry)).toContain(
      "prop:autographed"
    );
    expect(
      buildResolvedTaxonomyState(state, nestedRegistry).availableProps
    ).toContain("prop:autographed");
    expect(
      buildActiveListingState(state, nestedRegistry).orderedApplicablePropRefs
    ).toContain("prop:autographed");
  });

  it("exposes core resolved taxonomy facts without activating children from scope resolution", () => {
    const state = makeState({
      segmentRef: "val:context:segment:sports_memorabilia",
      thingRef: "thing:artifact:baseball_ball",
      thingPath: thingPath("thing:artifact:baseball_ball", nestedRegistry),
    });
    const resolved = buildResolvedTaxonomyState(state, nestedRegistry);

    expect(resolved.propResolutions["prop:sport"]).toMatchObject({
      valueRefs: ["val:sport:baseball"],
      source: "scope",
      resolved: true,
      explicit: false,
    });
    expect(resolved.availableProps).toContain("prop:sport");
    expect(resolved.requiredPropRefs).toContain("prop:sport");
    expect(resolved.availableProps).not.toContain("prop:league");
    expect(resolved.availableValues["prop:sport"]).not.toContain("prop:league");
    expect(resolved.missingRequiredTaxonomyRefs).not.toContain("prop:sport");
  });

  it("does not auto-resolve ambiguous active-scope values and lets user assertions override", () => {
    const ambiguousState = makeState({
      thingRef: "thing:artifact:ambiguous_sports_item",
      thingPath: thingPath(
        "thing:artifact:ambiguous_sports_item",
        nestedRegistry
      ),
    });

    expect(
      resolvePropResolution("prop:sport", ambiguousState, nestedRegistry)
    ).toMatchObject({
      valueRefs: ["val:sport:baseball", "val:sport:basketball"],
      source: "ambiguous",
      resolved: false,
      ambiguous: true,
    });

    const userOverrideState = makeState({
      ...ambiguousState,
      selectedValuesByProp: { "prop:sport": ["val:sport:basketball"] },
    });
    expect(
      resolvePropResolution("prop:sport", userOverrideState, nestedRegistry)
    ).toMatchObject({
      valueRefs: ["val:sport:basketball"],
      source: "user",
      resolved: true,
      explicit: true,
    });
    expect(applicableProps(userOverrideState, nestedRegistry)).toContain(
      "prop:league"
    );
  });

  it("keeps prop activation edges out of dropdown values", () => {
    expect(
      propOptions("prop:sport", nestedState(), nestedRegistry)
    ).not.toContain("prop:league");
    expect(
      propOptions("prop:condition", nestedState(), nestedRegistry)
    ).not.toContain("prop:grading_company");
  });

  it("activates optional props from a selected value's relations", () => {
    const state = nestedState({
      selectedValuesByProp: { "prop:condition": ["val:condition:graded"] },
    });
    const props = applicableProps(state, nestedRegistry);

    expect(props).toContain("prop:grading_company");
    expect(props).toContain("prop:grade_value");
    expect(requiredProps(state, nestedRegistry)).not.toContain(
      "prop:grading_company"
    );
    expect(
      buildActiveListingState(state, nestedRegistry).missingRequiredPropRefs
    ).not.toContain("prop:grading_company");
  });

  it("activates value-triggered props from decoded listing assertions", () => {
    const listingState = buildActiveListingState(
      nestedState({
        selectedValuesByProp: { "prop:condition": ["val:condition:graded"] },
      }),
      nestedRegistry
    );

    expect(listingState.orderedApplicablePropRefs).toContain(
      "prop:grading_company"
    );
    expect(listingState.orderedApplicablePropRefs).toContain(
      "prop:grade_value"
    );
  });

  it("requires props reached through a selected value's requiredRelations", () => {
    const state = nestedState({
      selectedValuesByProp: { "prop:condition": ["val:condition:damaged"] },
    });

    expect(applicableProps(state, nestedRegistry)).toContain(
      "prop:damage_type"
    );
    expect(applicableProps(state, nestedRegistry)).toContain(
      "prop:repair_status"
    );
    expect(requiredProps(state, nestedRegistry)).toContain("prop:damage_type");
    expect(
      buildActiveListingState(state, nestedRegistry).missingRequiredPropRefs
    ).toContain("prop:damage_type");
  });

  it("nests value-triggered props under the prop whose value activated them", () => {
    const state = nestedState({
      selectedValuesByProp: { "prop:condition": ["val:condition:graded"] },
    });

    expect(
      buildPropRenderTree(
        ["prop:condition", "prop:grading_company", "prop:grade_value"],
        nestedRegistry,
        state
      )
    ).toEqual([
      {
        propRef: "prop:condition",
        children: [
          {
            propRef: "prop:grading_company",
            children: [{ propRef: "prop:grade_value", children: [] }],
          },
        ],
      },
    ]);
  });

  it("activates card game and serial numbering literal chains", () => {
    const cardGameState = nestedState({
      selectedValuesByProp: {
        "prop:card_game": ["thing:game:card_game:magic"],
      },
    });
    expect(applicableProps(cardGameState, nestedRegistry)).toContain(
      "prop:card_set"
    );

    const cardSetState = nestedState({
      selectedValuesByProp: {
        "prop:card_game": ["thing:game:card_game:magic"],
      },
      selectedLiteralsByProp: { "prop:card_set": "Alpha" },
    });
    expect(applicableProps(cardSetState, nestedRegistry)).toContain(
      "prop:card_name"
    );

    const cardNameState = nestedState({
      selectedValuesByProp: {
        "prop:card_game": ["thing:game:card_game:magic"],
      },
      selectedLiteralsByProp: {
        "prop:card_set": "Alpha",
        "prop:card_name": "Black Lotus",
      },
    });
    expect(applicableProps(cardNameState, nestedRegistry)).toContain(
      "prop:card_number"
    );

    const serialState = nestedState({
      selectedLiteralsByProp: { "prop:serial_numbering": "1/5" },
    });
    expect(applicableProps(serialState, nestedRegistry)).toContain(
      "prop:print_run"
    );
  });

  it("protects prop activation traversal from cycles", () => {
    const props = applicableProps(
      nestedState({
        selectedLiteralsByProp: {
          "prop:cycle_a": "yes",
          "prop:cycle_b": "also yes",
        },
      }),
      nestedRegistry
    );

    expect(props.filter((propRef) => propRef === "prop:cycle_a")).toHaveLength(
      1
    );
    expect(props.filter((propRef) => propRef === "prop:cycle_b")).toHaveLength(
      1
    );
  });

  it("protects mixed value and prop activation traversal from cycles", () => {
    const props = applicableProps(
      nestedState({
        selectedValuesByProp: {
          "prop:cycle_value": ["val:cycle_value:selected"],
        },
        selectedLiteralsByProp: { "prop:cycle_a": "yes" },
      }),
      nestedRegistry
    );

    expect(props.filter((propRef) => propRef === "prop:cycle_a")).toHaveLength(
      1
    );
    expect(props.filter((propRef) => propRef === "prop:cycle_b")).toHaveLength(
      1
    );
  });

  it("builds a nested prop render tree from available activation edges", () => {
    expect(
      buildPropRenderTree(
        [
          "prop:autographed",
          "prop:authentication_company",
          "prop:cert_number",
          "prop:inscription_text",
          "prop:sport",
          "prop:league",
          "prop:team",
        ],
        nestedRegistry
      )
    ).toEqual([
      {
        propRef: "prop:autographed",
        children: [
          {
            propRef: "prop:authentication_company",
            children: [{ propRef: "prop:cert_number", children: [] }],
          },
          { propRef: "prop:inscription_text", children: [] },
        ],
      },
      {
        propRef: "prop:sport",
        children: [
          {
            propRef: "prop:league",
            children: [{ propRef: "prop:team", children: [] }],
          },
        ],
      },
    ]);
  });
});
