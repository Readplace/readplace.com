#!/usr/bin/env node
/**
 * Egress-proxy credential canary.
 *
 * `requireEnv` already fails a deploy whose CRAWL_EGRESS_PROXY_URL is missing,
 * but a URL that is present and no longer valid fails differently: the zone
 * answers 200 with an empty body when disabled, and 402 once its access policy
 * changes, so the crawler keeps running with a fallback that silently recovers
 * nothing. This asserts the credential end-to-end against the vendor's own echo
 * endpoint — no third-party origin, one request — so a dead credential fails
 * the deploy instead of a user's save weeks later.
 *
 * Required env:
 *   - CRAWL_EGRESS_PROXY_URL
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { ProxyAgent } from "undici";
import { requireEnv } from "@packages/require-env";

/** The vendor's own echo endpoint: it reports the egress the request actually
 * left from, so a 200 here proves the credential authenticated and traffic
 * reached the proxy network rather than merely reaching a listening socket. */
const ECHO_URL = "https://geo.brdtest.com/welcome.txt";
const TIMEOUT_MS = 30_000;

test("egress proxy credential answers through the proxy", async () => {
	const proxyUrl = requireEnv("CRAWL_EGRESS_PROXY_URL");
	/* The unlocker terminates TLS to rewrite the request, so it presents its own
	 * certificate — the same relaxation the proxied crawl legs make. */
	const dispatcher = new ProxyAgent({ uri: proxyUrl, requestTls: { rejectUnauthorized: false } });
	const response = await fetch(ECHO_URL, {
		dispatcher,
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	const body = await response.text();

	assert.equal(
		response.status,
		200,
		`egress proxy answered HTTP ${response.status} — credential rejected or zone disabled`,
	);
	assert.match(
		body,
		/Country:/,
		`egress proxy returned no geo echo (${body.length} bytes) — zone is reachable but not serving traffic`,
	);
});
