import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { useTestServer } from "../../../test-app";

const useApp = useTestServer();

async function loadPage() {
	const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
	const response = await request(harness.server).get("/obsidian-read-it-later");
	expect(response.status).toBe(200);
	return new JSDOM(response.text).window.document;
}

describe("Obsidian read-it-later landing page", () => {
	it("keeps the Obsidian selection and attribution when either install form is submitted", async () => {
		const doc = await loadPage();
		const forms = Array.from(doc.querySelectorAll('form.lp-action[action="/install"]'));
		expect(forms).toHaveLength(2);
		for (const [index, form] of forms.entries()) {
			expect(form.getAttribute("method")?.toLowerCase()).toBe("get");
			const fields = Object.fromEntries(Array.from(form.querySelectorAll("input[type=hidden]")).map((input) => [
				input.getAttribute("name"), input.getAttribute("value"),
			]));
			expect(fields).toEqual({
				client: "obsidian",
				utm_source: `lp-obsidian-read-it-later-${index === 0 ? "hero" : "close"}`,
				utm_medium: "internal",
				utm_content: "install",
			});
		}
	});

	it("reserves the supplied Obsidian note screenshot's dimensions and describes its provenance", async () => {
		const doc = await loadPage();
		const image = doc.querySelector('[data-test-section="lp-proof"] img');
		assert(image, "the proof must show the synced note");
		expect(image.getAttribute("src")).toBe("https://static.test/screenshots/obsidian-note.png");
		expect([image.getAttribute("width"), image.getAttribute("height")]).toEqual(["1200", "800"]);
		expect(image.getAttribute("alt")).toBe("An article synced from Readplace, open as a Markdown note in Obsidian");
	});

	it("states the export, one-way sync and desktop limits before offering setup", async () => {
		const doc = await loadPage();
		const limits = Array.from(doc.querySelectorAll(".lp-limits__item")).map((item) => item.textContent);
		expect(limits).toContain("The Markdown has no tags and no author, and a published date only when one is known.");
		expect(limits).toContain("Sync goes one way, from Readplace into Obsidian. Your edits, highlights and notes don't sync back to Readplace.");
		expect(limits).toContain("This release is for desktop Obsidian. It doesn't run on Obsidian's mobile apps.");
		const faq = Array.from(doc.querySelectorAll("[data-test-lp-faq-answer]")).map((answer) => answer.textContent);
		expect(faq).toContain("The plugin only reads your articles, but the connection grants the same full account access as other Readplace apps. You can disconnect it from Connected apps in your Readplace account, or sign out in the plugin settings.");
	});
});
