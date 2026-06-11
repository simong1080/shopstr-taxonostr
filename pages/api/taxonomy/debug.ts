import type { NextApiRequest, NextApiResponse } from "next";
import { buildMarketplaceResolverTrace } from "@/utils/taxonomy/marketplace-scope";
import {
  clearServerTaxonomyRegistryCache,
  getServerTaxonomyDiagnostics,
  getServerTaxonomyRegistry,
} from "@/utils/taxonomy/server-registry";

function parseQueryArray(
  value: string | string[] | undefined
): string[] | undefined {
  if (!value) return undefined;
  const joined = Array.isArray(value) ? value.join(",") : value;
  return joined
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (req.query.refresh === "1") {
      clearServerTaxonomyRegistryCache();
    }

    const trustedPubkeys = parseQueryArray(req.query.pubkeys);
    const relayUrls = parseQueryArray(req.query.relays);
    const sourceOptions = { trustedPubkeys, relayUrls };
    const diagnostics = await getServerTaxonomyDiagnostics(sourceOptions);
    const hasMarketplaceScope =
      Boolean(req.query.thing) ||
      Boolean(req.query.context) ||
      Boolean(req.query.taxon) ||
      Boolean(req.query.pv) ||
      Boolean(req.query.value);
    if (!hasMarketplaceScope) {
      return res.status(200).json(diagnostics);
    }

    const registry = await getServerTaxonomyRegistry(sourceOptions);
    const protocol = req.headers["x-forwarded-proto"] || "http";
    const host = req.headers.host || "localhost";
    return res.status(200).json({
      ...diagnostics,
      marketplaceResolverTrace: buildMarketplaceResolverTrace(
        req.query,
        registry,
        {
          url: `${protocol}://${host}${req.url || ""}`,
          matchedListingCount: 0,
          filtersFromActualListingsOnly: false,
          filterProps: [],
        }
      ),
    });
  } catch (error) {
    console.error("Failed to compute taxonomy diagnostics:", error);
    return res.status(500).json({
      error: "Failed to compute taxonomy diagnostics",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
