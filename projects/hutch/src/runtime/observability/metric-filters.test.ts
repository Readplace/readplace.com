import { SUPPORTED_CLIENTS, isBuiltInOAuthClientId } from "@packages/supported-clients";
import { ANALYTICS_EVENTS, CONVERSION_EVENTS, METRICS, STREAMS } from "./events";
import {
	ANALYTICS_METRIC_FILTERS,
	ANALYTICS_METRIC_NAMESPACE,
	analyticsMetricFilterPattern,
	firstPartyRefreshRefusedExceptDisconnectLogoutAllAndNonceRequiredPattern,
} from "./metric-filters";

describe("analytics metric filters", () => {
	it("selects a forwarded line by stream and event with a JSON selector, the shape aws logs test-metric-filter matched against a real /readplace/analytics line — the destination group carries the bare payload, so $.field resolves there", () => {
		expect(analyticsMetricFilterPattern(ANALYTICS_METRIC_FILTERS.viewSaveIntent)).toBe(
			`{ $.stream = "${STREAMS.analytics}" && $.event = "${ANALYTICS_EVENTS.viewSaveIntent}" }`,
		);
	});

	it("meters the events an investigation wants beyond the log group's floor, pinned rather than merely typed: dropping one silently ends that event's 15-month history", () => {
		const events = Object.values(ANALYTICS_METRIC_FILTERS).map((filter) => filter.event);
		expect(events.sort()).toEqual(
			[
				ANALYTICS_EVENTS.pageview,
				ANALYTICS_EVENTS.viewSaveIntent,
				CONVERSION_EVENTS.userCreated,
			].sort(),
		);
	});

	it("names only declared streams, so a hand-edited raw string cannot reach a deployed filter and match nothing", () => {
		const declared = new Set<string>(Object.values(STREAMS));
		for (const filter of Object.values(ANALYTICS_METRIC_FILTERS)) {
			expect(declared.has(filter.stream)).toBe(true);
		}
	});

	it("gives every event its own metric name, since a duplicate would merge two events into one series that no later reader could unmix", () => {
		const names = Object.values(ANALYTICS_METRIC_FILTERS).map((filter) => filter.metricName);
		expect(new Set(names).size).toBe(names.length);
	});

	it("publishes into a namespace of its own rather than the imports namespace, so the existing lifetime import series stays a single-purpose metric", () => {
		expect(ANALYTICS_METRIC_NAMESPACE).toBe("Readplace/Analytics");
		expect(ANALYTICS_METRIC_NAMESPACE).not.toBe(METRICS.importsCompleted.namespace);
	});

	it("dates every counter and says on its face that it includes internal traffic: the exclusion list is expressible as a metric-filter pattern and is left off by choice, and a series whose first datapoint is the day its filter was created is not a lifetime", () => {
		for (const filter of Object.values(ANALYTICS_METRIC_FILTERS)) {
			expect(filter.widgetTitle).toMatch(
				/ \(CloudWatch metric since \d{4}-\d{2}-\d{2}, internal traffic included\)$/,
			);
		}
	});

	it("emits no dimensions, so a filter cannot start billing one custom metric per distinct path or host", () => {
		const fields = new Set(Object.values(ANALYTICS_METRIC_FILTERS).flatMap(Object.keys));
		expect([...fields].sort()).toEqual(["event", "metricName", "stream", "widgetTitle"]);
	});
});

describe("first-party refresh-refused metric filter", () => {
	it("counts a refused refresh only when the grant names one of our own shipped clients, the reader neither disconnected it nor changed or reset their password, and the request was not the nonce challenge that opens a DPoP-bound refresh; the string aws logs test-metric-filter matched a real production chrome-extension rotation refusal and the nonce_expired, proof_invalid and unknown variants of a real nonce challenge against, and refused the real nonce_required challenge both bare and behind its Lambda preamble, its ios-app variant, and the disconnect and logout-all variants", () => {
		expect(firstPartyRefreshRefusedExceptDisconnectLogoutAllAndNonceRequiredPattern()).toBe(
			'{ $.stream = "analytics" && $.event = "oauth_token_refused" && $.grant_type = "refresh_token" && ($.client_id = "hutch-firefox-extension" || $.client_id = "hutch-chrome-extension" || $.client_id = "ios-app" || $.client_id = "android-app") && $.refresh_refusal.reason != "disconnect" && $.refresh_refusal.reason != "logout-all" && $.refresh_refusal.reason != "nonce_required" }',
		);
	});

	it("leaves out nonce_required but keeps nonce_expired: every DPoP-bound refresh opens with a request the token endpoint answers 400 use_dpop_nonce before it looks at the credential and the client retries with the nonce at once, so each of the first 20 challenges logged after the 2026-10-16 release was followed by a successful refresh within 0.6 s and the fifth of them tripped the alarm, whereas an expired nonce means the retry itself failed", () => {
		const excluded = [...firstPartyRefreshRefusedExceptDisconnectLogoutAllAndNonceRequiredPattern().matchAll(/\$\.refresh_refusal\.reason != "([^"]+)"/g)].map(
			(match) => match[1],
		);
		expect(excluded).toEqual(["disconnect", "logout-all", "nonce_required"]);
	});

	it("allows exactly the shipped roster in registry order, so a client added to the roster joins the paging metric and no other id can", () => {
		const allowed = [...firstPartyRefreshRefusedExceptDisconnectLogoutAllAndNonceRequiredPattern().matchAll(/\$\.client_id = "([^"]+)"/g)].map(
			(match) => match[1],
		);
		expect(allowed).toEqual(
			SUPPORTED_CLIENTS.flatMap((client) =>
				client.auth.kind === "builtIn" ? [client.auth.oauthClientId] : [],
			),
		);
		for (const clientId of allowed) {
			expect(isBuiltInOAuthClientId(clientId)).toBe(true);
		}
	});

	it("leaves out the placeholder a grant without a client_id logs, so a caller can neither page us nor dodge the metric by omitting the field", () => {
		expect(firstPartyRefreshRefusedExceptDisconnectLogoutAllAndNonceRequiredPattern()).not.toContain('"missing"');
	});

	it("publishes the narrowed count as a series apart from the unnarrowed refused counts", () => {
		expect(METRICS.oauthRefreshRefusedFirstPartyExceptDisconnect).toEqual({
			namespace: "Readplace/OAuth",
			name: "OAuthRefreshRefusedFirstPartyExceptDisconnect",
		});
		expect(["OAuthRefreshRefused", "OAuthRefreshRefusedFirstParty"]).not.toContain(
			METRICS.oauthRefreshRefusedFirstPartyExceptDisconnect.name,
		);
	});
});
