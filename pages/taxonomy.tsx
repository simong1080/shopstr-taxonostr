import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Button, Chip, Image, Input } from "@heroui/react";
import { SiteLanguageContext, TaxonomyContext } from "@/utils/context/context";
import {
  getTaxonomyNodeLabel,
  normalizeTaxonomyRef,
} from "@/utils/taxonomy/registry";
import {
  normalizeTaxonomySourceSettings,
  taxonomyApiPath,
  TaxonomySourceSettings,
  uniqueTrimmed,
} from "@/utils/taxonomy/source-settings";

type TaxonomyDiagnostics = {
  source: string;
  loadedEventCount: number;
  trustedPubkeys: string[];
  relayUrls: string[];
  fixturePath: string;
  rawRelayEventCount: number;
  acceptedNodeCount: number;
  missingRequiredRefsCount: number;
};

export default function TaxonomyInspectorPage() {
  const {
    registry,
    isLoading,
    error,
    reloadRegistry,
    sourceSettings,
    saveSourceSettings,
  } = useContext(TaxonomyContext);
  const { siteLanguage } = useContext(SiteLanguageContext);
  const [search, setSearch] = useState("");
  const [selectedRef, setSelectedRef] = useState<string>("");
  const [diagnostics, setDiagnostics] = useState<TaxonomyDiagnostics | null>(
    null
  );
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);
  const [draftPubkeys, setDraftPubkeys] = useState<string[]>([]);
  const [draftRelays, setDraftRelays] = useState<string[]>([]);
  const [newPubkey, setNewPubkey] = useState("");
  const [newRelay, setNewRelay] = useState("");

  const draftSourceSettings: TaxonomySourceSettings = useMemo(
    () =>
      normalizeTaxonomySourceSettings({
        trustedPubkeys: draftPubkeys,
        relayUrls: draftRelays,
      }),
    [draftPubkeys, draftRelays]
  );

  const loadDiagnostics = useCallback(
    async (refresh = false, sourceOverride?: TaxonomySourceSettings | null) => {
      try {
        setDiagnosticsError(null);
        const diagnosticSourceSettings =
          sourceOverride === undefined
            ? sourceSettings.isOverride
              ? sourceSettings
              : null
            : sourceOverride;
        const response = await fetch(
          taxonomyApiPath(
            "/api/taxonomy/debug",
            diagnosticSourceSettings,
            refresh ? { refresh: "1" } : {}
          )
        );
        if (!response.ok) {
          throw new Error(
            `Taxonomy diagnostics request failed with ${response.status}`
          );
        }
        setDiagnostics((await response.json()) as TaxonomyDiagnostics);
      } catch (diagnosticError) {
        setDiagnosticsError(
          diagnosticError instanceof Error
            ? diagnosticError.message
            : "Failed to load taxonomy diagnostics"
        );
      }
    },
    [sourceSettings]
  );

  useEffect(() => {
    loadDiagnostics().catch(() => {});
  }, [loadDiagnostics]);

  useEffect(() => {
    setDraftPubkeys(sourceSettings.trustedPubkeys);
    setDraftRelays(sourceSettings.relayUrls);
  }, [sourceSettings]);

  const addDraftPubkey = useCallback(() => {
    const nextPubkeys = uniqueTrimmed([...draftPubkeys, newPubkey]);
    setDraftPubkeys(nextPubkeys);
    setNewPubkey("");
  }, [draftPubkeys, newPubkey]);

  const addDraftRelay = useCallback(() => {
    const nextRelays = uniqueTrimmed([...draftRelays, newRelay]);
    setDraftRelays(nextRelays);
    setNewRelay("");
  }, [draftRelays, newRelay]);

  const filteredRefs = useMemo(() => {
    if (!registry) return [];
    const needle = search.trim().toLowerCase();
    const refs = Object.keys(registry.nodeByRef);
    return refs
      .filter((ref) => {
        if (!needle) return true;
        const node = registry.nodeByRef[ref];
        if (!node) return false;
        const label = getTaxonomyNodeLabel(
          registry,
          ref,
          siteLanguage
        ).toLowerCase();
        const description = Object.values(node.content.description || {})
          .join(" ")
          .toLowerCase();
        return (
          ref.toLowerCase().includes(needle) ||
          label.includes(needle) ||
          description.includes(needle)
        );
      })
      .sort((a, b) =>
        getTaxonomyNodeLabel(registry, a, siteLanguage).localeCompare(
          getTaxonomyNodeLabel(registry, b, siteLanguage),
          siteLanguage
        )
      )
      .slice(0, 250);
  }, [registry, search, siteLanguage]);

  const activeRef = selectedRef || filteredRefs[0] || "";
  const node = registry?.nodeByRef[activeRef];
  const reverseRefs = activeRef
    ? registry?.reverseRefsByRef[activeRef] || []
    : [];
  const imageUrl = activeRef
    ? registry?.imageByRef[normalizeTaxonomyRef(activeRef)]
    : undefined;

  return (
    <div className="bg-light-bg dark:bg-dark-bg min-h-screen px-4 pt-24 pb-10 md:px-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-light-text dark:text-dark-text text-3xl font-bold">
              Categories Inspector
            </h1>
            <p className="text-default-500 text-sm">
              Graph-first view of the trusted kind 30078 categories and related
              nodes currently loaded by Shopstr.
            </p>
          </div>
          <Button
            onClick={() => {
              reloadRegistry(true);
              loadDiagnostics(true).catch(() => {});
            }}
            isDisabled={isLoading}
          >
            Refresh registry
          </Button>
        </div>

        <div className="border-default-200/70 dark:border-default-700/70 rounded-2xl border bg-white/60 p-4 dark:bg-neutral-900/60">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-light-text dark:text-dark-text text-lg font-semibold">
                Taxonomy source
              </h2>
              <p className="text-default-500 text-sm">
                Read-only kind 30078 source settings. These do not affect
                Shopstr listing relays or kind 30402 marketplace data.
              </p>
            </div>
            <Chip
              size="sm"
              variant="flat"
              color={sourceSettings.isOverride ? "warning" : "default"}
            >
              {sourceSettings.isOverride
                ? "Browser override"
                : "Deployment default"}
            </Chip>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <div>
                <p className="text-light-text dark:text-dark-text mb-1 text-sm font-medium">
                  Trusted taxonomy pubkeys
                </p>
                <p className="text-default-500 text-xs">
                  Only kind 30078 events from these pubkeys are accepted.
                </p>
              </div>
              <div className="flex gap-2">
                <Input
                  value={newPubkey}
                  onChange={(event) => setNewPubkey(event.target.value)}
                  placeholder="hex pubkey"
                  size="sm"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") addDraftPubkey();
                  }}
                />
                <Button size="sm" variant="flat" onClick={addDraftPubkey}>
                  Add
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {draftSourceSettings.trustedPubkeys.map((pubkey) => (
                  <Chip
                    key={pubkey}
                    size="sm"
                    variant="bordered"
                    onClose={() =>
                      setDraftPubkeys((current) =>
                        current.filter((ref) => ref !== pubkey)
                      )
                    }
                  >
                    <span className="max-w-[16rem] truncate">{pubkey}</span>
                  </Chip>
                ))}
                {draftSourceSettings.trustedPubkeys.length === 0 && (
                  <span className="text-default-500 text-sm">
                    No local override pubkeys.
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <p className="text-light-text dark:text-dark-text mb-1 text-sm font-medium">
                  Taxonomy read relays
                </p>
                <p className="text-default-500 text-xs">
                  Used only for kind 30078 taxonomy registry reads.
                </p>
              </div>
              <div className="flex gap-2">
                <Input
                  value={newRelay}
                  onChange={(event) => setNewRelay(event.target.value)}
                  placeholder="wss://relay.example"
                  size="sm"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") addDraftRelay();
                  }}
                />
                <Button size="sm" variant="flat" onClick={addDraftRelay}>
                  Add
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {draftSourceSettings.relayUrls.map((relayUrl) => (
                  <Chip
                    key={relayUrl}
                    size="sm"
                    variant="bordered"
                    onClose={() =>
                      setDraftRelays((current) =>
                        current.filter((ref) => ref !== relayUrl)
                      )
                    }
                  >
                    <span className="max-w-[16rem] truncate">{relayUrl}</span>
                  </Chip>
                ))}
                {draftSourceSettings.relayUrls.length === 0 && (
                  <span className="text-default-500 text-sm">
                    No local override relays.
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={async () => {
                const nextSettings =
                  draftSourceSettings.trustedPubkeys.length === 0 &&
                  draftSourceSettings.relayUrls.length === 0
                    ? null
                    : draftSourceSettings;
                await saveSourceSettings(nextSettings);
                await loadDiagnostics(true, nextSettings);
              }}
              isDisabled={isLoading}
            >
              Save override and reload
            </Button>
            <Button
              size="sm"
              variant="flat"
              onClick={async () => {
                await saveSourceSettings(null);
                setDraftPubkeys([]);
                setDraftRelays([]);
                await loadDiagnostics(true, null);
              }}
              isDisabled={isLoading}
            >
              Reset to deployment defaults
            </Button>
            <Button
              size="sm"
              variant="flat"
              onClick={async () => {
                await reloadRegistry(true);
                await loadDiagnostics(true);
              }}
              isDisabled={isLoading}
            >
              Reload active registry
            </Button>
          </div>
        </div>

        {registry && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Chip variant="flat">
                Trusted pubkeys: {registry.trustedPubkeys.length}
              </Chip>
              <Chip variant="flat">
                Loaded events: {registry.loadedEventCount}
              </Chip>
              <Chip variant="flat">
                Unique nodes: {Object.keys(registry.nodeByRef).length}
              </Chip>
              <Chip variant="flat">Source: {registry.source}</Chip>
              <Chip variant="flat">Warnings: {registry.warnings.length}</Chip>
              <Chip variant="flat">Errors: {registry.errors.length}</Chip>
              <Chip variant="flat">
                Loaded: {new Date(registry.loadedAt).toLocaleString()}
              </Chip>
            </div>
            <div className="flex flex-wrap gap-2">
              {registry.trustedPubkeys.map((pubkey) => (
                <Chip key={pubkey} size="sm" variant="bordered">
                  {pubkey}
                </Chip>
              ))}
            </div>
          </div>
        )}

        <div className="border-default-200/70 dark:border-default-700/70 rounded-2xl border bg-white/60 p-4 dark:bg-neutral-900/60">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-light-text dark:text-dark-text text-lg font-semibold">
              Registry source
            </h2>
            <Button
              size="sm"
              variant="flat"
              onClick={() => loadDiagnostics(true)}
              isDisabled={isLoading}
            >
              Refresh diagnostics
            </Button>
          </div>
          {diagnostics ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <Chip size="sm" variant="flat">
                  Source: {diagnostics.source}
                </Chip>
                <Chip size="sm" variant="flat">
                  Loaded events: {diagnostics.loadedEventCount}
                </Chip>
                <Chip size="sm" variant="flat">
                  Relay events now: {diagnostics.rawRelayEventCount}
                </Chip>
                <Chip size="sm" variant="flat">
                  Accepted relay nodes: {diagnostics.acceptedNodeCount}
                </Chip>
                <Chip
                  size="sm"
                  color={
                    diagnostics.missingRequiredRefsCount > 0
                      ? "warning"
                      : "default"
                  }
                  variant="flat"
                >
                  Missing required refs: {diagnostics.missingRequiredRefsCount}
                </Chip>
              </div>
              <div className="text-default-500 grid gap-2 text-xs md:grid-cols-2">
                <div>
                  <p className="font-semibold tracking-wide uppercase">
                    Trusted pubkeys
                  </p>
                  <p className="break-all">
                    {diagnostics.trustedPubkeys.length > 0
                      ? diagnostics.trustedPubkeys.join(", ")
                      : "None configured"}
                  </p>
                </div>
                <div>
                  <p className="font-semibold tracking-wide uppercase">
                    Relay URLs
                  </p>
                  <p className="break-all">
                    {diagnostics.relayUrls.length > 0
                      ? diagnostics.relayUrls.join(", ")
                      : "None configured"}
                  </p>
                </div>
                <div className="md:col-span-2">
                  <p className="font-semibold tracking-wide uppercase">
                    Fixture path
                  </p>
                  <p className="break-all">{diagnostics.fixturePath}</p>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-default-500 text-sm">
              {diagnosticsError || "Loading registry diagnostics..."}
            </p>
          )}
        </div>

        {error && (
          <div className="rounded-lg border border-red-300 p-3 text-red-600">
            {error}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(280px,380px)_1fr]">
          <div className="border-default-200/70 dark:border-default-700/70 space-y-4 rounded-2xl border bg-white/60 p-4 dark:bg-neutral-900/60">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              label="Search categories"
              labelPlacement="outside"
              placeholder="Search by ref, label, or description"
            />
            <div className="max-h-[65vh] space-y-1 overflow-auto pr-1">
              {filteredRefs.map((ref) => {
                const current = registry!.nodeByRef[ref];
                if (!current) return null;
                return (
                  <button
                    key={ref}
                    className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                      activeRef === ref
                        ? "border-purple-500 bg-purple-50 dark:border-yellow-500 dark:bg-yellow-500/10"
                        : "border-default-200/70 dark:border-default-700/70 hover:border-purple-300 dark:hover:border-yellow-500/50"
                    }`}
                    onClick={() => setSelectedRef(ref)}
                  >
                    <div className="text-light-text dark:text-dark-text text-sm font-semibold">
                      {getTaxonomyNodeLabel(registry!, ref, siteLanguage)}
                    </div>
                    <div className="text-default-500 text-xs">{ref}</div>
                    <div className="text-default-400 mt-1 text-[11px] tracking-wide uppercase">
                      {current.family}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-default-200/70 dark:border-default-700/70 space-y-4 rounded-2xl border bg-white/60 p-4 dark:bg-neutral-900/60">
            {!node ? (
              <p className="text-default-500">No category node selected.</p>
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-2">
                    <div className="text-default-400 text-sm tracking-wide uppercase">
                      {node.family}
                    </div>
                    <h2 className="text-light-text dark:text-dark-text text-2xl font-bold">
                      {getTaxonomyNodeLabel(registry!, node.d, siteLanguage)}
                    </h2>
                    <div className="text-default-500 text-sm">{node.d}</div>
                    <div className="flex flex-wrap gap-2">
                      <Chip size="sm" variant="flat">
                        Parents: {node.content.parents?.length || 0}
                      </Chip>
                      <Chip size="sm" variant="flat">
                        Relations: {node.content.relations?.length || 0}
                      </Chip>
                      <Chip size="sm" variant="flat">
                        Reverse refs: {reverseRefs.length}
                      </Chip>
                    </div>
                  </div>
                  {imageUrl && (
                    <Image
                      src={imageUrl}
                      alt={getTaxonomyNodeLabel(
                        registry!,
                        node.d,
                        siteLanguage
                      )}
                      width={80}
                      height={80}
                      className="rounded-xl object-cover"
                    />
                  )}
                </div>

                {node.content.description && (
                  <div>
                    <h3 className="text-default-400 mb-2 text-sm font-semibold tracking-wide uppercase">
                      Description
                    </h3>
                    <p className="text-light-text dark:text-dark-text text-sm whitespace-pre-wrap">
                      {node.content.description[siteLanguage] ||
                        node.content.description.en ||
                        Object.values(node.content.description)[0]}
                    </p>
                  </div>
                )}

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <h3 className="text-default-400 mb-2 text-sm font-semibold tracking-wide uppercase">
                      Parents
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {(node.content.parents || []).map((ref) => (
                        <Chip key={ref} size="sm" variant="flat">
                          {getTaxonomyNodeLabel(registry!, ref, siteLanguage)}
                        </Chip>
                      ))}
                      {(node.content.parents || []).length === 0 && (
                        <span className="text-default-500 text-sm">None</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <h3 className="text-default-400 mb-2 text-sm font-semibold tracking-wide uppercase">
                      Children
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {(registry?.childrenByRef[node.d] || []).map((ref) => (
                        <Chip key={ref} size="sm" variant="flat">
                          {getTaxonomyNodeLabel(registry!, ref, siteLanguage)}
                        </Chip>
                      ))}
                      {(registry?.childrenByRef[node.d] || []).length === 0 && (
                        <span className="text-default-500 text-sm">None</span>
                      )}
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-default-400 mb-2 text-sm font-semibold tracking-wide uppercase">
                    Relations
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {(node.content.relations || []).map((ref) => (
                      <Chip key={ref} size="sm" variant="bordered">
                        {getTaxonomyNodeLabel(registry!, ref, siteLanguage)}
                      </Chip>
                    ))}
                    {(node.content.relations || []).length === 0 && (
                      <span className="text-default-500 text-sm">None</span>
                    )}
                  </div>
                </div>

                <div>
                  <h3 className="text-default-400 mb-2 text-sm font-semibold tracking-wide uppercase">
                    Required relations
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {(node.content.requiredRelations || []).map((ref) => (
                      <Chip
                        key={ref}
                        size="sm"
                        color="warning"
                        variant="bordered"
                      >
                        {getTaxonomyNodeLabel(registry!, ref, siteLanguage)}
                      </Chip>
                    ))}
                    {(node.content.requiredRelations || []).length === 0 && (
                      <span className="text-default-500 text-sm">None</span>
                    )}
                  </div>
                </div>

                <div>
                  <h3 className="text-default-400 mb-2 text-sm font-semibold tracking-wide uppercase">
                    Reverse refs
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {reverseRefs.map((reverse) => (
                      <Chip
                        key={`${reverse.sourceRef}:${reverse.field}`}
                        size="sm"
                        variant="bordered"
                      >
                        {reverse.field}:{" "}
                        {getTaxonomyNodeLabel(
                          registry!,
                          reverse.sourceRef,
                          siteLanguage
                        )}
                      </Chip>
                    ))}
                    {reverseRefs.length === 0 && (
                      <span className="text-default-500 text-sm">None</span>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {registry &&
          (registry.warnings.length > 0 || registry.errors.length > 0) && (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-amber-300/70 bg-amber-50/70 p-4 dark:border-amber-500/40 dark:bg-amber-500/10">
                <h3 className="mb-2 text-lg font-semibold text-amber-700 dark:text-amber-300">
                  Warnings
                </h3>
                <ul className="list-disc space-y-1 pl-5 text-sm text-amber-800 dark:text-amber-200">
                  {registry.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
              <div className="rounded-2xl border border-red-300/70 bg-red-50/70 p-4 dark:border-red-500/40 dark:bg-red-500/10">
                <h3 className="mb-2 text-lg font-semibold text-red-700 dark:text-red-300">
                  Errors
                </h3>
                <ul className="list-disc space-y-1 pl-5 text-sm text-red-800 dark:text-red-200">
                  {registry.errors.length > 0 ? (
                    registry.errors.map((entry) => <li key={entry}>{entry}</li>)
                  ) : (
                    <li>None</li>
                  )}
                </ul>
              </div>
            </div>
          )}
      </div>
    </div>
  );
}
