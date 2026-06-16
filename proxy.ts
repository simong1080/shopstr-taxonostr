import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { nip19 } from "nostr-tools";

const SHOPSTR_DOMAINS = ["shopstr.market", "shopstr.store"];
const PLATFORM_DOMAIN_SUFFIXES = [
  ".repl.co",
  ".replit.dev",
  ".replit.app",
  ".vercel.app",
];

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().split(":")[0] || "";
}

function getShopstrBaseDomain(hostname: string): string | null {
  for (const domain of SHOPSTR_DOMAINS) {
    if (hostname.includes(domain)) return domain;
  }
  return null;
}

function isPlatformDomain(hostname: string): boolean {
  const normalizedHostname = normalizeHostname(hostname);
  return (
    normalizedHostname === "localhost" ||
    normalizedHostname === "127.0.0.1" ||
    normalizedHostname.includes("replit") ||
    PLATFORM_DOMAIN_SUFFIXES.some((suffix) =>
      normalizedHostname.endsWith(suffix)
    )
  );
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hostname = normalizeHostname(request.headers.get("host") || "");

  if (pathname === "/.well-known/agent.json") {
    return NextResponse.rewrite(
      new URL("/api/.well-known/agent.json", request.url)
    );
  }

  const baseDomain = getShopstrBaseDomain(hostname);

  if (baseDomain) {
    if (hostname === `www.${baseDomain}`) {
      const url = new URL(request.url);
      url.hostname = baseDomain;
      return NextResponse.redirect(url, 301);
    }

    if (hostname !== baseDomain && hostname.endsWith(`.${baseDomain}`)) {
      const subdomain = hostname.replace(`.${baseDomain}`, "");
      if (subdomain !== "www" && subdomain !== "api") {
        const url = new URL(
          `/shop/${subdomain}${pathname === "/" ? "" : pathname}`,
          request.url
        );
        url.hostname = baseDomain;
        return NextResponse.rewrite(url);
      }
    }
  }

  if (hostname && !baseDomain && !isPlatformDomain(hostname)) {
    if (pathname.startsWith("/_next/")) {
      return NextResponse.next();
    }

    if (pathname.startsWith("/api/")) {
      const allowedApiPrefixes = [
        "/api/storefront/",
        "/api/db/fetch-products",
        "/api/db/fetch-profiles",
        "/api/db/fetch-reviews",
        "/api/db/fetch-communities",
        "/api/nostr/",
        "/api/lightning/",
        "/api/cashu/",
        "/api/stripe/checkout",
      ];
      const isAllowed = allowedApiPrefixes.some((prefix) =>
        pathname.startsWith(prefix)
      );
      if (!isAllowed) {
        return NextResponse.json(
          { error: "Not available on this domain" },
          { status: 403 }
        );
      }
      return NextResponse.next();
    }

    return NextResponse.rewrite(
      new URL(
        `/shop/_custom-domain?domain=${encodeURIComponent(
          hostname
        )}&path=${encodeURIComponent(pathname)}`,
        request.url
      )
    );
  }

  if (
    pathname.match(/^\/npub[a-zA-Z0-9]+$/) &&
    !pathname.startsWith("/marketplace/")
  ) {
    const url = new URL(`/marketplace${pathname}`, request.url);
    return NextResponse.redirect(url);
  }

  if (
    pathname.match(/^\/naddr[a-zA-Z0-9]+$/) &&
    !pathname.startsWith("/listing/")
  ) {
    const url = new URL(`/listing${pathname}`, request.url);
    return NextResponse.redirect(url);
  }

  if (pathname.startsWith("/naddr") && !pathname.startsWith("/communities/")) {
    try {
      const decoded = nip19.decode(pathname.substring(1));
      if (decoded.type === "naddr" && decoded.data.kind === 34550) {
        return NextResponse.redirect(
          new URL(`/communities${pathname}`, request.url)
        );
      }
    } catch {
      /* ignore */
    }
  }

  return NextResponse.next();
}
