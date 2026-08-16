import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { SAVE_TIP_COOKIE_NAME } from "../../shared/save-tip/save-tip";
import { loginAgent, useTestServer } from "../../../test-app";

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
	assert(panel, "the save-tip panel must be rendered on every gated surface");
	return panel;
}

describe("Save tip — the queue save bar", () => {
	it("gates the save bar for a session that has not been warned yet", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/queue");

		expect(saveTipStateOn(response.text, "[data-test-form='save-article']")).toBe("due");
	});

	it("puts the panel at page level, where an htmx <main> swap keeps it", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const panel = panelOf((await agent.get("/queue")).text);

		expect(panel.parentElement?.tagName).toBe("MAIN");
		expect(panel.getAttribute("popover")).toBe("auto");
		expect(panel.getAttribute("data-test-confirm-subject")).toBe("article");
	});

	it("stops gating the save bar once a save has been through the warning", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		await agent.post("/queue/save").type("form").send({ url: "https://example.com/first" });
		const response = await agent.get("/queue");

		expect(saveTipStateOn(response.text, "[data-test-form='save-article']")).toBe("seen");
	});

	it("keeps the panel in the markup after the warning, so the shape never changes", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		await agent.post("/queue/save").type("form").send({ url: "https://example.com/shape" });

		const panel = panelOf((await agent.get("/queue")).text);
		expect(panel.getAttribute("id")).toBe("save-tip");
	});

	it("records the warning as a session cookie, so a new session is warned again", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent
			.post("/queue/save")
			.type("form")
			.send({ url: "https://example.com/cookie" });

		const [tipCookie] = saveTipCookies(response.headers);
		assert(tipCookie, "a save through the bar must record that the warning was given");
		expect(tipCookie.toLowerCase()).not.toContain("max-age");
		expect(tipCookie.toLowerCase()).not.toContain("expires");
	});

	it("still gates the bar when the save was rejected, since nothing was saved", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.post("/queue/save").type("form").send({ url: "not-a-url" });

		expect(response.status).toBe(422);
		expect(panelOf(response.text).getAttribute("id")).toBe("save-tip");
	});
});
