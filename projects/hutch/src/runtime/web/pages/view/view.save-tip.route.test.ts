import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { SAVE_TIP_COOKIE_NAME } from "../../shared/save-tip/save-tip";
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

		const panel = documentOf(response.text).querySelector(
			"[data-test-confirm-popover='save-tip']",
		);
		assert(panel, "the homepage must render the panel its paste box opens");
		expect(panel.getAttribute("data-test-confirm-subject")).toBe("article");
	});
});
