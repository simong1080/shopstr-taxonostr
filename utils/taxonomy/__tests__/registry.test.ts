import fs from "fs";
import path from "path";
import {
  buildRegistry,
  registryApplicableProps,
  getTaxonomyNodeLabel,
  registryPropOptions,
} from "@/utils/taxonomy/registry";
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

function event(
  d: string,
  content: Record<string, unknown>,
  overrides: Partial<NostrEvent> = {}
): NostrEvent {
  return {
    id: `${d}-id`,
    pubkey: "TAXONOSTR_PUBKEY",
    created_at: 1772400000,
    kind: 30078,
    tags: [["d", d]],
    content: JSON.stringify(content),
    sig: `${d}-sig`,
    ...overrides,
  } as NostrEvent;
}

describe("buildRegistry", () => {
  it("builds ancestry and graph indexes", () => {
    const registry = buildRegistry(loadFixtureEvents(), {
      trustedPubkeys: TRUSTED_TAXONOMY_PUBKEYS,
    });

    expect(registry.nodeByRef["thing:artifact:trading_card"]).toBeDefined();
    expect(
      registry.ancestryByRef["thing:artifact:trading_card:single_card"]
    ).toContain("thing:artifact:trading_card");
    expect(registry.descendantsByRef["thing:artifact:trading_card"]).toContain(
      "thing:artifact:trading_card:single_card"
    );
    expect(registry.trustedPubkeys).toEqual(TRUSTED_TAXONOMY_PUBKEYS);
    expect(Array.isArray(registry.warnings)).toBe(true);
    expect(registry.propRootsByRef["prop:league"]).toEqual([
      "thing:organization:league",
    ]);
    expect(registry.propSelectableCandidateRefsByRef["prop:league"]).toContain(
      "thing:organization:league:nba"
    );
    expect(
      registry.domainBranchChildrenByRootRef["val:condition"]
    ).toMatchObject({
      collectible_cards: "val:condition:collectible_cards",
    });
    expect(
      getTaxonomyNodeLabel(
        registry,
        "val:context:segment:apparel_and_accessories",
        "en"
      )
    ).toBe("Apparel & accessories");
    expect(
      getTaxonomyNodeLabel(
        registry,
        "val:context:segment:not_in_registry",
        "en"
      )
    ).toBe("Not In Registry");
  });

  it("uses deterministic timestamp tie-breaking and clears stale images", () => {
    const registry = buildRegistry(
      [
        event(
          "thing:artifact:test",
          {
            labels: { en: "Old" },
            image: { url: "https://example.test/old.png" },
          },
          { id: "aaa", created_at: 10 }
        ),
        event(
          "thing:artifact:test",
          {
            labels: { en: "New" },
          },
          { id: "zzz", created_at: 10 }
        ),
      ],
      { trustedPubkeys: ["TAXONOSTR_PUBKEY"] }
    );

    expect(getTaxonomyNodeLabel(registry, "thing:artifact:test", "en")).toBe(
      "New"
    );
    expect(registry.imageByRef["thing:artifact:test"]).toBeUndefined();
  });

  it("infers prop dependencies from ontology connectivity", () => {
    const registry = buildRegistry(loadFixtureEvents(), {
      trustedPubkeys: TRUSTED_TAXONOMY_PUBKEYS,
    });

    expect(registry.propDependsOnPropsByRef["prop:league"]).toContain(
      "prop:sport"
    );
    expect(registry.propDirectDependsOnPropsByRef["prop:league"]).toContain(
      "prop:sport"
    );
    expect(registry.propDirectDependsOnPropsByRef["prop:team"]).toEqual([
      "prop:league",
    ]);
    expect(registry.propDependsOnPropsByRef["prop:team"]).toContain(
      "prop:league"
    );
    expect(registry.propDependsOnPropsByRef["prop:team"]).toContain(
      "prop:sport"
    );
    expect(registry.propDependsOnPropsByRef["prop:condition"]).toEqual([]);
  });

  it("computes base applicable props from thing ancestry plus structural overlays", () => {
    const registry = buildRegistry(loadFixtureEvents(), {
      trustedPubkeys: TRUSTED_TAXONOMY_PUBKEYS,
    });
    const props = registryApplicableProps(registry, {
      primaryThingRef: "thing:artifact:trading_card",
      primarySegmentRef: "val:context:segment:memorabilia",
      overlayValRefs: ["val:business_function:sell"],
    });

    expect(props).toContain("prop:sport");
    expect(props).not.toContain("prop:league");
  });

  it("prefers the trading-card condition subtree when resolving condition values", () => {
    const registry = buildRegistry(loadFixtureEvents(), {
      trustedPubkeys: TRUSTED_TAXONOMY_PUBKEYS,
    });
    const options = registryPropOptions(registry, "prop:condition", {
      primaryThingRef: "thing:artifact:trading_card",
    });

    expect(options).toContain("val:condition:collectible_cards:mint");
    expect(options).not.toContain("val:condition:new");
  });

  it("does not activate segment props from helper use cases once a primary thing is chosen", () => {
    const registry = buildRegistry(loadFixtureEvents(), {
      trustedPubkeys: TRUSTED_TAXONOMY_PUBKEYS,
    });
    const props = registryApplicableProps(registry, {
      primaryThingRef: "thing:artifact:trading_card:single_card",
      primarySegmentRef: "val:context:segment:collectible_cards",
      overlayValRefs: ["val:context:usecase:collecting"],
    });

    expect(props).toContain("prop:sport");
    expect(props).toContain("prop:card_type");
    expect(props).not.toContain("prop:is_game_used");
  });

  it("narrows league options from selected sport via reverse relations", () => {
    const registry = buildRegistry(loadFixtureEvents(), {
      trustedPubkeys: TRUSTED_TAXONOMY_PUBKEYS,
    });
    const options = registryPropOptions(registry, "prop:league", {
      primaryThingRef: "thing:artifact:trading_card",
      assertedValueRefs: ["val:sport:basketball"],
    });

    expect(options).toContain("thing:organization:league:nba");
    expect(options).toContain("thing:organization:league:wnba");
    expect(options).not.toContain("thing:organization:league:nfl");
  });

  it("keeps broad team options when only a non-league sport value is selected", () => {
    const registry = buildRegistry(loadFixtureEvents(), {
      trustedPubkeys: TRUSTED_TAXONOMY_PUBKEYS,
    });
    const options = registryPropOptions(registry, "prop:team", {
      primaryThingRef: "thing:artifact:trading_card",
      assertedValueRefs: ["val:sport:basketball"],
    });

    expect(options).toContain(
      "thing:organization:sports_team:los_angeles_lakers"
    );
    expect(options).toContain(
      "thing:organization:sports_team:new_york_liberty"
    );
    expect(options).toContain(
      "thing:organization:sports_team:new_york_yankees"
    );
  });

  it("narrows team options from an explicitly selected league", () => {
    const registry = buildRegistry(loadFixtureEvents(), {
      trustedPubkeys: TRUSTED_TAXONOMY_PUBKEYS,
    });
    const options = registryPropOptions(registry, "prop:team", {
      primaryThingRef: "thing:artifact:trading_card",
      assertedValueRefs: ["thing:organization:league:nba"],
    });

    expect(options).toContain(
      "thing:organization:sports_team:los_angeles_lakers"
    );
    expect(options).toContain("thing:organization:sports_team:new_york_knicks");
    expect(options).not.toContain(
      "thing:organization:sports_team:new_york_liberty"
    );
  });

  it("does not pull collectible-card condition values for memorabilia sporting goods", () => {
    const registry = buildRegistry(loadFixtureEvents(), {
      trustedPubkeys: TRUSTED_TAXONOMY_PUBKEYS,
    });
    const options = registryPropOptions(registry, "prop:condition", {
      primaryThingRef: "thing:artifact:puck",
    });

    expect(options).toContain("val:condition:good");
    expect(options).not.toContain("val:condition:collectible_cards:mint");
    expect(
      options.every(
        (option) => !option.startsWith("val:condition:collectible_cards:")
      )
    ).toBe(true);
  });

  it("reports an error when a node has multiple required segment refs", () => {
    const badNode = {
      id: "bad-required-segments-id",
      pubkey: "TAXONOSTR_PUBKEY",
      created_at: 1772400000,
      kind: 30078,
      tags: [["d", "thing:artifact:bad_required_segments"]],
      content: JSON.stringify({
        labels: { en: "Bad required segments" },
        parents: ["thing:artifact"],
        requiredRelations: [
          "val:context:segment:memorabilia",
          "val:context:segment:collectible_cards",
        ],
      }),
      sig: "bad-required-segments-sig",
    } as NostrEvent;

    const registry = buildRegistry([...loadFixtureEvents(), badNode], {
      trustedPubkeys: TRUSTED_TAXONOMY_PUBKEYS,
    });

    expect(registry.errors).toContain(
      "thing:artifact:bad_required_segments requiredRelations must contain at most one val:context:segment:* ref."
    );
  });

  it("reports descendant cycles without recursing indefinitely", () => {
    const cyclicParent = {
      id: "cycle-parent-id",
      pubkey: "TAXONOSTR_PUBKEY",
      created_at: 1772400000,
      kind: 30078,
      tags: [["d", "thing:artifact:cycle_parent"]],
      content: JSON.stringify({
        labels: { en: "Cycle parent" },
        parents: ["thing:artifact:cycle_child"],
      }),
      sig: "cycle-parent-sig",
    } as NostrEvent;
    const cyclicChild = {
      id: "cycle-child-id",
      pubkey: "TAXONOSTR_PUBKEY",
      created_at: 1772400000,
      kind: 30078,
      tags: [["d", "thing:artifact:cycle_child"]],
      content: JSON.stringify({
        labels: { en: "Cycle child" },
        parents: ["thing:artifact:cycle_parent"],
      }),
      sig: "cycle-child-sig",
    } as NostrEvent;

    const registry = buildRegistry(
      [...loadFixtureEvents(), cyclicParent, cyclicChild],
      {
        trustedPubkeys: TRUSTED_TAXONOMY_PUBKEYS,
      }
    );

    expect(
      registry.errors.some((error) =>
        error.startsWith("Cycle detected while resolving descendants for ")
      )
    ).toBe(true);
  });

  it("derives reverse relations for arbitrary axes", () => {
    const registry = buildRegistry(loadFixtureEvents(), {
      trustedPubkeys: TRUSTED_TAXONOMY_PUBKEYS,
    });
    const reverseRefs =
      registry.reverseRefsByRef[
        "val:context:segment:memorabilia:sports_memorabilia"
      ] || [];

    expect(reverseRefs.map((ref) => ref.sourceRef)).toContain(
      "thing:artifact:trading_card"
    );
  });
});
