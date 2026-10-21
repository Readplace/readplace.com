import { BulkSaveJobIdSchema } from "../bulk-save-queue/bulk-save-job";
import { type BulkSaveRun, BulkSaveRunIdSchema, type RunLink } from "../bulk-save-run/bulk-save-run";
import { WindowIdSchema } from "../domain/window-id";
import { buildSaveAllView, routeToolbarOpen } from "./save-all-view";

function link(url: string, state: Exclude<RunLink["state"], "skipped" | "failed">): RunLink {
	return { url, state, jobId: state === "capturing" ? null : BulkSaveJobIdSchema.parse(`job-${url}`), tooBigMb: null };
}

function failed(url: string, unauthorized: boolean): RunLink {
	return { url, state: "failed", unauthorized, jobId: null, tooBigMb: null };
}

function runWith(links: RunLink[], overrides: Partial<BulkSaveRun> = {}): BulkSaveRun {
	return {
		id: BulkSaveRunIdSchema.parse("6f1c2a4e-1d1b-4c55-9a77-0d5e3f2b8a10"),
		windowId: WindowIdSchema.parse(1),
		joinedIds: [],
		epoch: 0,
		revision: 1,
		phase: "running",
		links,
		clientSkips: [],
		notified: false,
		outcomeSeen: false,
		...overrides,
	};
}

function many(count: number, state: Exclude<RunLink["state"], "skipped" | "failed">, prefix: string): RunLink[] {
	return Array.from({ length: count }, (_v, index) => link(`https://example.com/${prefix}-${index}`, state));
}

describe("buildSaveAllView while saving", () => {
	it("reads 'Saving tabs…' with an empty, reserved count line on the click's own frame", () => {
		expect(buildSaveAllView({ provisionalCount: null, run: null })).toMatchObject({
			kind: "saving",
			title: "Saving tabs…",
			countLine: "",
			ariaBusy: true,
			revealPending: false,
		});
	});

	it("names the popup's own count before the background answers, still without a count line", () => {
		expect(buildSaveAllView({ provisionalCount: 28, run: null })).toMatchObject({ title: "Saving 28 tabs…", countLine: "" });
		expect(buildSaveAllView({ provisionalCount: 1, run: null }).title).toBe("Saving 1 tab…");
	});

	it("counts the captured tabs while any capture is pending, and reveals the hint and Continue", () => {
		const view = buildSaveAllView({
			provisionalCount: 28,
			run: runWith([...many(12, "waiting", "w"), ...many(16, "capturing", "c")]),
		});

		expect(view).toMatchObject({ title: "Saving 28 tabs…", countLine: "Captured 12 of 28", revealPending: true });
	});

	it("counts the answered tabs between requests and names the request in flight", () => {
		const between = runWith([...many(11, "saved", "s"), ...many(17, "waiting", "w")]);
		const inFlight = runWith([...many(11, "saved", "s"), ...many(6, "sending", "x"), ...many(11, "waiting", "w")]);

		expect(buildSaveAllView({ provisionalCount: 28, run: between }).countLine).toBe("Sent 11 of 28");
		expect(buildSaveAllView({ provisionalCount: 28, run: inFlight }).countLine).toBe("Sent 11 of 28 · Sending 6");
	});

	it("reads 'Sent 0 of M' with no suffix while a window's send waits behind another's pass", () => {
		expect(buildSaveAllView({ provisionalCount: 6, run: runWith(many(6, "waiting", "w")) }).countLine).toBe("Sent 0 of 6");
	});

	it("takes the count from a joined record over the popup's own", () => {
		expect(buildSaveAllView({ provisionalCount: 28, run: runWith(many(34, "capturing", "c")) }).title).toBe("Saving 34 tabs…");
	});
});

describe("buildSaveAllView once finished", () => {
	it("paints today's outcome, its detail lines and the readlist control", () => {
		const run = runWith(
			[link("https://example.com/pinned", "already-saved"), ...many(6, "saved", "open-tab"), failed("https://example.com/open-tab-6", false)],
			{ phase: "finished", clientSkips: [{ tabId: 9, reason: "Only http and https URLs can be saved" }, { tabId: 10, reason: "Readplace's own pages aren't saved" }] },
		);

		expect(buildSaveAllView({ provisionalCount: 8, run })).toEqual({
			kind: "finished",
			title: "Tabs saved",
			countLine: "",
			ariaBusy: false,
			revealPending: false,
			summary: "Saved 6 · Already in readlist 1 · Skipped 2 · Failed 1",
			tooBig: null,
			detailLines: [
				{ kind: "failed", text: "Couldn't save https://example.com/open-tab-6" },
				{ kind: "skipped", text: "Only http and https URLs can be saved" },
				{ kind: "skipped", text: "Readplace's own pages aren't saved" },
			],
			showReadlist: true,
		});
	});

	it("drops the readlist control when a 401 cut the run short after something landed", () => {
		const view = buildSaveAllView({
			provisionalCount: 2,
			run: runWith([link("https://example.com/a", "saved"), failed("https://example.com/b", true)], { phase: "finished" }),
		});

		expect([view.kind, view.title, view.showReadlist]).toEqual(["finished", "Not signed in", false]);
	});

	it("names the failed and signed-out outcomes by their kind", () => {
		expect(buildSaveAllView({ provisionalCount: 1, run: runWith([failed("https://example.com/a", false)], { phase: "finished" }) }).kind).toBe("failed");
		expect(buildSaveAllView({ provisionalCount: 1, run: runWith([failed("https://example.com/a", true)], { phase: "finished" }) }).kind).toBe("login");
	});
});

describe("routeToolbarOpen", () => {
	const active = runWith([link("https://example.com/a", "sending")], {
		clientSkips: [{ tabId: 5, reason: "x" }, { tabId: null, reason: "y" }],
	});

	function route(input: { runs: BulkSaveRun[]; url: string; tabId?: number; windowId?: number }) {
		return routeToolbarOpen({
			runs: input.runs,
			activeTab: { url: input.url, tabId: input.tabId, windowId: WindowIdSchema.parse(input.windowId ?? 1) },
		}).kind;
	}

	it("shows the live run for a tab it holds as a link or as a skipped tab", () => {
		expect(route({ runs: [active], url: "https://example.com/a", tabId: 1 })).toBe("follow");
		expect(route({ runs: [active], url: "chrome://settings", tabId: 5 })).toBe("follow");
	});

	it("saves any other tab, a tab in another window's run, or a tab once its run has finished", () => {
		expect(route({ runs: [active], url: "https://example.com/other", tabId: 2 })).toBe("single-save");
		expect(route({ runs: [active], url: "https://example.com/other" })).toBe("single-save");
		expect(route({ runs: [active], url: "https://example.com/a", windowId: 2 })).toBe("single-save");
		expect(route({ runs: [{ ...active, phase: "finished" }], url: "https://example.com/a" })).toBe("single-save");
		expect(route({ runs: [], url: "https://example.com/a" })).toBe("single-save");
	});
});
