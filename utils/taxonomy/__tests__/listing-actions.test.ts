import { buildRegistry } from "@/utils/taxonomy/registry";
import {
  applicableProps,
  reconcileTaxonomyState,
  thingPath,
} from "@/utils/taxonomy/client-state";
import {
  buildActiveListingState,
  buildInitialListingStateForThing,
} from "@/utils/taxonomy/listing-state";
import {
  clearListingTaxonomySelections,
  clearPropForListing,
  hydrateListingTaxonomyStateFromProduct,
  selectCompatibleSegmentForListing,
  selectSegmentForListing,
  selectThingForListing,
  setPropValueForListing,
  toggleContextForListing,
} from "@/utils/taxonomy/listing-actions";
import { TaxonomyState } from "@/utils/taxonomy/types";
import { NostrEvent } from "@/utils/types/types";

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

const registry = buildRegistry(
  [
    event("thing:artifact", { labels: { en: "Artifact" } }),
    event("thing:artifact:test_item", {
      labels: { en: "Test item" },
      parents: ["thing:artifact"],
      relations: [
        "val:context:segment:primary",
        "val:context:usecase:display",
        "prop:sport",
        "prop:note",
        "prop:count",
      ],
    }),
    event("thing:artifact:count_item", {
      labels: { en: "Count item" },
      parents: ["thing:artifact"],
      relations: ["val:context:segment:primary"],
      requiredRelations: ["prop:count"],
    }),
    event("val:context:segment", { labels: { en: "Segment" } }),
    event("val:context:segment:primary", {
      labels: { en: "Primary" },
      parents: ["val:context:segment"],
    }),
    event("val:context:segment:extra", {
      labels: { en: "Extra" },
      parents: ["val:context:segment"],
    }),
    event("val:context:segment:legacy", {
      labels: { en: "Legacy" },
      parents: ["val:context:segment"],
    }),
    event("val:context:usecase", { labels: { en: "Use case" } }),
    event("val:context:usecase:display", {
      labels: { en: "Display" },
      parents: ["val:context:usecase"],
      relations: ["prop:display_mode"],
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
    event("prop:display_mode", {
      labels: { en: "Display mode" },
      relations: ["val:display_mode"],
    }),
    event("prop:note", { labels: { en: "Note" }, relations: ["valtype:text"] }),
    event("prop:count", {
      labels: { en: "Count" },
      relations: ["valtype:integer"],
    }),
    event("valtype:text", { labels: { en: "Text" } }),
    event("valtype:integer", { labels: { en: "Integer" } }),
    event("val:sport", { labels: { en: "Sport values" } }),
    event("val:sport:basketball", {
      labels: { en: "Basketball" },
      parents: ["val:sport"],
    }),
    event("val:sport:baseball", {
      labels: { en: "Baseball" },
      parents: ["val:sport"],
    }),
    event("val:display_mode", { labels: { en: "Display modes" } }),
    event("val:display_mode:case", {
      labels: { en: "Case" },
      parents: ["val:display_mode"],
    }),
    event("thing:organization", { labels: { en: "Organization" } }),
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
  ],
  { trustedPubkeys: ["TAXONOSTR_PUBKEY"] }
);

describe("listing taxonomy actions", () => {
  it("selecting a thing through an action matches the existing listing initialization behavior", () => {
    expect(
      selectThingForListing(makeState(), "thing:artifact:test_item", registry)
    ).toEqual(
      reconcileTaxonomyState(
        buildInitialListingStateForThing(registry, "thing:artifact:test_item"),
        registry
      )
    );
  });

  it("treats numeric zero literals as answered required attributes", () => {
    const state = makeState({
      thingRef: "thing:artifact:count_item",
      thingPath: thingPath("thing:artifact:count_item", registry),
      segmentRef: "val:context:segment:primary",
      selectedLiteralsByProp: { "prop:count": 0 },
    });

    const listingState = buildActiveListingState(state, registry);
    expect(listingState.missingRequiredPropRefs).not.toContain("prop:count");
    expect(listingState.hasAnyAttribute).toBe(true);
    expect(listingState.canSubmit).toBe(true);
  });

  it("selecting a segment preserves one primary segment and quarantines extra segment overlays", () => {
    const state = selectSegmentForListing(
      makeState({
        thingRef: "thing:artifact:test_item",
        thingPath: thingPath("thing:artifact:test_item", registry),
        semanticContextRefs: [
          "val:context:segment:extra",
          "val:context:usecase:display",
        ],
        quarantinedLegacyRefs: ["val:context:segment:legacy"],
      }),
      "val:context:segment:primary",
      registry
    );

    expect(state.segmentRef).toBe("val:context:segment:primary");
    expect(state.semanticContextRefs).toEqual(["val:context:usecase:display"]);
    expect(state.quarantinedLegacyRefs).toEqual([
      "val:context:segment:extra",
      "val:context:segment:legacy",
    ]);
  });

  it("compatible segment selection enforces compatibility inside the listing action", () => {
    const baseState = makeState({
      thingRef: "thing:artifact:test_item",
      thingPath: thingPath("thing:artifact:test_item", registry),
    });

    const selectedState = selectCompatibleSegmentForListing(
      baseState,
      "val:context:segment:primary",
      ["val:context:segment:primary"],
      registry
    );
    expect(selectedState.segmentRef).toBe("val:context:segment:primary");

    const rejectedState = selectCompatibleSegmentForListing(
      selectedState,
      "val:context:segment:extra",
      ["val:context:segment:primary"],
      registry
    );
    expect(rejectedState.segmentRef).toBeNull();
    expect(rejectedState.quarantinedLegacyRefs).not.toContain(
      "val:context:segment:extra"
    );
  });

  it("hydrates edit listing taxonomy through the listing action boundary", () => {
    const state = hydrateListingTaxonomyStateFromProduct(
      {
        overlayValRefs: [
          "val:context:segment:primary",
          "val:context:usecase:display",
          "val:context:segment:legacy",
        ],
        primaryThingRef: "thing:artifact:test_item",
        refAssertions: [
          { propRef: "prop:sport", valueRef: "val:sport:basketball" },
          { propRef: "prop:sport", valueRef: "val:sport:baseball" },
          { propRef: "prop:display_mode", valueRef: "val:display_mode:case" },
        ],
        literalAssertions: [{ propRef: "prop:note", value: { label: "wall" } }],
        implicitBusinessFunctionRef: "val:business_function:classified",
      },
      registry
    );

    expect(state.thingRef).toBe("thing:artifact:test_item");
    expect(state.thingPath).toEqual(["thing:artifact:test_item"]);
    expect(state.segmentRef).toBe("val:context:segment:primary");
    expect(state.semanticContextRefs).toEqual(["val:context:usecase:display"]);
    expect(state.quarantinedLegacyRefs).toEqual(["val:context:segment:legacy"]);
    expect(state.selectedValuesByProp["prop:sport"]).toEqual([
      "val:sport:basketball",
      "val:sport:baseball",
    ]);
    expect(state.selectedValuesByProp["prop:display_mode"]).toEqual([
      "val:display_mode:case",
    ]);
    expect(state.selectedLiteralsByProp["prop:note"]).toBe('{"label":"wall"}');
  });

  it("toggling a context through an action preserves non-segment overlays", () => {
    const baseState = makeState({
      thingRef: "thing:artifact:test_item",
      thingPath: thingPath("thing:artifact:test_item", registry),
    });

    const selectedState = toggleContextForListing(
      baseState,
      "val:context:usecase:display",
      registry
    );
    expect(selectedState.semanticContextRefs).toEqual([
      "val:context:usecase:display",
    ]);
    expect(applicableProps(selectedState, registry)).toContain(
      "prop:display_mode"
    );

    const clearedState = toggleContextForListing(
      selectedState,
      "val:context:usecase:display",
      registry
    );
    expect(clearedState.semanticContextRefs).toEqual([]);
  });

  it("setting a prop value through an action preserves valid nested values", () => {
    const sportState = setPropValueForListing(
      makeState({
        thingRef: "thing:artifact:test_item",
        thingPath: thingPath("thing:artifact:test_item", registry),
      }),
      "prop:sport",
      ["val:sport:basketball"],
      registry
    );
    const leagueState = setPropValueForListing(
      sportState,
      "prop:league",
      ["thing:organization:league:nba"],
      registry
    );

    expect(leagueState.selectedValuesByProp["prop:sport"]).toEqual([
      "val:sport:basketball",
    ]);
    expect(leagueState.selectedValuesByProp["prop:league"]).toEqual([
      "thing:organization:league:nba",
    ]);
    expect(
      buildActiveListingState(leagueState, registry).orderedApplicablePropRefs
    ).toContain("prop:team");
  });

  it("clearing a prop through an action prunes invalid downstream values", () => {
    const populatedState = makeState({
      thingRef: "thing:artifact:test_item",
      thingPath: thingPath("thing:artifact:test_item", registry),
      selectedValuesByProp: {
        "prop:sport": ["val:sport:basketball"],
        "prop:league": ["thing:organization:league:nba"],
        "prop:team": ["thing:organization:sports_team:lakers"],
      },
    });

    const clearedState = clearPropForListing(
      populatedState,
      "prop:sport",
      registry
    );
    expect(clearedState.selectedValuesByProp["prop:sport"]).toBeUndefined();
    expect(clearedState.selectedValuesByProp["prop:league"]).toBeUndefined();
    expect(clearedState.selectedValuesByProp["prop:team"]).toBeUndefined();
  });

  it("clears selected thing when an explicit null override is provided", () => {
    const state = makeState({
      thingRef: "thing:artifact:test_item",
      thingPath: thingPath("thing:artifact:test_item", registry),
      segmentRef: "val:context:segment:primary",
    });

    const clearedState = clearListingTaxonomySelections(state, registry, {
      thingRef: null,
      thingPath: [],
      segmentRef: null,
    });

    expect(clearedState.thingRef).toBeNull();
    expect(clearedState.thingPath).toEqual([]);
    expect(clearedState.segmentRef).toBeNull();
  });
});
