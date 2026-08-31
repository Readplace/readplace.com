import assert from "node:assert/strict";
import { initPageDepth, type PageDepthDeps } from "./page-depth.client";

const EXIT_KINDS = { leftSite: "left_site", navigatedOnward: "navigated_onward" };

interface Harness {
	deps: PageDepthDeps;
	sent: string[];
	scroll: (to: number) => void;
	leave: () => void;
	clickAnchor: (href: string | null) => void;
	submit: () => void;
	setDocumentHeight: (height: number) => void;
}

function harness(options?: { viewportHeight?: number; documentHeight?: number }): Harness {
	const sent: string[] = [];
	const listeners: {
		click: ((event: Event) => void)[];
		submit: (() => void)[];
		scroll: (() => void)[];
		leave: (() => void)[];
	} = { click: [], submit: [], scroll: [], leave: [] };

	let scrollY = 0;
	let documentHeight = options?.documentHeight ?? 4000;
	let anchorHref: string | null = null;

	const deps: PageDepthDeps = {
		addClickListener: (listener) => listeners.click.push(listener),
		addSubmitListener: (listener) => listeners.submit.push(listener),
		addScrollListener: (listener) => listeners.scroll.push(listener),
		addLeaveListener: (listener) => listeners.leave.push(listener),
		anchorHrefFromEvent: () => anchorHref,
		scrollY: () => scrollY,
		viewportHeight: () => options?.viewportHeight ?? 800,
		documentHeight: () => documentHeight,
		sendBeacon: (url) => sent.push(url),
		beaconUrl: "/page-depth/event",
		exitKinds: EXIT_KINDS,
	};

	initPageDepth(deps);

	return {
		deps,
		sent,
		scroll: (to) => {
			scrollY = to;
			for (const listener of listeners.scroll) listener();
		},
		leave: () => {
			for (const listener of listeners.leave) listener();
		},
		clickAnchor: (href) => {
			anchorHref = href;
			for (const listener of listeners.click) listener(new Event("click"));
		},
		submit: () => {
			for (const listener of listeners.submit) listener();
		},
		setDocumentHeight: (height) => {
			documentHeight = height;
		},
	};
}

function fieldsOf(url: string): Record<string, string> {
	return Object.fromEntries(new URL(url, "https://internal.invalid").searchParams);
}

describe("initPageDepth", () => {
	it("credits a reader who never scrolls with the screenful they did see", () => {
		const page = harness({ viewportHeight: 800, documentHeight: 4000 });

		page.leave();

		assert.equal(page.sent.length, 1);
		assert.deepEqual(fieldsOf(page.sent[0]), {
			deepest: "800",
			height: "4000",
			viewport: "800",
			exit: EXIT_KINDS.leftSite,
		});
	});

	it("reports the deepest point reached, not the point they left from", () => {
		const page = harness({ viewportHeight: 800, documentHeight: 4000 });

		page.scroll(2000);
		page.scroll(100);
		page.leave();

		assert.equal(fieldsOf(page.sent[0]).deepest, "2800");
	});

	it("measures the page at its height when the reader leaves, so late-settling content is not measured against a height the page never had", () => {
		const page = harness({ viewportHeight: 800, documentHeight: 4000 });

		page.setDocumentHeight(6000);
		page.leave();

		assert.equal(fieldsOf(page.sent[0]).height, "6000");
	});

	it("marks a reader who clicked through to another Readplace page as navigating onward", () => {
		const page = harness();

		page.clickAnchor("/install?utm_source=home-ways");
		page.leave();

		assert.equal(fieldsOf(page.sent[0]).exit, EXIT_KINDS.navigatedOnward);
	});

	it("marks a form submit as navigating onward, since the hero's actions are GET forms", () => {
		const page = harness();

		page.submit();
		page.leave();

		assert.equal(fieldsOf(page.sent[0]).exit, EXIT_KINDS.navigatedOnward);
	});

	it("counts a click on someone else's site as leaving, not as navigating onward", () => {
		const page = harness();

		page.clickAnchor("https://github.com/Readplace/readplace.com");
		page.leave();

		assert.equal(fieldsOf(page.sent[0]).exit, EXIT_KINDS.leftSite);
	});

	it("counts a protocol-relative href as leaving, so another host cannot read as our own", () => {
		const page = harness();

		page.clickAnchor("//evil.example.com/install");
		page.leave();

		assert.equal(fieldsOf(page.sent[0]).exit, EXIT_KINDS.leftSite);
	});

	it("ignores a click that landed on no anchor at all", () => {
		const page = harness();

		page.clickAnchor(null);
		page.leave();

		assert.equal(fieldsOf(page.sent[0]).exit, EXIT_KINDS.leftSite);
	});

	it("reports once, however many times the page announces it is going away", () => {
		const page = harness();

		page.leave();
		page.leave();
		page.leave();

		assert.equal(page.sent.length, 1);
	});

	it("appends its fields to a beacon URL that already carries a query", () => {
		const sent: string[] = [];
		const leave: (() => void)[] = [];
		initPageDepth({
			addClickListener: () => undefined,
			addSubmitListener: () => undefined,
			addScrollListener: () => undefined,
			addLeaveListener: (listener) => leave.push(listener),
			anchorHrefFromEvent: () => null,
			scrollY: () => 0,
			viewportHeight: () => 800,
			documentHeight: () => 4000,
			sendBeacon: (url) => sent.push(url),
			beaconUrl: "/page-depth/event?page=home",
			exitKinds: EXIT_KINDS,
		});

		for (const listener of leave) listener();

		assert.equal(sent[0].startsWith("/page-depth/event?page=home&"), true);
		assert.equal(fieldsOf(sent[0]).page, "home");
	});
});
