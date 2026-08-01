import assert from "node:assert/strict";
import test from "node:test";
import { noopLogger } from "@packages/hutch-logger";
import { initOAuthAuth } from "../auth/oauth-auth";
import type { OAuthTokens } from "../auth/oauth-tokens";
import { initSirenReadingList } from "../reading-list/siren-reading-list";
import { SAVE_LATENCY_BUDGET_MS, summarizeLatency } from "./latency-report";
import { initVirtualNetwork } from "./virtual-network";

const SIMULATED_BUDGET_MS = SAVE_LATENCY_BUDGET_MS.simulated;
const SIMULATED_ROUND_TRIP_MS = 100;
const SAMPLES_PER_SCENARIO = 3;
const SERVER_URL = "http://localhost:3000";
const SIREN_MEDIA_TYPE = "application/vnd.siren+json";
const ENTRY_POINT_CALL = `GET ${SERVER_URL}/`;
const COLLECTION_CALL = `GET ${SERVER_URL}/queue`;
const SAVE_CALL = `POST ${SERVER_URL}/queue`;
const TOKEN_CALL = `POST ${SERVER_URL}/oauth/token`;
const SAVED_URL = "https://example.com/perf-sample";

type PerfRoute = {
	status: number;
	body?: string;
	headers?: Record<string, string>;
};

type PerfRouteHandler = PerfRoute | ((init: RequestInit) => PerfRoute);

type SaveLatencyScenario = {
	name: string;
	expectedCalls: string[];
	measure: () => Promise<{ virtualMs: number; calls: string[] }>;
};

function initRecordingFetch(routes: Record<string, PerfRouteHandler>): {
	fetchFn: typeof fetch;
	calls: string[];
} {
	const calls: string[] = [];
	const fetchFn: typeof fetch = async (input, init) => {
		assert(typeof input === "string", "the save path only fetches string urls");
		assert(init?.method, `the save path states a method on every request to ${input}`);
		const call = `${init.method} ${input}`;
		calls.push(call);
		const handler = routes[call];
		assert(handler, `no simulated route answers ${call}`);
		const route = typeof handler === "function" ? handler(init) : handler;
		const headers: Record<string, string> = {
			...(route.body === undefined ? {} : { "Content-Type": SIREN_MEDIA_TYPE }),
			...route.headers,
		};
		return new Response(route.body ?? null, { status: route.status, headers });
	};
	return { fetchFn, calls };
}

function queueCollectionBody(): string {
	return JSON.stringify({
		class: ["collection", "articles"],
		entities: [],
		links: [{ rel: ["self"], href: "/queue" }],
		actions: [
			{
				name: "save-article",
				href: "/queue",
				method: "POST",
				type: "application/json",
				fields: [{ name: "url", type: "url" }],
			},
		],
	});
}

function savedArticleBody(): string {
	return JSON.stringify({
		class: ["article"],
		rel: ["item"],
		properties: {
			id: "perf-sample",
			url: SAVED_URL,
			title: "Perf sample",
			savedAt: "2026-01-15T10:00:00.000Z",
		},
		links: [{ rel: ["read"], href: "/queue/perf-sample/view" }],
		actions: [
			{
				name: "update-status",
				href: "/queue/perf-sample/status",
				method: "POST",
			},
		],
	});
}

function tokenGrantBody(): string {
	return JSON.stringify({
		access_token: "perf-access-token",
		refresh_token: "perf-refresh-token",
	});
}

const QUEUE_ETAG = '"queue-v1"';

function entryPointRoute(): PerfRoute {
	return {
		status: 200,
		body: queueCollectionBody(),
		headers: { etag: QUEUE_ETAG },
	};
}

function saveRoute(): PerfRoute {
	return { status: 201, body: savedArticleBody() };
}

function initReadingList(input: {
	fetchFn: typeof fetch;
	getAccessToken: () => Promise<string | null>;
}) {
	return initSirenReadingList({
		serverUrl: SERVER_URL,
		getAccessToken: input.getAccessToken,
		fetchFn: input.fetchFn,
		onUnauthorized: async () => {},
		refreshTokens: async () => ({ ok: true }),
		logger: noopLogger,
	});
}

function warmSave(): SaveLatencyScenario {
	return {
		name: "a warm save",
		expectedCalls: [ENTRY_POINT_CALL, SAVE_CALL],
		measure: async () => {
			const network = initVirtualNetwork({ roundTripMs: SIMULATED_ROUND_TRIP_MS });
			const { fetchFn, calls } = initRecordingFetch({
				[ENTRY_POINT_CALL]: entryPointRoute(),
				[SAVE_CALL]: saveRoute(),
			});
			const readingList = initReadingList({
				fetchFn: network.chargeRoundTrips(fetchFn),
				getAccessToken: async () => "perf-access-token",
			});

			const saved = await readingList.saveUrl({
				url: SAVED_URL,
				title: "Perf sample",
			});

			assert(saved.ok, "the measured save must succeed");
			return { virtualMs: network.elapsedMs(), calls };
		},
	};
}

function coldBootSave(): SaveLatencyScenario {
	return {
		name: "a save on a cold background boot",
		expectedCalls: [TOKEN_CALL, ENTRY_POINT_CALL, SAVE_CALL],
		measure: async () => {
			const network = initVirtualNetwork({ roundTripMs: SIMULATED_ROUND_TRIP_MS });
			const { fetchFn, calls } = initRecordingFetch({
				[TOKEN_CALL]: { status: 200, body: tokenGrantBody() },
				[ENTRY_POINT_CALL]: entryPointRoute(),
				[SAVE_CALL]: saveRoute(),
			});
			const chargedFetch = network.chargeRoundTrips(fetchFn);
			let stored: OAuthTokens | null = {
				accessToken: "stale-access-token",
				refreshToken: "perf-refresh-token",
			};
			const auth = await initOAuthAuth({
				serverUrl: SERVER_URL,
				clientId: "hutch-chrome-extension",
				openTab: async () => assert.fail("a save never opens an auth tab"),
				waitForRedirect: async () =>
					assert.fail("a save never waits on an auth redirect"),
				closeTab: async () => assert.fail("a save never closes an auth tab"),
				fetchFn: (...args) => chargedFetch(...args),
				tokenStorage: {
					getTokens: async () => stored,
					setTokens: async (tokens) => {
						stored = tokens;
					},
					clearTokens: async () => {
						stored = null;
					},
				},
				logger: noopLogger,
			});
			const readingList = initReadingList({
				fetchFn: chargedFetch,
				getAccessToken: auth.getAccessToken,
			});

			const guarded = auth.whenLoggedIn(() =>
				readingList.saveUrl({ url: SAVED_URL, title: "Perf sample" }),
			);
			assert(guarded.ok, "a stored refresh token must leave the client logged in");
			const saved = await guarded.value;

			assert(saved.ok, "the measured save must succeed");
			return { virtualMs: network.elapsedMs(), calls };
		},
	};
}

function repeatSave(): SaveLatencyScenario {
	return {
		name: "a repeat save revalidating the entry point",
		expectedCalls: [ENTRY_POINT_CALL, SAVE_CALL, COLLECTION_CALL, SAVE_CALL],
		measure: async () => {
			const network = initVirtualNetwork({ roundTripMs: SIMULATED_ROUND_TRIP_MS });
			const { fetchFn, calls } = initRecordingFetch({
				[ENTRY_POINT_CALL]: entryPointRoute(),
				[COLLECTION_CALL]: (init) => {
					assert.equal(
						new Headers(init.headers).get("If-None-Match"),
						QUEUE_ETAG,
						"a repeat walk must revalidate the entry point it already holds",
					);
					return { status: 304 };
				},
				[SAVE_CALL]: saveRoute(),
			});
			const readingList = initReadingList({
				fetchFn: network.chargeRoundTrips(fetchFn),
				getAccessToken: async () => "perf-access-token",
			});

			const first = await readingList.saveUrl({
				url: SAVED_URL,
				title: "Perf sample",
			});
			assert(first.ok, "the warming save must succeed");
			const warmedMs = network.elapsedMs();

			const second = await readingList.saveUrl({
				url: SAVED_URL,
				title: "Perf sample",
			});
			assert(second.ok, "the measured save must succeed");

			return { virtualMs: network.elapsedMs() - warmedMs, calls };
		},
	};
}

const SCENARIOS = [warmSave(), coldBootSave(), repeatSave()];
const scenarioMeansMs: number[] = [];

for (const scenario of SCENARIOS) {
	test(`${scenario.name} stays under the ${SIMULATED_BUDGET_MS}ms simulated-network budget`, async (t) => {
		const runs: { virtualMs: number; calls: string[] }[] = [];
		for (let sample = 0; sample < SAMPLES_PER_SCENARIO; sample += 1) {
			runs.push(await scenario.measure());
		}

		for (const run of runs) {
			assert.deepEqual(run.calls, scenario.expectedCalls);
		}

		const samplesMs = runs.map((run) => run.virtualMs);
		assert.equal(
			new Set(samplesMs).size,
			1,
			`a simulated save must cost the same every time, got ${samplesMs.join(", ")}`,
		);

		const summary = summarizeLatency(samplesMs);
		t.diagnostic(
			`${scenario.name}: ${summary.meanMs}ms over ${summary.meanMs / SIMULATED_ROUND_TRIP_MS} round trips`,
		);
		assert.ok(
			summary.meanMs < SIMULATED_BUDGET_MS,
			`${scenario.name} costs ${summary.meanMs}ms, over the ${SIMULATED_BUDGET_MS}ms budget`,
		);
		scenarioMeansMs.push(summary.meanMs);
	});
}

test(`the mean save stays under the ${SIMULATED_BUDGET_MS}ms simulated-network budget`, (t) => {
	assert.equal(
		scenarioMeansMs.length,
		SCENARIOS.length,
		"every scenario must report a mean before the overall budget is judged",
	);

	const summary = summarizeLatency(scenarioMeansMs);
	t.diagnostic(
		`mean ${summary.meanMs}ms, p95 ${summary.p95Ms}ms, slowest ${summary.maxMs}ms across ${summary.count} scenarios`,
	);
	assert.ok(
		summary.meanMs < SIMULATED_BUDGET_MS,
		`the mean save costs ${summary.meanMs}ms, over the ${SIMULATED_BUDGET_MS}ms budget`,
	);
});
