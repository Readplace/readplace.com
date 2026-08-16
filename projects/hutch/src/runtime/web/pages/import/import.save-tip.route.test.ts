import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { useTestServer } from "../../../test-app";

const useApp = useTestServer();

function documentOf(html: string): Document {
	return new JSDOM(html).window.document;
}

function saveTipStateOn(html: string): string | null {
	const form = documentOf(html).querySelector("[data-test-form='import-from-url']");
	assert(form, "the from-url form must be rendered so the save tip has something to gate");
	return form.getAttribute("data-save-tip");
}

describe("Save tip — the import link box", () => {
	it("gates the fetch for a session that has not been warned yet", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).get("/import");

		expect(saveTipStateOn(response.text)).toBe("due");
	});

	it("warns about the links the fetch is about to bring in, not about one article", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).get("/import");

		const doc = documentOf(response.text);
		const panel = doc.querySelector("[data-test-confirm-popover='save-tip']");
		assert(panel, "the import page must render its own save-tip panel");
		expect(panel.getAttribute("data-test-confirm-subject")).toBe("import");
		expect(doc.getElementById("save-tip-title")?.textContent).toBe(
			"Some of these may arrive as links only",
		);
		expect(
			doc.querySelector("[data-test-action='save-tip-proceed']")?.textContent,
		).toBe("Fetch the links anyway");
	});

	it("does not pretend a client could have read the index instead", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).get("/import");

		const body = documentOf(response.text).getElementById("save-tip-body");
		assert(body, "the panel must say why the links may come in bare");
		expect(body.textContent).toContain("Nothing can capture a whole index for you");
	});

	it("stops gating the box once the session has been warned", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = request.agent(harness.server);

		await agent.post("/import/from-url").type("form").send({ url: "" });
		const response = await agent.get("/import");

		expect(saveTipStateOn(response.text)).toBe("seen");
	});
});
