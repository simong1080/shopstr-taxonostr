import { NostrEvent } from "@/utils/types/types";

export type TaxonomyFamily = "thing" | "prop" | "val" | "valtype";

export type TaxonomyNodeContent = {
  labels?: Record<string, string>;
  displayLabels?: Record<
    string,
    {
      singular?: string;
      plural?: string;
      category?: string;
      listingType?: string;
    }
  >;
  description?: Record<string, string>;
  parents?: string[];
  relations?: string[];
  requiredRelations?: string[];
  image?: {
    url?: string;
  };
  meta?: Record<string, unknown>;
  multiValued?: boolean;
  shape?: string;
  minimum?: number;
};

export interface TaxonomyNode extends Omit<NostrEvent, "content"> {
  d: string;
  family: TaxonomyFamily;
  coordinate: string;
  content: TaxonomyNodeContent;
}

export type ReverseRefType = "parents" | "relations" | "requiredRelations";

export interface ReverseRef {
  sourceRef: string;
  field: ReverseRefType;
}

export interface TaxonomyValueResolutionInput {
  primaryThingRef?: string;
  overlayValRefs?: string[];
  assertedValueRefs?: string[];
}

export interface ProductTaxonomyRefAssertion {
  propRef: string;
  valueRef: string;
}

export interface ProductTaxonomyLiteralAssertion {
  propRef: string;
  valueTypeRef?: string;
  value: unknown;
}

export interface ProductTaxonomy {
  primaryThingRef?: string;
  overlayValRefs: string[];
  requiredRefs?: string[];
  refAssertions: ProductTaxonomyRefAssertion[];
  literalAssertions: ProductTaxonomyLiteralAssertion[];
}

export type TaxonomyState = {
  segmentRef: string | null;
  thingRef: string | null;
  thingPath: string[];
  semanticContextRefs: string[];
  selectedValuesByProp: Record<string, string[]>;
  selectedLiteralsByProp: Record<string, unknown>;
  quarantinedLegacyRefs: string[];
};

export interface TaxonomyRegistry {
  loadedAt: string;
  loadedEventCount: number;
  source: "relay" | "fixture" | "empty";
  trustedPubkeys: string[];
  nodeByRef: Record<string, TaxonomyNode>;
  coordinateToRef: Record<string, string>;
  childrenByRef: Record<string, string[]>;
  ancestryByRef: Record<string, string[]>;
  descendantsByRef: Record<string, string[]>;
  descendantSetByRef: Record<string, Record<string, true>>;
  reverseRefsByRef: Record<string, ReverseRef[]>;
  imageByRef: Record<string, string>;
  relationsByRef: Record<string, string[]>;
  relationSetByRef: Record<string, Record<string, true>>;
  thingsBySegmentRef: Record<string, string[]>;
  fullThingPropsByRef: Record<string, string[]>;
  propRootsByRef: Record<string, string[]>;
  propSelectableCandidateRefsByRef: Record<string, string[]>;
  domainBranchChildrenByRootRef: Record<string, Record<string, string>>;
  propDirectDependsOnPropsByRef: Record<string, string[]>;
  propDependsOnPropsByRef: Record<string, string[]>;
  warnings: string[];
  errors: string[];
}
