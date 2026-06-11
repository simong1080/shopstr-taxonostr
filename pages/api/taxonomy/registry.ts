import type { NextApiRequest, NextApiResponse } from "next";
import {
  clearServerTaxonomyRegistryCache,
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
  try {
    if (req.query.refresh === "1") {
      clearServerTaxonomyRegistryCache();
    }

    const trustedPubkeys = parseQueryArray(req.query.pubkeys);
    const relayUrls = parseQueryArray(req.query.relays);
    const fixturePath =
      typeof req.query.fixturePath === "string"
        ? req.query.fixturePath
        : undefined;
    const registry = await getServerTaxonomyRegistry({
      trustedPubkeys,
      relayUrls,
      fixturePath,
    });
    res.status(200).json(registry);
  } catch (error) {
    res.status(500).json({
      error: "Failed to load taxonomy registry",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
