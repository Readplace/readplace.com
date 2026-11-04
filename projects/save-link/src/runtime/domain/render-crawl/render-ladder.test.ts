import assert from "node:assert/strict";
import type {
	RenderOutcome,
	RenderPage,
	ResidentialEgress,
	WebUnlockerEgress,
} from "../../providers/render-page/render-page.types";
import {
	type Escalation,
	type LadderRender,
	type ProxiedFetchAttempt,
	type RenderCommit,
	type RenderedThrough,
	type RenderLadderLegs,
	runRenderLadder,
} from "./render-ladder";

const URL = "https://example-spa.test/post";
const ENOUGH_TIME = 10_000_000;
const RESIDENTIAL_THRESHOLD = 30_000 + 25_000 + 30_000;
const FETCH_THRESHOLD = 100_000 + 180_000 + 30_000;
const WEB_UNLOCKER_RENDER_THRESHOLD = 90_000 + 25_000 + 30_000;
const webUnlockerEgress: WebUnlockerEgress = {
	kind: "web-unlocker",
	proxy: {
		server: "http://unlocker.example.test:33335",
		username: "unlocker-user",
		password: "unlocker-secret",
	},
};
const requests = {
	proxiedRequestLimit: 40,
	continued: 1,
	continuedProxied: 0,
	continuedDirect: 1,
	continuedNavigations: 1,
	abortedByBudget: 0,
	abortedByType: 0,
	abortedBy: { type: 0, address: 0, budget: 0 },
	continuedByResourceType: { document: 1 },
};
const resourceHosts = { initialSite: "example-spa.test", finalSite: "example-spa.test", buckets: [], overflowedRequests: 0 };
const renderedBody: RenderOutcome = {
	kind: "rendered",
	html: "<p>Body</p>",
	finalUrl: URL,
	httpStatus: 200,
	requests,
	resourceHosts,
};
const blockedRender: RenderOutcome = {
	kind: "blocked",
	httpStatus: 403,
	requests,
	resourceHosts,
};
const failedRender: RenderOutcome = {
	kind: "failed",
	detail: "navigation timeout",
	requests,
	resourceHosts,
};
const residentialFailure: RenderOutcome = {
	kind: "failed",
	detail: "residential timeout",
	requests,
	resourceHosts,
};
const unlockerFailure: RenderOutcome = {
	kind: "failed",
	detail: "unlocker timeout",
	requests,
	resourceHosts,
};
const noBodyFetch: ProxiedFetchAttempt = {
	kind: "no-body",
	outcome: "blocked",
};

function ladderWith(script: {
	direct: RenderOutcome;
	residential?: RenderOutcome;
	webUnlockerRender?: RenderOutcome;
	commits?: Partial<Record<RenderedThrough, RenderCommit>>;
	webUnlockerFetch?: ProxiedFetchAttempt;
	budgetAllowed?: boolean;
	unsupportedReason?: "javascript-required" | "blocked";
	remaining?: number[];
}) {
	const steps: string[] = [];
	const renderedEgresses: Parameters<RenderPage>[0]["egress"][] = [];
	const remaining = [...(script.remaining ?? [])];
	let residentialSessions = 0;
	const legFor = (egress: Parameters<RenderPage>[0]["egress"]) => {
		if (egress.kind === "direct") return script.direct;
		if (egress.kind === "residential") return script.residential;
		return script.webUnlockerRender;
	};
	const renderPage: RenderPage = async (params) => {
		assert.equal(params.url, URL);
		steps.push(
			`render ${params.egress.kind} ${params.navigationTimeoutMilliseconds}`,
		);
		renderedEgresses.push(params.egress);
		const outcome = legFor(params.egress);
		assert(outcome, `the ${params.egress.kind} render was not expected to run`);
		return outcome;
	};
	const legs: RenderLadderLegs = {
		renderPage,
		url: URL,
		residentialEgress: (): ResidentialEgress => {
			residentialSessions += 1;
			steps.push(`mint residential session-${residentialSessions}`);
			return {
				kind: "residential",
				proxy: {
					server: "http://residential.example.test:22225",
					username: `zone-user-session-${residentialSessions}`,
					password: "zone-secret",
				},
			};
		},
		webUnlockerEgress,
		unsupportedReason: script.unsupportedReason ?? "javascript-required",
		commitRender: async (render: LadderRender, escalation: Escalation) => {
			steps.push(`commit ${render.renderedThrough} ${escalation}`);
			const commit = script.commits?.[render.renderedThrough];
			assert(
				commit,
				`the ${render.renderedThrough} commit was not expected to run`,
			);
			return commit;
		},
		fetchThroughWebUnlocker: async () => {
			steps.push("web unlocker fetch");
			assert(
				script.webUnlockerFetch,
				"the web unlocker fetch was not expected to run",
			);
			return script.webUnlockerFetch;
		},
		consumeBudget: async () => {
			steps.push("budget");
			return { allowed: script.budgetAllowed ?? true };
		},
		remainingMilliseconds: () => {
			const next = remaining.shift() ?? ENOUGH_TIME;
			steps.push(`time ${next}`);
			return next;
		},
	};
	return { run: () => runRenderLadder(legs), steps, renderedEgresses };
}

describe("runRenderLadder", () => {
	const SKIPPED_FOR_BLOCK_EVIDENCE = {
		kind: "skipped",
		reason: "block-evidence",
	} as const;

	it("settles through the direct render with no budget, no clock read and no paid leg", async () => {
		const { run, steps } = ladderWith({
			direct: renderedBody,
			commits: { "direct-egress": { kind: "settled" } },
		});

		const result = await run();

		assert.deepEqual(result, {
			kind: "settled",
			settledThrough: "direct-egress",
			residentialSkipped: false,
		});
		assert.deepEqual(steps, [
			"render direct 30000",
			"commit direct-egress exhausted",
		]);
	});

	it("skips the residential render and its budget after an unreadable direct render on a blocked deferral", async () => {
		const { run, steps } = ladderWith({
			unsupportedReason: "blocked",
			direct: renderedBody,
			commits: {
				"direct-egress": { kind: "unreadable", detail: "no readable content" },
			},
			webUnlockerFetch: { kind: "committed" },
		});

		const result = await run();

		assert.deepEqual(result, {
			kind: "settled",
			settledThrough: "web-unlocker-fetch",
			residentialSkipped: true,
		});
		assert.deepEqual(steps, [
			"render direct 30000",
			"commit direct-egress available",
			"time 10000000",
			"web unlocker fetch",
		]);
	});

	it("reports an unreadable direct render as failed with its status and requests when every later leg fails", async () => {
		const { run, steps } = ladderWith({
			direct: renderedBody,
			commits: {
				"direct-egress": { kind: "unreadable", detail: "no readable content" },
			},
			residential: residentialFailure,
			webUnlockerRender: unlockerFailure,
		});

		const result = await run();

		assert.deepEqual(result, {
			kind: "unrendered",
			direct: {
				kind: "failed",
				detail: "no readable content",
				httpStatus: 200,
				requests,
				resourceHosts,
			},
			residential: residentialFailure,
			webUnlockerFetch: { kind: "skipped", reason: "no-block-evidence" },
			webUnlockerRender: unlockerFailure,
		});
		assert.deepEqual(steps, [
			"render direct 30000",
			"commit direct-egress exhausted",
			"time 10000000",
			"budget",
			"mint residential session-1",
			"render residential 30000",
			"time 10000000",
			"render web-unlocker 90000",
		]);
	});

	it("returns budget-exhausted at the residential gate without minting a residential session when the budget is denied", async () => {
		const { run, steps } = ladderWith({
			direct: failedRender,
			budgetAllowed: false,
		});

		const result = await run();

		assert.deepEqual(result, {
			kind: "budget-exhausted",
			gate: "residential-per-gb",
			direct: failedRender,
		});
		assert.deepEqual(steps, ["render direct 30000", "time 10000000", "budget"]);
	});

	it("passes a freshly minted residential egress to each run's residential render with a 30000 navigation", async () => {
		const { run, steps, renderedEgresses } = ladderWith({
			direct: failedRender,
			residential: renderedBody,
			commits: { "residential-per-gb": { kind: "settled" } },
		});

		await run();
		await run();

		assert.deepEqual(
			renderedEgresses
				.filter((egress) => egress.kind === "residential")
				.map((egress) => egress.proxy.username),
			["zone-user-session-1", "zone-user-session-2"],
		);
		assert.deepEqual(
			steps.filter(
				(step) =>
					step.startsWith("mint") || step.startsWith("render residential"),
			),
			[
				"mint residential session-1",
				"render residential 30000",
				"mint residential session-2",
				"render residential 30000",
			],
		);
	});

	it("settles through the residential render", async () => {
		const { run, steps } = ladderWith({
			direct: failedRender,
			residential: renderedBody,
			commits: { "residential-per-gb": { kind: "settled" } },
		});

		const result = await run();

		assert.deepEqual(result, {
			kind: "settled",
			settledThrough: "residential-per-gb",
			residentialSkipped: false,
		});
		assert.deepEqual(steps, [
			"render direct 30000",
			"time 10000000",
			"budget",
			"mint residential session-1",
			"render residential 30000",
			"commit residential-per-gb available",
		]);
	});

	it("skips the web unlocker fetch for no block evidence and goes to the web unlocker render", async () => {
		const { run, steps, renderedEgresses } = ladderWith({
			direct: failedRender,
			residential: residentialFailure,
			webUnlockerRender: renderedBody,
			commits: { "web-unlocker-render": { kind: "settled" } },
		});

		const result = await run();

		assert.deepEqual(result, {
			kind: "settled",
			settledThrough: "web-unlocker-render",
			residentialSkipped: false,
		});
		assert.deepEqual(renderedEgresses.at(-1), webUnlockerEgress);
		assert.deepEqual(steps, [
			"render direct 30000",
			"time 10000000",
			"budget",
			"mint residential session-1",
			"render residential 30000",
			"time 10000000",
			"render web-unlocker 90000",
			"commit web-unlocker-render exhausted",
		]);
	});

	it.each([
		{
			evidence: "a blocked deferral",
			unsupportedReason: "blocked" as const,
			direct: failedRender,
		},
		{
			evidence: "a blocked direct render",
			unsupportedReason: "javascript-required" as const,
			direct: blockedRender,
		},
	])("goes straight to the web unlocker fetch on $evidence, with no residential session and no budget", async ({
		unsupportedReason,
		direct,
	}) => {
		const { run, steps } = ladderWith({
			unsupportedReason,
			direct,
			webUnlockerFetch: { kind: "committed" },
		});

		const result = await run();

		assert.deepEqual(result, {
			kind: "settled",
			settledThrough: "web-unlocker-fetch",
			residentialSkipped: true,
		});
		assert.deepEqual(steps, [
			"render direct 30000",
			"time 10000000",
			"web unlocker fetch",
		]);
	});

	it("runs the web unlocker fetch after a blocked residential render", async () => {
		const { run, steps } = ladderWith({
			direct: failedRender,
			residential: blockedRender,
			webUnlockerFetch: { kind: "committed" },
		});

		const result = await run();

		assert.deepEqual(result, {
			kind: "settled",
			settledThrough: "web-unlocker-fetch",
			residentialSkipped: false,
		});
		assert.deepEqual(steps, [
			"render direct 30000",
			"time 10000000",
			"budget",
			"mint residential session-1",
			"render residential 30000",
			"time 10000000",
			"web unlocker fetch",
		]);
	});

	it("consumes the budget once when the residential render ran before the web unlocker render", async () => {
		const { run, steps } = ladderWith({
			direct: failedRender,
			residential: blockedRender,
			webUnlockerFetch: noBodyFetch,
			webUnlockerRender: renderedBody,
			commits: { "web-unlocker-render": { kind: "settled" } },
		});

		const result = await run();

		assert.deepEqual(result, {
			kind: "settled",
			settledThrough: "web-unlocker-render",
			residentialSkipped: false,
		});
		assert.deepEqual(steps, [
			"render direct 30000",
			"time 10000000",
			"budget",
			"mint residential session-1",
			"render residential 30000",
			"time 10000000",
			"web unlocker fetch",
			"time 10000000",
			"render web-unlocker 90000",
			"commit web-unlocker-render exhausted",
		]);
	});

	it.each([
		{ kind: "committed" as const },
		{ kind: "settled" as const },
	])("stops at a web unlocker fetch that ended $kind", async (webUnlockerFetch) => {
		const { run, steps } = ladderWith({
			direct: blockedRender,
			webUnlockerFetch,
		});

		const result = await run();

		assert.deepEqual(result, {
			kind: "settled",
			settledThrough: "web-unlocker-fetch",
			residentialSkipped: true,
		});
		assert.equal(steps.at(-1), "web unlocker fetch");
	});

	it("consumes the budget before the web unlocker render with a 90000 navigation and escalation exhausted after a fetch with no body", async () => {
		const { run, steps } = ladderWith({
			direct: blockedRender,
			webUnlockerFetch: noBodyFetch,
			webUnlockerRender: renderedBody,
			commits: { "web-unlocker-render": { kind: "settled" } },
		});

		const result = await run();

		assert.deepEqual(result, {
			kind: "settled",
			settledThrough: "web-unlocker-render",
			residentialSkipped: true,
		});
		assert.deepEqual(steps, [
			"render direct 30000",
			"time 10000000",
			"web unlocker fetch",
			"time 10000000",
			"budget",
			"render web-unlocker 90000",
			"commit web-unlocker-render exhausted",
		]);
	});

	it("returns budget-exhausted at the web unlocker render gate after a skipped residential leg and a fetch with no body", async () => {
		const { run, steps } = ladderWith({
			unsupportedReason: "blocked",
			direct: failedRender,
			webUnlockerFetch: noBodyFetch,
			budgetAllowed: false,
		});

		const result = await run();

		assert.deepEqual(result, {
			kind: "budget-exhausted",
			gate: "web-unlocker-render",
			direct: failedRender,
		});
		assert.deepEqual(steps, [
			"render direct 30000",
			"time 10000000",
			"web unlocker fetch",
			"time 10000000",
			"budget",
		]);
	});

	it("reports every leg when nothing rendered, including the skipped residential leg and an unreadable web unlocker render", async () => {
		const { run, steps } = ladderWith({
			direct: blockedRender,
			webUnlockerFetch: noBodyFetch,
			webUnlockerRender: renderedBody,
			commits: {
				"web-unlocker-render": {
					kind: "unreadable",
					detail: "still a challenge page",
				},
			},
		});

		const result = await run();

		assert.deepEqual(result, {
			kind: "unrendered",
			direct: blockedRender,
			residential: SKIPPED_FOR_BLOCK_EVIDENCE,
			webUnlockerFetch: noBodyFetch,
			webUnlockerRender: {
				kind: "failed",
				detail: "still a challenge page",
				httpStatus: 200,
				requests,
				resourceHosts,
			},
		});
		assert.deepEqual(steps, [
			"render direct 30000",
			"time 10000000",
			"web unlocker fetch",
			"time 10000000",
			"budget",
			"render web-unlocker 90000",
			"commit web-unlocker-render exhausted",
		]);
	});

	it("consumes no budget and runs no paid leg when too little time remains after the direct render", async () => {
		const { run, steps } = ladderWith({
			direct: failedRender,
			remaining: [RESIDENTIAL_THRESHOLD - 1],
		});

		const result = await run();

		assert.deepEqual(result, {
			kind: "unrendered",
			direct: failedRender,
			residential: { kind: "skipped", reason: "time-exhausted" },
			webUnlockerFetch: { kind: "skipped", reason: "time-exhausted" },
			webUnlockerRender: { kind: "skipped", reason: "time-exhausted" },
		});
		assert.deepEqual(steps, [
			"render direct 30000",
			`time ${RESIDENTIAL_THRESHOLD - 1}`,
		]);
	});

	it("runs the residential render with exactly its allowance plus the finalization reserve left", async () => {
		const { run, steps } = ladderWith({
			direct: failedRender,
			residential: renderedBody,
			commits: { "residential-per-gb": { kind: "settled" } },
			remaining: [RESIDENTIAL_THRESHOLD],
		});

		await run();

		assert.deepEqual(steps, [
			"render direct 30000",
			`time ${RESIDENTIAL_THRESHOLD}`,
			"budget",
			"mint residential session-1",
			"render residential 30000",
			"commit residential-per-gb available",
		]);
	});

	it("skips the web unlocker fetch for time but still runs the web unlocker render when its allowance fits", async () => {
		const { run, steps } = ladderWith({
			direct: blockedRender,
			webUnlockerRender: unlockerFailure,
			remaining: [FETCH_THRESHOLD - 1, WEB_UNLOCKER_RENDER_THRESHOLD],
		});

		const result = await run();

		assert.deepEqual(result, {
			kind: "unrendered",
			direct: blockedRender,
			residential: SKIPPED_FOR_BLOCK_EVIDENCE,
			webUnlockerFetch: { kind: "skipped", reason: "time-exhausted" },
			webUnlockerRender: unlockerFailure,
		});
		assert.deepEqual(steps, [
			"render direct 30000",
			`time ${FETCH_THRESHOLD - 1}`,
			`time ${WEB_UNLOCKER_RENDER_THRESHOLD}`,
			"budget",
			"render web-unlocker 90000",
		]);
	});

	it("skips the web unlocker render, consuming no budget, when too little time remains after the fetch", async () => {
		const { run, steps } = ladderWith({
			direct: blockedRender,
			webUnlockerFetch: noBodyFetch,
			remaining: [FETCH_THRESHOLD, WEB_UNLOCKER_RENDER_THRESHOLD - 1],
		});

		const result = await run();

		assert.deepEqual(result, {
			kind: "unrendered",
			direct: blockedRender,
			residential: SKIPPED_FOR_BLOCK_EVIDENCE,
			webUnlockerFetch: noBodyFetch,
			webUnlockerRender: { kind: "skipped", reason: "time-exhausted" },
		});
		assert.deepEqual(steps, [
			"render direct 30000",
			`time ${FETCH_THRESHOLD}`,
			"web unlocker fetch",
			`time ${WEB_UNLOCKER_RENDER_THRESHOLD - 1}`,
		]);
	});

	it("skips the web unlocker render after the residential leg when too little time remains", async () => {
		const { run } = ladderWith({
			direct: failedRender,
			residential: residentialFailure,
			remaining: [ENOUGH_TIME, WEB_UNLOCKER_RENDER_THRESHOLD - 1],
		});

		const result = await run();

		assert.deepEqual(result, {
			kind: "unrendered",
			direct: failedRender,
			residential: residentialFailure,
			webUnlockerFetch: { kind: "skipped", reason: "no-block-evidence" },
			webUnlockerRender: { kind: "skipped", reason: "time-exhausted" },
		});
	});
});
