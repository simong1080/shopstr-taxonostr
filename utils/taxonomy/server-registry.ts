import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import {
  buildRegistry,
  createEmptyTaxonomyRegistry,
} from "@/utils/taxonomy/registry";
import { TaxonomyRegistry } from "@/utils/taxonomy/types";
import { NostrEvent } from "@/utils/types/types";

export interface ServerTaxonomyRegistryOptions {
  trustedPubkeys?: string[];
  relayUrls?: string[];
  fixturePath?: string;
  cacheTtlMs?: number;
  cacheDir?: string;
}

interface RegistryCacheEntry {
  cacheKey: string;
  expiresAt: number;
  registry: TaxonomyRegistry;
}

let registryCache: RegistryCacheEntry | null = null;
const inFlightRegistryLoads = new Map<string, Promise<TaxonomyRegistry>>();

export function parseCsvEnv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function resolveOptions(
  options?: ServerTaxonomyRegistryOptions
): Required<ServerTaxonomyRegistryOptions> {
  return {
    trustedPubkeys:
      options?.trustedPubkeys ||
      parseCsvEnv(process.env.TAXONOSTR_TRUSTED_PUBKEYS),
    relayUrls:
      options?.relayUrls || parseCsvEnv(process.env.TAXONOSTR_READ_RELAYS),
    fixturePath:
      options?.fixturePath ||
      process.env.TAXONOSTR_FIXTURE_PATH ||
      path.join(
        process.cwd(),
        "fixtures",
        "taxonomy",
        "taxonostr-authoring.jsonl"
      ),
    cacheTtlMs:
      options?.cacheTtlMs ||
      Number(process.env.TAXONOSTR_CACHE_TTL_MS || 60_000),
    cacheDir:
      options?.cacheDir ||
      process.env.TAXONOSTR_CACHE_DIR ||
      path.join(process.cwd(), ".cache", "taxonomy"),
  };
}

function getCoordinateForEvent(event: NostrEvent): string | undefined {
  const d = event.tags?.find((tag) => tag[0] === "d")?.[1];
  return d ? `${event.kind}:${event.pubkey}:${d}` : undefined;
}

function isNewerTaxonomyEvent(
  candidate: NostrEvent,
  existing: NostrEvent | undefined
): boolean {
  if (!existing) return true;
  if (candidate.created_at !== existing.created_at)
    return candidate.created_at > existing.created_at;
  return String(candidate.id || "") > String(existing.id || "");
}

function getCacheFilePath(cacheDir: string, cacheKey: string): string {
  const fileKey = crypto.createHash("sha256").update(cacheKey).digest("hex");
  return path.join(cacheDir, `${fileKey}.json`);
}

async function readCachedLatestEvents(filePath: string): Promise<NostrEvent[]> {
  const contents = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(contents) as { events?: NostrEvent[] };
  return Array.isArray(parsed.events) ? parsed.events : [];
}

async function readCachedLatestEventsIfAvailable(
  filePath: string
): Promise<NostrEvent[]> {
  try {
    return await readCachedLatestEvents(filePath);
  } catch {
    return [];
  }
}

async function writeCachedLatestEvents(
  filePath: string,
  events: NostrEvent[]
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    JSON.stringify({ writtenAt: new Date().toISOString(), events })
  );
}

async function getCacheFileMtime(filePath: string): Promise<number | null> {
  try {
    const stat = await fs.stat(filePath);
    return stat.mtimeMs;
  } catch {
    return null;
  }
}

function createSubId(): string {
  return `taxonostr-${Math.random().toString(36).slice(2)}`;
}

async function fetchPageFromRelay(
  relayUrl: string,
  filter: Record<string, unknown>,
  timeoutMs: number = 15000
): Promise<NostrEvent[]> {
  return await new Promise<NostrEvent[]>((resolve, reject) => {
    const socket = new WebSocket(relayUrl);
    const subId = createSubId();
    const events: NostrEvent[] = [];
    let settled = false;

    const finish = (result: NostrEvent[], error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      try {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(["CLOSE", subId]));
        }
      } catch {}
      try {
        socket.close();
      } catch {}
      if (error) reject(error);
      else resolve(result);
    };

    const timeoutId = setTimeout(() => {
      finish(events);
    }, timeoutMs);

    socket.addEventListener("open", () => {
      try {
        socket.send(JSON.stringify(["REQ", subId, filter]));
      } catch (error) {
        finish(
          events,
          error instanceof Error ? error : new Error(String(error))
        );
      }
    });

    socket.addEventListener("message", (message) => {
      try {
        const payload = JSON.parse(String(message.data));
        if (!Array.isArray(payload)) return;
        const [type, incomingSubId, data] = payload;
        if (incomingSubId !== subId) return;
        if (type === "EVENT" && data) {
          events.push(data as NostrEvent);
          return;
        }
        if (type === "EOSE") {
          finish(events);
          return;
        }
      } catch (error) {
        finish(
          events,
          error instanceof Error ? error : new Error(String(error))
        );
      }
    });

    socket.addEventListener("error", () => {
      finish(
        events,
        new Error(
          `WebSocket error while fetching taxonomy page from ${relayUrl}`
        )
      );
    });

    socket.addEventListener("close", () => {
      finish(events);
    });
  });
}

async function readFixtureEvents(filePath: string): Promise<NostrEvent[]> {
  const contents = await fs.readFile(filePath, "utf8");
  return contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as NostrEvent);
}

async function readFixtureEventsIfAvailable(
  filePath: string
): Promise<NostrEvent[]> {
  try {
    return await readFixtureEvents(filePath);
  } catch {
    return [];
  }
}

async function fetchTrustedTaxonomyEventsFromRelays(
  trustedPubkeys: string[],
  relayUrls: string[]
): Promise<NostrEvent[]> {
  if (trustedPubkeys.length === 0 || relayUrls.length === 0) {
    return [];
  }

  const pageLimit = Number(process.env.TAXONOSTR_RELAY_PAGE_LIMIT || 500);
  const seenIds = new Set<string>();
  const latestPerCoordinate = new Map<string, NostrEvent>();

  for (const relayUrl of relayUrls) {
    let until: number | undefined;
    let previousPageIds = new Set<string>();
    let iterations = 0;

    while (iterations++ < 1000) {
      const currentFilter: Record<string, unknown> = {
        kinds: [30078],
        authors: trustedPubkeys,
        limit: pageLimit,
      };
      if (until !== undefined) currentFilter.until = until;

      const page = await fetchPageFromRelay(relayUrl, currentFilter);
      if (page.length === 0) {
        break;
      }

      const currentBoundary = until ?? Number.POSITIVE_INFINITY;
      let nextUntil = currentBoundary;
      const currentPageIds = new Set<string>();

      for (const event of page) {
        if (previousPageIds.has(event.id)) {
          continue;
        }

        currentPageIds.add(event.id);

        if (
          event.created_at < currentBoundary &&
          event.created_at < nextUntil
        ) {
          nextUntil = event.created_at;
        }

        if (seenIds.has(event.id)) {
          continue;
        }
        seenIds.add(event.id);

        const coordinate = getCoordinateForEvent(event);
        if (!coordinate) continue;
        const existing = latestPerCoordinate.get(coordinate);
        if (isNewerTaxonomyEvent(event, existing)) {
          latestPerCoordinate.set(coordinate, event);
        }
      }

      if (currentPageIds.size === 0) {
        break;
      }

      previousPageIds = new Set(currentPageIds);

      if (!Number.isFinite(nextUntil)) {
        break;
      }

      until = nextUntil === currentBoundary ? currentBoundary - 1 : nextUntil;
    }
  }

  return Array.from(latestPerCoordinate.values());
}

function extractDTag(event: NostrEvent): string | undefined {
  return event.tags?.find((tag) => tag[0] === "d")?.[1];
}

export async function getServerTaxonomyDiagnostics(
  options?: ServerTaxonomyRegistryOptions
): Promise<{
  source: TaxonomyRegistry["source"];
  loadedEventCount: number;
  trustedPubkeys: string[];
  relayUrls: string[];
  fixturePath: string;
  rawRelayEventCount: number;
  rawRelayUniqueDCount: number;
  rawRelayUniqueDs: string[];
  acceptedNodeCount: number;
  acceptedNodeRefs: string[];
  missingFromRegistryDs: string[];
  missingRequiredRefsCount: number;
}> {
  const resolved = resolveOptions(options);
  const loadedRegistry = await getServerTaxonomyRegistry(options);
  let relayEvents: NostrEvent[] = [];
  try {
    relayEvents = await fetchTrustedTaxonomyEventsFromRelays(
      resolved.trustedPubkeys,
      resolved.relayUrls
    );
  } catch {
    relayEvents = [];
  }
  const registry =
    relayEvents.length > 0
      ? buildRegistry(relayEvents, { trustedPubkeys: resolved.trustedPubkeys })
      : createEmptyTaxonomyRegistry(resolved.trustedPubkeys);

  const rawRelayUniqueDs = [
    ...new Set(
      relayEvents
        .map(extractDTag)
        .filter((value): value is string => Boolean(value))
    ),
  ].sort();
  const acceptedNodeRefs = Object.keys(registry.nodeByRef).sort();
  const acceptedSet = new Set(acceptedNodeRefs);
  const missingFromRegistryDs = rawRelayUniqueDs.filter(
    (d) => !acceptedSet.has(d)
  );
  const missingRequiredRefsCount = loadedRegistry.warnings.filter((warning) =>
    warning.includes("references missing requiredRelations target")
  ).length;

  return {
    source: loadedRegistry.source,
    loadedEventCount: loadedRegistry.loadedEventCount,
    trustedPubkeys: resolved.trustedPubkeys,
    relayUrls: resolved.relayUrls,
    fixturePath: resolved.fixturePath,
    rawRelayEventCount: relayEvents.length,
    rawRelayUniqueDCount: rawRelayUniqueDs.length,
    rawRelayUniqueDs,
    acceptedNodeCount: acceptedNodeRefs.length,
    acceptedNodeRefs,
    missingFromRegistryDs,
    missingRequiredRefsCount,
  };
}

export async function getServerTaxonomyRegistry(
  options?: ServerTaxonomyRegistryOptions
): Promise<TaxonomyRegistry> {
  const resolved = resolveOptions(options);
  const cacheKey = JSON.stringify({
    trustedPubkeys: resolved.trustedPubkeys,
    relayUrls: resolved.relayUrls,
    fixturePath: resolved.fixturePath,
  });
  const cacheFilePath = getCacheFilePath(resolved.cacheDir, cacheKey);

  if (
    registryCache &&
    registryCache.cacheKey === cacheKey &&
    registryCache.expiresAt > Date.now()
  ) {
    return registryCache.registry;
  }

  const inFlight = inFlightRegistryLoads.get(cacheKey);
  if (inFlight) return inFlight;

  const loadPromise = loadServerTaxonomyRegistry(
    resolved,
    cacheKey,
    cacheFilePath
  );
  inFlightRegistryLoads.set(cacheKey, loadPromise);
  try {
    return await loadPromise;
  } finally {
    inFlightRegistryLoads.delete(cacheKey);
  }
}

async function loadServerTaxonomyRegistry(
  resolved: Required<ServerTaxonomyRegistryOptions>,
  cacheKey: string,
  cacheFilePath: string
): Promise<TaxonomyRegistry> {
  const cacheFileMtime = await getCacheFileMtime(cacheFilePath);
  if (cacheFileMtime && cacheFileMtime + resolved.cacheTtlMs > Date.now()) {
    const cachedEvents = await readCachedLatestEvents(cacheFilePath);
    const cachedRegistry =
      cachedEvents.length > 0
        ? buildRegistry(cachedEvents, {
            trustedPubkeys: resolved.trustedPubkeys,
          })
        : createEmptyTaxonomyRegistry(resolved.trustedPubkeys);
    cachedRegistry.source = cachedEvents.length > 0 ? "relay" : "empty";
    registryCache = {
      cacheKey,
      expiresAt: Date.now() + resolved.cacheTtlMs,
      registry: cachedRegistry,
    };
    return cachedRegistry;
  }

  let relayEvents: NostrEvent[] = [];
  try {
    relayEvents = await fetchTrustedTaxonomyEventsFromRelays(
      resolved.trustedPubkeys,
      resolved.relayUrls
    );
  } catch {
    relayEvents = [];
  }
  if (relayEvents.length > 0) {
    await writeCachedLatestEvents(cacheFilePath, relayEvents);
  }
  const fallbackCachedEvents =
    relayEvents.length === 0
      ? await readCachedLatestEventsIfAvailable(cacheFilePath)
      : [];
  const fixtureEvents =
    relayEvents.length === 0 && fallbackCachedEvents.length === 0
      ? await readFixtureEventsIfAvailable(resolved.fixturePath)
      : [];
  const source: TaxonomyRegistry["source"] =
    relayEvents.length > 0
      ? "relay"
      : fallbackCachedEvents.length > 0
        ? "relay"
        : fixtureEvents.length > 0
          ? "fixture"
          : "empty";
  const events =
    relayEvents.length > 0
      ? relayEvents
      : fallbackCachedEvents.length > 0
        ? fallbackCachedEvents
        : fixtureEvents;
  const registry =
    events.length > 0
      ? buildRegistry(events, {
          trustedPubkeys: source === "fixture" ? [] : resolved.trustedPubkeys,
        })
      : createEmptyTaxonomyRegistry(resolved.trustedPubkeys);
  if (source === "fixture") {
    registry.trustedPubkeys = resolved.trustedPubkeys;
  }
  registry.source = source;

  registryCache = {
    cacheKey,
    expiresAt: Date.now() + resolved.cacheTtlMs,
    registry,
  };

  return registry;
}

export function clearServerTaxonomyRegistryCache(): void {
  registryCache = null;
  inFlightRegistryLoads.clear();
}
