import { z } from "zod";

export const NormalizedHostSchema = z
	.string()
	.regex(/^[a-z0-9-]+(\.[a-z0-9-]+)*$/)
	.brand<"NormalizedHost">();
export type NormalizedHost = z.infer<typeof NormalizedHostSchema>;

export function normalizeHostname(hostname: string): NormalizedHost {
	return NormalizedHostSchema.parse(hostname.trim().toLowerCase().replace(/\.$/, ""));
}

export const ROUTING_POLICY_VERSION = "crawl-routing-2026-11-08";

export type CrawlRoute = "direct" | "paid-fetch" | "paid-browser";

export type HostRoutingPolicy = {
	host: NormalizedHost;
	source: "default" | "override";
	policyVersion: string;
	routeOrder: readonly CrawlRoute[];
	startSpacingMs: number;
	evidence: string;
	reviewBy: string;
};

type HostOverride = Omit<HostRoutingPolicy, "host" | "source">;

const DEFAULT_ROUTE_ORDER: readonly CrawlRoute[] = ["direct", "paid-fetch", "paid-browser"];

const DEFAULT_POLICY: HostOverride = {
	policyVersion: ROUTING_POLICY_VERSION,
	routeOrder: DEFAULT_ROUTE_ORDER,
	startSpacingMs: 2_000,
	evidence:
		"Plan 24 default: existing free direct transports first, two-second start spacing for every unlisted host",
	reviewBy: "2027-02-08",
};

export const TEN_SECOND_SPACING_HOSTS = [
	"links.em.marketingweek.com",
	"official-link.asos.com",
	"links.haymarket.mkt6316.com",
	"link.mail.cautiousoptimism.news",
	"click.mail.harvardonline.harvard.edu",
	"clicks.freetrade.io",
	"click.mlsend.com",
	"clicks.mozilla.org",
	"u34096378.ct.sendgrid.net",
	"links.timeshighereducationnewsletters.com",
	"click.artsy.net",
	"click.news.ivycollection.com",
	"click.songkick.com",
	"eulive.euromsg.net",
	"lb.passo.com.tr",
	"archive.ph",
	"habito-1096897964a3.intercom-clicks.com",
	"click.revolut.com",
	"mail.immersivegamebox.com",
	"data.email.philips-hue.com",
	"support.mindtools.com",
	"www.coindesk.com",
] as const;

const TEN_SECOND_OVERRIDE: HostOverride = {
	policyVersion: ROUTING_POLICY_VERSION,
	routeOrder: DEFAULT_ROUTE_ORDER,
	startSpacingMs: 10_000,
	evidence:
		"Plan 24: observed HTTP 429 responses from this host; a conservative starting value, not a measured publisher allowance",
	reviewBy: "2027-02-08",
};

const HOST_OVERRIDES: ReadonlyMap<string, HostOverride> = new Map(
	TEN_SECOND_SPACING_HOSTS.map((host) => [host, TEN_SECOND_OVERRIDE]),
);

export function routingPolicyFor(host: NormalizedHost): HostRoutingPolicy {
	const override = HOST_OVERRIDES.get(host);
	if (override) return { host, source: "override", ...override };
	return { host, source: "default", ...DEFAULT_POLICY };
}

type RateLimitedClassification = {
	kind: "rate-limited";
	stopsLadder: true;
	recordsCooldown: true;
	sameRouteRetry: false;
	paidPromotion: false;
	alternateEgress: false;
};

type PublisherRestrictionClassification = {
	kind: "publisher-restriction";
	stopsLadder: false;
	recordsCooldown: false;
	sameRouteRetry: false;
	paidPromotion: false;
	alternateEgress: true;
};

type TerminalRestrictionClassification = {
	kind: "terminal-restriction";
	stopsLadder: true;
	recordsCooldown: false;
	sameRouteRetry: false;
	paidPromotion: false;
	alternateEgress: false;
};

type AuthenticationClassification = {
	kind: "authentication";
	stopsLadder: true;
	recordsCooldown: false;
	sameRouteRetry: false;
	paidPromotion: false;
	alternateEgress: false;
};

type UnclassifiedClassification = { kind: "unclassified" };

export type ResponseClassification =
	| RateLimitedClassification
	| PublisherRestrictionClassification
	| TerminalRestrictionClassification
	| AuthenticationClassification
	| UnclassifiedClassification;

const RATE_LIMITED: ResponseClassification = {
	kind: "rate-limited",
	stopsLadder: true,
	recordsCooldown: true,
	sameRouteRetry: false,
	paidPromotion: false,
	alternateEgress: false,
};

const PUBLISHER_RESTRICTION: ResponseClassification = {
	kind: "publisher-restriction",
	stopsLadder: false,
	recordsCooldown: false,
	sameRouteRetry: false,
	paidPromotion: false,
	alternateEgress: true,
};

const TERMINAL_RESTRICTION: ResponseClassification = {
	kind: "terminal-restriction",
	stopsLadder: true,
	recordsCooldown: false,
	sameRouteRetry: false,
	paidPromotion: false,
	alternateEgress: false,
};

const AUTHENTICATION: ResponseClassification = {
	kind: "authentication",
	stopsLadder: true,
	recordsCooldown: false,
	sameRouteRetry: false,
	paidPromotion: false,
	alternateEgress: false,
};

const HOST_RESTRICTION_STATUSES: ReadonlyMap<
	string,
	{ statuses: readonly number[]; classification: ResponseClassification }
> = new Map([
	["www.linkedin.com", { statuses: [999, 403], classification: PUBLISHER_RESTRICTION }],
	["br.linkedin.com", { statuses: [999, 403], classification: PUBLISHER_RESTRICTION }],
	["archiveofourown.org", { statuses: [418], classification: PUBLISHER_RESTRICTION }],
	["4yrke.r.a.d.sendibm1.com", { statuses: [451], classification: TERMINAL_RESTRICTION }],
]);

export function classifyResponse(response: {
	host: NormalizedHost;
	status: number;
}): ResponseClassification {
	if (response.status === 429) return RATE_LIMITED;
	if (response.status === 401) return AUTHENTICATION;
	const restriction = HOST_RESTRICTION_STATUSES.get(response.host);
	if (restriction?.statuses.includes(response.status)) return restriction.classification;
	return { kind: "unclassified" };
}
