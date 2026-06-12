import fs from "fs";
import path from "path";
import { buildRegistry } from "@/utils/taxonomy/registry";
import {
  buildSerializedOverlayRefs,
  getDerivedHelperContextRefs,
  partitionPersistedOverlayRefs,
  resetTaxonomyFormStateForCategoryChange,
} from "@/utils/taxonomy/form-state";
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

describe("taxonomy form state", () => {
  it("category change clears semantic overlays and quarantined legacy refs", () => {
    expect(resetTaxonomyFormStateForCategoryChange()).toEqual({
      activeSemanticOverlayRefs: [],
      quarantinedLegacyOverlayRefs: [],
      taxonomyRefAssertions: {},
      taxonomyLiteralAssertions: {},
      taxonomyError: null,
    });
  });

  it("editing and re-saving a legacy listing preserves persisted refs without live semantic leakage", () => {
    const registry = buildRegistry(loadFixtureEvents(), {
      trustedPubkeys: TRUSTED_TAXONOMY_PUBKEYS,
    });
    const helperContextOverlayRefs = getDerivedHelperContextRefs(
      registry,
      "thing:artifact:trading_card:single_card",
      ["val:context:segment:memorabilia"]
    );
    const partition = partitionPersistedOverlayRefs({
      registry,
      selectedThingRef: "thing:artifact:trading_card:single_card",
      persistedOverlayRefs: [
        "val:context:segment:memorabilia",
        "val:context:usecase:collecting",
        "val:status:used",
      ],
      helperContextOverlayRefs,
      implicitBusinessFunctionRef: "val:business_function:sell",
    });

    expect(partition.segmentRefs).toEqual(["val:context:segment:memorabilia"]);
    expect(partition.activeSemanticOverlayRefs).toEqual([]);
    expect(partition.quarantinedLegacyOverlayRefs).toEqual(["val:status:used"]);

    expect(
      buildSerializedOverlayRefs({
        implicitBusinessFunctionRef: "val:business_function:sell",
        primarySegmentRef: partition.segmentRefs[0],
        activeSemanticOverlayRefs: partition.activeSemanticOverlayRefs,
        listingLabelOverlayRefs: helperContextOverlayRefs,
        legacyOverlayRefs: partition.quarantinedLegacyOverlayRefs,
      })
    ).toEqual([
      "val:business_function:sell",
      "val:context:segment:memorabilia",
      "val:context:segment:collectible_cards",
      "val:context:usecase:collecting",
      "val:context:segment:memorabilia:sports_memorabilia",
      "val:status:used",
    ]);
  });

  it("quarantines persisted extra segment refs instead of restoring them as semantic overlays", () => {
    const registry = buildRegistry(loadFixtureEvents(), {
      trustedPubkeys: TRUSTED_TAXONOMY_PUBKEYS,
    });
    const partition = partitionPersistedOverlayRefs({
      registry,
      selectedThingRef: "thing:artifact:helmet",
      persistedOverlayRefs: [
        "val:context:segment:sporting_goods",
        "val:context:segment:memorabilia",
        "val:legacy:unknown_marker",
      ],
      helperContextOverlayRefs: ["val:context:usecase:collecting"],
      implicitBusinessFunctionRef: "val:business_function:sell",
    });

    expect(partition.segmentRefs).toEqual([
      "val:context:segment:sporting_goods",
    ]);
    expect(partition.activeSemanticOverlayRefs).toEqual([]);
    expect(partition.quarantinedLegacyOverlayRefs).toEqual([
      "val:context:segment:memorabilia",
      "val:legacy:unknown_marker",
    ]);
  });
});
