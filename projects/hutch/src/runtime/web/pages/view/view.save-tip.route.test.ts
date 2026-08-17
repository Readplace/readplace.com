import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { SAVE_TIP_COOKIE_NAME } from "../../shared/save-tip/save-tip-cookie";
import { useTestServer } from "../../../test-app";

const useApp = useTestServer();

function documentOf(html: string): Document {
	return new JSDOM(html).window.document;
}

function saveTipStateOn(html: string, selector: string): string | null {
	const gated = documentOf(html).querySelector(selector);
	assert(gated, `${selector} must be rendered so the save tip has something to gate`);
	return gated.getAttribute("data-save-tip");
}

function saveTipCookies(headers: {
	[key: string]: string | string[] | undefined;
}): string[] {
	const raw = headers["set-cookie"];
	const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
	return cookies.filter((cookie) => cookie.startsWith(`${SAVE_TIP_COOKIE_NAME}=`));
}

function panelOf(html: string): Element {
	const panel = documentOf(html).querySelector("[data-test-confirm-popover='save-tip']");
	assert(panel, "the save-tip panel must be rendered wherever it can be opened");
	return panel;
}

function modeOf(panel: Element): string | null {
	const actions = panel.querySelector("[data-test-save-tip-mode]");
	assert(actions, "the panel must name the mode its controls were built for");
	return actions.getAttribute("data-test-save-tip-mode");
}

async function openPublicView(server: Parameters<typeof request>[0], url: string) {
	const redirect = await request(server).get(`/view?url=${encodeURIComponent(url)}`);
	return { redirect, article: await request(server).get(redirect.headers.location) };
}

describe("Save tip — the public view", () => {
	it("gates the save call to action a reader reaches from the reader view", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const { article } = await openPublicView(harness.server, "https://example.com/public");

		expect(saveTipStateOn(article.text, "[data-test-view-cta-action]")).toBe("due");
	});

	it("spends the session's one warning on the paste that opened the view", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const { redirect } = await openPublicView(harness.server, "https://example.com/paste");

		expect(saveTipCookies(redirect.headers).length).toBe(1);
	});

	it("leaves a shared article link alone, so it cannot spend a warning nobody saw", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const { article } = await openPublicView(harness.server, "https://example.com/shared");

		expect(saveTipCookies(article.headers)).toEqual([]);
	});

	it("holds the call to action back, since its proceed control carries the navigation", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const { article } = await openPublicView(harness.server, "https://example.com/gated");

		const panel = panelOf(article.text);
		expect(modeOf(panel)).toBe("gating");
		const proceed = panel.querySelector("[data-test-action='save-tip-proceed']");
		assert(proceed, "a gated call to action must offer a way through");
		expect(proceed.hasAttribute("data-save-tip-proceed")).toBe(true);
	});
});

describe("Save tip — the homepage paste box", () => {
	it("gates the paste box that opens the public reader", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).get("/");

		expect(saveTipStateOn(response.text, "[data-test-home-try-form]")).toBe("due");
	});

	it("renders the panel the paste box opens", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).get("/");

		const panel = panelOf(response.text);
		expect(panel.getAttribute("data-test-confirm-subject")).toBe("article");
		expect(modeOf(panel)).toBe("advisory");
	});
});

describe("Save tip — arm B's paste box", () => {
	/** Arm B has no URL of its own: `/` renders it for a visitor recorded on that
	 * arm, which is the only way a reader ever reaches it. The marker assert is
	 * what keeps these tests honest — an epoch bump in the split would otherwise
	 * silently retarget them at arm A. */
	async function getArmB(server: Parameters<typeof request>[0]) {
		const response = await request(server)
			.get("/")
			.set("Cookie", ["hutch_exp=homepage-split%3A3%3Avariant-b"]);
		const marker = documentOf(response.text).querySelector("[data-test-variant-b]");
		assert(marker, "the experiment cookie must pin the homepage to arm B");
		return response;
	}

	it("owes the tip to arm B's paste box as much as to arm A's", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await getArmB(harness.server);

		const input = documentOf(response.text).querySelector("[data-test-hb-input]");
		assert(input, "arm B must render its paste box");
		const form = input.closest("form");
		assert(form, "arm B's paste box must sit inside the form the tip marks");
		expect(form.getAttribute("data-save-tip")).toBe("due");
	});

	it("renders the advisory panel arm B's paste box opens", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await getArmB(harness.server);

		const panel = panelOf(response.text);
		expect(panel.getAttribute("data-test-confirm-subject")).toBe("article");
		expect(modeOf(panel)).toBe("advisory");
	});
});
