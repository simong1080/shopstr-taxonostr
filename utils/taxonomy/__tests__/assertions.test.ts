import fs from "fs";
import path from "path";
import {
  encodeTaxonomyAddressTags,
  encodeTaxonomyAssertions,
  getTaxonomyRefsForIndexing,
} from "@/utils/taxonomy/assertions";
import { buildRegistry } from "@/utils/taxonomy/registry";
import { ProductTaxonomy } from "@/utils/taxonomy/types";
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

describe("taxonomy assertion tags", () => {
  it("keeps taxonomy tags as the structured semantic payload", () => {
    const taxonomy: ProductTaxonomy = {
      primaryThingRef: "thing:artifact:apparel:jersey",
      overlayValRefs: ["val:context:segment:memorabilia"],
      requiredRefs: ["val:sport:basketball"],
      refAssertions: [
        {
          propRef: "prop:team",
          valueRef: "thing:organization:sports_team:new_york_knicks",
        },
      ],
      literalAssertions: [
        {
          propRef: "prop:autographed",
          valueTypeRef: "valtype:boolean",
          value: true,
        },
      ],
    };

    expect(encodeTaxonomyAssertions(taxonomy)).toEqual([
      ["taxonomy", "thing", "thing:artifact:apparel:jersey"],
      ["taxonomy", "overlay", "val:context:segment:memorabilia"],
      ["taxonomy", "required", "val:sport:basketball"],
      [
        "taxonomy",
        "ref",
        "prop:team",
        "thing:organization:sports_team:new_york_knicks",
      ],
      ["taxonomy", "literal", "prop:autographed", "valtype:boolean", "true"],
    ]);
  });

  it("requires exactly one primary segment overlay when encoding listing taxonomy", () => {
    const base: ProductTaxonomy = {
      primaryThingRef: "thing:artifact:apparel:jersey",
      overlayValRefs: [],
      requiredRefs: [],
      refAssertions: [],
      literalAssertions: [],
    };

    expect(() => encodeTaxonomyAssertions(base)).toThrow(
      "exactly one primary segment"
    );
    expect(() =>
      encodeTaxonomyAssertions({
        ...base,
        overlayValRefs: [
          "val:context:segment:memorabilia",
          "val:context:segment:collectible_cards",
        ],
      })
    ).toThrow("exactly one primary segment");
  });

  it("collects exact taxonomy refs for relay-level address indexing", () => {
    const taxonomy: ProductTaxonomy = {
      primaryThingRef: "thing:artifact:apparel:jersey",
      overlayValRefs: [
        "val:context:segment:memorabilia",
        "val:context:segment:memorabilia",
      ],
      requiredRefs: ["val:sport:basketball"],
      refAssertions: [
        {
          propRef: "prop:team",
          valueRef: "thing:organization:sports_team:new_york_knicks",
        },
      ],
      literalAssertions: [
        {
          propRef: "prop:autographed",
          valueTypeRef: "valtype:boolean",
          value: true,
        },
      ],
    };

    expect(getTaxonomyRefsForIndexing(taxonomy)).toEqual([
      "thing:artifact:apparel:jersey",
      "val:context:segment:memorabilia",
      "val:sport:basketball",
      "prop:team",
      "thing:organization:sports_team:new_york_knicks",
      "prop:autographed",
      "valtype:boolean",
    ]);
  });

  it("encodes deduped a tags for refs that exist in the registry", () => {
    const registry = buildRegistry(loadFixtureEvents(), {
      trustedPubkeys: TRUSTED_TAXONOMY_PUBKEYS,
    });
    const taxonomy: ProductTaxonomy = {
      primaryThingRef: "thing:artifact:apparel:jersey",
      overlayValRefs: ["val:context:segment:memorabilia"],
      requiredRefs: ["val:sport:basketball"],
      refAssertions: [
        {
          propRef: "prop:team",
          valueRef: "thing:organization:sports_team:new_york_knicks",
        },
        {
          propRef: "prop:team",
          valueRef: "thing:organization:sports_team:new_york_knicks",
        },
      ],
      literalAssertions: [
        {
          propRef: "prop:autographed",
          valueTypeRef: "valtype:boolean",
          value: true,
        },
      ],
    };

    const addressTags = encodeTaxonomyAddressTags(taxonomy, registry);
    const coordinates = addressTags.map((tag) => tag[1]);

    expect(addressTags.every((tag) => tag[0] === "a")).toBe(true);
    expect(new Set(coordinates).size).toBe(coordinates.length);
    expect(coordinates).toContain(
      registry.nodeByRef["thing:artifact:apparel:jersey"].coordinate
    );
    expect(coordinates).toContain(
      registry.nodeByRef["val:context:segment:memorabilia"].coordinate
    );
    expect(coordinates).toContain(
      registry.nodeByRef["val:sport:basketball"].coordinate
    );
    expect(coordinates).toContain(
      registry.nodeByRef["thing:organization:sports_team:new_york_knicks"]
        .coordinate
    );
  });

  it("skips refs that are not present in the registry", () => {
    const registry = buildRegistry(loadFixtureEvents(), {
      trustedPubkeys: TRUSTED_TAXONOMY_PUBKEYS,
    });
    const addressTags = encodeTaxonomyAddressTags(
      {
        primaryThingRef: "thing:artifact:not_real",
        overlayValRefs: [],
        requiredRefs: [],
        refAssertions: [],
        literalAssertions: [],
      },
      registry
    );

    expect(addressTags).toEqual([]);
  });
});
