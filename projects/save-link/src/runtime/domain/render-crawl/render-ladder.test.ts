import assert from "node:assert/strict";
import { CandidateIdSchema } from "@packages/domain/article";
import {
	type MeteredLeg,
	type PaidLegPermit,
	PaidLegPermitSchema,
} from "@packages/provider-contracts/metered-leg-ledger";
import type {
	RenderOutcome,
	RenderPage,
	ResidentialEgress,
	WebUnlockerEgress,
} from "./render-page.types";
import {
	type Escalation,
	type LadderRender,
	type ProxiedFetchAttempt,
	type RenderCommit,
	type RenderedThrough,
	type RenderLadderLegs,
	type RenderLegClaim,
	type RenderMeteredLeg,
	type RenderRecoveryAttempt,
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
const candidate = { id: CandidateIdSchema.parse("candidate-1"), tier: "tier-1" as const };
const committed = { kind: "committed", candidate } as const;
const SHORT_LEG: Record<MeteredLeg, string> = {
	"render-residential-per-gb": "residential",
	"render-web-unlocker-fetch": "fetch",
	"render-web-unlocker-render": "render",
	comprehensive: "comprehensive",
	"content-judge": "content-judge",
	summary: "summary",
};
const noBodyFetch: ProxiedFetchAttempt = {
	kind: "no-body",
	outcome: "blocked",
};

function ladderWith(script: {
	url?: string;
	direct: RenderOutcome;
	residential?: RenderOutcome;
	webUnlockerRender?: RenderOutcome;
	commits?: Partial<Record<RenderedThrough, RenderCommit>>;
	webUnlockerFetch?: ProxiedFetchAttempt;
	budgetAllowed?: boolean;
	claims?: Partial<Record<RenderMeteredLeg, RenderLegClaim>>;
	unsupportedReason?: "javascript-required" | "blocked";
	remaining?: number[];
}) {
	const steps: string[] = [];
	const ledger: string[] = [];
	const recoveryReports: RenderRecoveryAttempt[] = [];
	const permitFor = (leg: RenderMeteredLeg): PaidLegPermit =>
		PaidLegPermitSchema.parse({ leg, claimId: "msg-1", inputHash: `hash-${leg}` });
	const assertHeld = (permit: PaidLegPermit, leg: RenderMeteredLeg) =>
		assert.equal(permit.leg, leg);
	const renderedEgresses: Parameters<RenderPage>[0]["egress"][] = [];
	const remaining = [...(script.remaining ?? [])];
	let residentialSessions = 0;
	const legFor = (egress: Parameters<RenderPage>[0]["egress"]) => {
		if (egress.kind === "direct") return script.direct;
		if (egress.kind === "residential") return script.residential;
		return script.webUnlockerRender;
	};
	const renderPage: RenderPage = async (params) => {
		assert.equal(params.url, script.url ?? URL);
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
		url: script.url ?? URL,
		residentialEgress: (permit): ResidentialEgress => {
			assertHeld(permit, "render-residential-per-gb");
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
		webUnlockerEgress: (permit) => {
			assertHeld(permit, "render-web-unlocker-render");
			return webUnlockerEgress;
		},
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
		fetchThroughWebUnlocker: async (permit) => {
			assertHeld(permit, "render-web-unlocker-fetch");
			steps.push("web unlocker fetch");
			assert(
				script.webUnlockerFetch,
				"the web unlocker fetch was not expected to run",
			);
			return script.webUnlockerFetch;
		},
		claimLeg: async (leg) => {
			steps.push(`claim ${SHORT_LEG[leg]}`);
			const scripted = script.claims?.[leg];
			if (scripted) return scripted;
			if (script.budgetAllowed === false && leg !== "render-web-unlocker-fetch")
				return { kind: "budget-exhausted" };
			return { kind: "granted", permit: permitFor(leg) };
		},
		settleLeg: async ({ permit, candidate: settled }) => {
			ledger.push(`settle ${SHORT_LEG[permit.leg]} ${settled.id}`);
		},
		releaseLeg: async (permit) => {
			ledger.push(`release ${SHORT_LEG[permit.leg]}`);
		},
		remainingMilliseconds: () => {
			const next = remaining.shift() ?? ENOUGH_TIME;
			steps.push(`time ${next}`);
			return next;
		},
		reportRecoveryAttempt: (attempt) => recoveryReports.push(attempt),
	};
	return { run: () => runRenderLadder(legs), steps, ledger, renderedEgresses, recoveryReports };
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
			webUnlockerFetch: committed,
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
			"claim fetch",
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
			"claim residential",
			"mint residential session-1",
			"render residential 30000",
			"time 10000000",
			"claim render",
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
		assert.deepEqual(steps, ["render direct 30000", "time 10000000", "claim residential"]);
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
			"claim residential",
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
			"claim residential",
			"mint residential session-1",
			"render residential 30000",
			"time 10000000",
			"claim render",
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
			webUnlockerFetch: committed,
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
			"claim fetch",
			"web unlocker fetch",
		]);
	});

	it("runs the web unlocker fetch after a blocked residential render", async () => {
		const { run, steps } = ladderWith({
			direct: failedRender,
			residential: blockedRender,
			webUnlockerFetch: committed,
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
			"claim residential",
			"mint residential session-1",
			"render residential 30000",
			"time 10000000",
			"claim fetch",
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
			"claim residential",
			"mint residential session-1",
			"render residential 30000",
			"time 10000000",
			"claim fetch",
			"web unlocker fetch",
			"time 10000000",
			"claim render",
			"render web-unlocker 90000",
			"commit web-unlocker-render exhausted",
		]);
	});

	it.each([
		committed,
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
			"claim fetch",
			"web unlocker fetch",
			"time 10000000",
			"claim render",
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
			"claim fetch",
			"web unlocker fetch",
			"time 10000000",
			"claim render",
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
			"claim fetch",
			"web unlocker fetch",
			"time 10000000",
			"claim render",
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
			"claim residential",
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
			"claim render",
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
			"claim fetch",
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

	describe("bounded residential recovery after an unlocker browser 502", () => {
		const gatewayFailure: RenderOutcome = { ...failedRender, detail: "main document answered HTTP 502", httpStatus: 502 };
		const eligible = {
			url: "https://publisher.test/article",
			direct: blockedRender,
			webUnlockerFetch: noBodyFetch,
			webUnlockerRender: gatewayFailure,
		};

		it.each([
			{ host: "publisher.test", port: "" },
			{ host: "journal.example.org", port: ":443" },
			{ host: "www.mckinsey.com", port: "" },
			{ host: "email.mckinsey.com", port: "" },
			{ host: "mckinsey.com", port: "" },
		])("tries the unused residential leg once on $host$port with exactly its remaining allowance", async ({ host, port }) => {
			const { run, steps, ledger, renderedEgresses, recoveryReports } = ladderWith({
				...eligible,
				url: `https://${host}${port}/article?private-token=hidden`,
				residential: renderedBody,
				commits: { "residential-per-gb": committed },
				remaining: [FETCH_THRESHOLD, WEB_UNLOCKER_RENDER_THRESHOLD, RESIDENTIAL_THRESHOLD, RESIDENTIAL_THRESHOLD],
			});

			assert.deepEqual(await run(), { kind: "settled", settledThrough: "residential-per-gb", residentialSkipped: false });
			assert.deepEqual(renderedEgresses.map((egress) => egress.kind), ["direct", "web-unlocker", "residential"]);
			assert.equal(steps.filter((step) => step === "claim residential").length, 1);
			assert(steps.includes("commit residential-per-gb available"));
			assert.deepEqual(ledger, ["release fetch", "release render", "settle residential candidate-1"]);
			assert.deepEqual(recoveryReports, [
				{ policyVersion: "residential-after-gateway-502-v1", host, phase: "started" },
				{ policyVersion: "residential-after-gateway-502-v1", host, phase: "finished", outcome: "committed" },
			]);
		});

		it.each(["http://publisher.test/article", "https://publisher.test:444/article", "ftp://publisher.test/article", "invalid"])("does not retry outside standard HTTPS URLs: %s", async (url) => {
			const { run, steps, recoveryReports } = ladderWith({ ...eligible, url });
			assert.equal((await run()).kind, "unrendered");
			assert(!steps.includes("claim residential"));
			assert.deepEqual(recoveryReports, []);
		});

		it.each([failedRender, { ...failedRender, httpStatus: 500 }, { ...blockedRender, httpStatus: 502 }])("does not retry a final outcome without failed HTTP 502: $kind $httpStatus", async (webUnlockerRender) => {
			const { run, steps, recoveryReports } = ladderWith({ ...eligible, webUnlockerRender });
			assert.equal((await run()).kind, "unrendered");
			assert(!steps.includes("claim residential"));
			assert.deepEqual(recoveryReports, []);
		});

		it("does not repeat residential when it already ran before the 502", async () => {
			const { run, steps, recoveryReports } = ladderWith({ ...eligible, direct: failedRender, residential: blockedRender });
			assert.equal((await run()).kind, "unrendered");
			assert.equal(steps.filter((step) => step === "render residential 30000").length, 1);
			assert.deepEqual(recoveryReports, []);
		});

		it.each([
			{ route: "direct-egress", direct: renderedBody, webUnlockerFetch: noBodyFetch, webUnlockerRender: gatewayFailure },
			{ route: "web-unlocker-fetch", direct: blockedRender, webUnlockerFetch: committed, webUnlockerRender: gatewayFailure },
			{ route: "web-unlocker-render", direct: blockedRender, webUnlockerFetch: noBodyFetch, webUnlockerRender: renderedBody },
		])("preserves a success through $route", async ({ route, ...outcomes }) => {
			const { run, steps, recoveryReports } = ladderWith({
				...eligible, ...outcomes,
				commits: { "direct-egress": committed, "web-unlocker-render": committed },
			});
			assert.deepEqual(await run(), { kind: "settled", settledThrough: route, residentialSkipped: route !== "direct-egress" });
			assert(!steps.includes("claim residential"));
			assert.deepEqual(recoveryReports, []);
		});

		it.each([false, true])("preserves the original failures when time expires (after claim: %s)", async (afterClaim) => {
			const { run, steps, ledger, recoveryReports } = ladderWith({
				...eligible,
				remaining: [FETCH_THRESHOLD, WEB_UNLOCKER_RENDER_THRESHOLD, ...(afterClaim ? [RESIDENTIAL_THRESHOLD] : []), RESIDENTIAL_THRESHOLD - 1],
			});
			assert.deepEqual(await run(), {
				kind: "unrendered", direct: blockedRender, residential: { kind: "skipped", reason: "time-exhausted" },
				webUnlockerFetch: noBodyFetch, webUnlockerRender: gatewayFailure,
			});
			assert.equal(steps.includes("claim residential"), afterClaim);
			assert(!steps.some((step) => step.startsWith("mint residential")));
			assert.deepEqual(ledger, ["release fetch", "release render", ...(afterClaim ? ["release residential"] : [])]);
			assert.deepEqual(recoveryReports, []);
		});

		it.each([
			{ claim: { kind: "deferred" } as const, result: { kind: "deferred", awaiting: "render-residential-per-gb", direct: blockedRender } },
			{ claim: { kind: "in-flight" } as const, result: { kind: "in-flight", leg: "render-residential-per-gb" } },
			{ claim: { kind: "settled", outcome: "recorded-candidate" } as const, result: { kind: "recorded", leg: "render-residential-per-gb", outcome: "recorded-candidate" } },
			{ claim: { kind: "budget-exhausted" } as const, result: { kind: "budget-exhausted", gate: "residential-per-gb", direct: blockedRender } },
		])("honors the recovery leg's $claim.kind claim without starting an attempt", async ({ claim, result }) => {
			const { run, steps, recoveryReports } = ladderWith({ ...eligible, claims: { "render-residential-per-gb": claim } });
			assert.deepEqual(await run(), result);
			assert(!steps.some((step) => step.startsWith("mint residential")));
			assert.deepEqual(recoveryReports, []);
		});

		it.each([residentialFailure, blockedRender])("retains every earlier cause after a $kind recovery", async (residential) => {
			const { run, ledger, recoveryReports } = ladderWith({ ...eligible, residential });
			assert.deepEqual(await run(), { kind: "unrendered", direct: blockedRender, residential, webUnlockerFetch: noBodyFetch, webUnlockerRender: gatewayFailure });
			assert.deepEqual(ledger, ["release fetch", "release render", "release residential"]);
			assert.deepEqual(recoveryReports.at(-1), { policyVersion: "residential-after-gateway-502-v1", host: "publisher.test", phase: "finished", outcome: residential.kind, httpStatus: residential.httpStatus });
		});

		it("does not count an unreadable recovery body as a successful article", async () => {
			const { run, recoveryReports } = ladderWith({ ...eligible, residential: renderedBody, commits: { "residential-per-gb": { kind: "unreadable", detail: "challenge body" } } });
			const result = await run();
			assert.equal(result.kind, "unrendered");
			assert.deepEqual(recoveryReports.at(-1), { policyVersion: "residential-after-gateway-502-v1", host: "publisher.test", phase: "finished", outcome: "failed", httpStatus: 200 });
		});

		it("retains the existing terminal settlement without calling another route", async () => {
			const { run, ledger, recoveryReports } = ladderWith({ ...eligible, residential: renderedBody, commits: { "residential-per-gb": { kind: "settled" } } });
			assert.equal((await run()).kind, "settled");
			assert.deepEqual(ledger, ["release fetch", "release render", "release residential"]);
			assert.equal(recoveryReports.at(-1)?.phase, "finished");
		});

		it("releases and reports a thrown recovery without swallowing the original error", async () => {
			const { run, ledger, recoveryReports } = ladderWith({ ...eligible, residential: renderedBody });
			await assert.rejects(run(), /the residential-per-gb commit was not expected to run/);
			assert.deepEqual(ledger, ["release fetch", "release render", "release residential"]);
			assert.deepEqual(recoveryReports.at(-1), { policyVersion: "residential-after-gateway-502-v1", host: "publisher.test", phase: "finished", outcome: "threw" });
		});
	});

	describe("under the metered-leg ledger", () => {
		const DEFERRED_LEG = { kind: "skipped", reason: "deferred" } as const;

		it("returns deferred before the residential render when its claim is deferred and the free legs saw no block evidence", async () => {
			const { run, steps, ledger } = ladderWith({
				direct: failedRender,
				claims: { "render-residential-per-gb": { kind: "deferred" } },
			});

			const result = await run();

			assert.deepEqual(result, {
				kind: "deferred",
				awaiting: "render-residential-per-gb",
				direct: failedRender,
			});
			assert.deepEqual(steps, ["render direct 30000", "time 10000000", "claim residential"]);
			assert.deepEqual(ledger, []);
		});

		it("returns the recorded outcome of a residential leg already settled for the same inputs", async () => {
			const { run, steps } = ladderWith({
				direct: failedRender,
				claims: { "render-residential-per-gb": { kind: "settled", outcome: "recorded-candidate" } },
			});

			const result = await run();

			assert.deepEqual(result, { kind: "recorded", leg: "render-residential-per-gb", outcome: "recorded-candidate" });
			assert.equal(steps.at(-1), "claim residential");
		});

		it("returns in-flight when another message holds the residential claim", async () => {
			const { run } = ladderWith({
				direct: failedRender,
				claims: { "render-residential-per-gb": { kind: "in-flight" } },
			});

			const result = await run();

			assert.deepEqual(result, { kind: "in-flight", leg: "render-residential-per-gb" });
		});

		it("settles the residential claim with the committed candidate", async () => {
			const { run, ledger } = ladderWith({
				direct: failedRender,
				residential: renderedBody,
				commits: { "residential-per-gb": committed },
			});

			const result = await run();

			assert.deepEqual(result, { kind: "settled", settledThrough: "residential-per-gb", residentialSkipped: false });
			assert.deepEqual(ledger, ["settle residential candidate-1"]);
		});

		it("releases the residential claim when the residential render commits nothing", async () => {
			const { run, ledger } = ladderWith({
				direct: failedRender,
				residential: residentialFailure,
				webUnlockerRender: unlockerFailure,
			});

			await run();

			assert.deepEqual(ledger, ["release residential", "release render"]);
		});

		it("releases the residential claim and rethrows when the residential leg throws", async () => {
			const { run, ledger } = ladderWith({
				direct: failedRender,
				residential: renderedBody,
			});

			await assert.rejects(run(), /the residential-per-gb commit was not expected to run/);
			assert.deepEqual(ledger, ["release residential"]);
		});

		it("reports both web unlocker legs as deferred on block evidence when their claims are deferred", async () => {
			const { run, steps, ledger } = ladderWith({
				direct: blockedRender,
				claims: {
					"render-web-unlocker-fetch": { kind: "deferred" },
					"render-web-unlocker-render": { kind: "deferred" },
				},
			});

			const result = await run();

			assert.deepEqual(result, {
				kind: "unrendered",
				direct: blockedRender,
				residential: SKIPPED_FOR_BLOCK_EVIDENCE,
				webUnlockerFetch: DEFERRED_LEG,
				webUnlockerRender: DEFERRED_LEG,
			});
			assert.deepEqual(steps, ["render direct 30000", "time 10000000", "claim fetch", "time 10000000", "claim render"]);
			assert.deepEqual(ledger, []);
		});

		it("returns the recorded outcome of a web unlocker fetch already settled for the same inputs", async () => {
			const { run } = ladderWith({
				direct: blockedRender,
				claims: { "render-web-unlocker-fetch": { kind: "settled", outcome: "recorded-fetch" } },
			});

			const result = await run();

			assert.deepEqual(result, { kind: "recorded", leg: "render-web-unlocker-fetch", outcome: "recorded-fetch" });
		});

		it("settles the web unlocker fetch claim with the committed candidate", async () => {
			const { run, ledger } = ladderWith({
				direct: blockedRender,
				webUnlockerFetch: committed,
			});

			await run();

			assert.deepEqual(ledger, ["settle fetch candidate-1"]);
		});

		it("releases the web unlocker fetch claim when the fetch settles without a candidate", async () => {
			const { run, ledger } = ladderWith({
				direct: blockedRender,
				webUnlockerFetch: { kind: "settled" },
			});

			await run();

			assert.deepEqual(ledger, ["release fetch"]);
		});

		it("returns in-flight when another message holds the web unlocker render claim", async () => {
			const { run } = ladderWith({
				direct: blockedRender,
				webUnlockerFetch: noBodyFetch,
				claims: { "render-web-unlocker-render": { kind: "in-flight" } },
			});

			const result = await run();

			assert.deepEqual(result, { kind: "in-flight", leg: "render-web-unlocker-render" });
		});

		it("settles the web unlocker render claim with the committed candidate", async () => {
			const { run, ledger } = ladderWith({
				direct: blockedRender,
				webUnlockerFetch: noBodyFetch,
				webUnlockerRender: renderedBody,
				commits: { "web-unlocker-render": committed },
			});

			const result = await run();

			assert.deepEqual(result, { kind: "settled", settledThrough: "web-unlocker-render", residentialSkipped: true });
			assert.deepEqual(ledger, ["release fetch", "settle render candidate-1"]);
		});

		it("settles through the direct render when it commits a candidate, claiming nothing", async () => {
			const { run, steps, ledger } = ladderWith({
				direct: renderedBody,
				commits: { "direct-egress": committed },
			});

			const result = await run();

			assert.deepEqual(result, { kind: "settled", settledThrough: "direct-egress", residentialSkipped: false });
			assert.deepEqual(steps, ["render direct 30000", "commit direct-egress exhausted"]);
			assert.deepEqual(ledger, []);
		});
	});
});
