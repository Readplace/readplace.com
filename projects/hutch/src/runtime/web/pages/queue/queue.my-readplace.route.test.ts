import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import type { Client, Token } from "@node-oauth/oauth2-server";
import type { UserId } from "@packages/domain/user";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { loginAgent, useTestServer, type TestAppResult } from "../../../test-app";
import { SIREN_MEDIA_TYPE } from "../../api/siren";

const useApp = useTestServer();

type LoggedInAgent = Awaited<ReturnType<typeof loginAgent>>;

const SIREN_USER_ID = "test-user-my-readplace" as UserId;

async function bearerToken(testApp: TestAppResult): Promise<string> {
	const client = await testApp.oauthModel.getClient("hutch-firefox-extension", "");
	assert(client, "Test client must exist");
	const token = await testApp.oauthModel.saveToken(
		{
			accessToken: "test-access-token-my-readplace",
			accessTokenExpiresAt: new Date(Date.now() + 3600000),
			refreshToken: "test-refresh-token-my-readplace",
			refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 3600000),
			client: {
				id: "hutch-firefox-extension",
				grants: ["authorization_code", "refresh_token"],
				redirectUris: ["http://127.0.0.1:3000/oauth/callback"],
			} as Client,
			user: { id: SIREN_USER_ID },
		} as Token,
		client,
		{ id: SIREN_USER_ID },
	);
	assert(token, "Token should be saved");
	return token.accessToken;
}

const MY_TAB_PATH = "/queue?tab=my&feature=my";
const PREFERENCE_TEXT = "Long-form essays on systems design and how teams actually ship";

function parse(html: string): Document {
	return new JSDOM(html).window.document;
}

function parseFragment(html: string): Document {
	return new JSDOM(`<main>${html}</main>`).window.document;
}

function tabKeys(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll("[data-test-filter]")).map((el) =>
		el.getAttribute("data-test-filter"),
	);
}

function queryOf(href: string | null | undefined): URLSearchParams {
	assert(href, "expected the element to carry an href");
	return new URL(href, TEST_APP_ORIGIN).searchParams;
}

async function savePreference(agent: LoggedInAgent, text: string) {
	return agent.post("/queue/my-readplace?feature=my").type("form").send({ text });
}

async function loggedIn(): Promise<LoggedInAgent> {
	const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
	return loginAgent(harness.server, harness.auth);
}

describe("GET /queue tab bar", () => {
	it("should offer only the To Read and Read tabs without the feature flag", async () => {
		const agent = await loggedIn();

		const response = await agent.get("/queue");

		expect(tabKeys(parse(response.text))).toEqual(["unread", "read"]);
	});

	it("should add My Readplace left of the list tabs when the feature flag is present", async () => {
		const agent = await loggedIn();

		const response = await agent.get("/queue?feature=my");

		expect(tabKeys(parse(response.text))).toEqual(["my", "unread", "read"]);
	});

	it("should separate My Readplace from the list tabs with its own group", async () => {
		const agent = await loggedIn();

		const response = await agent.get("/queue?feature=my");

		expect(parse(response.text).querySelectorAll(".queue__filter-group").length).toBe(2);
	});

	it("should carry the feature flag on every tab and the sort link so the tab survives navigation", async () => {
		const agent = await loggedIn();

		const doc = parse((await agent.get("/queue?feature=my")).text);

		expect(queryOf(doc.querySelector('[data-test-filter="my"]')?.getAttribute("href")).get("tab")).toBe("my");
		for (const selector of [
			'[data-test-filter="my"]',
			'[data-test-filter="unread"]',
			'[data-test-filter="read"]',
			"[data-test-sort]",
		]) {
			const href = doc.querySelector(selector)?.getAttribute("href");
			expect(queryOf(href).get("feature")).toBe("my");
		}
	});

	it("should serve the Siren collection untouched when a Siren client requests tab=my", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const token = await bearerToken(harness);

		const response = await request(harness.server)
			.get("/queue?tab=my&feature=my")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${token}`);

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toContain(SIREN_MEDIA_TYPE);
	});

	it("should keep the My Readplace tab on the invalid-save error re-render", async () => {
		const agent = await loggedIn();

		const response = await agent
			.post("/queue/save?feature=my")
			.type("form")
			.send({ url: "not-a-url" });

		expect(response.status).toBe(422);
		expect(tabKeys(parse(response.text))).toEqual(["my", "unread", "read"]);
	});

	it("should render the normal listing when tab=my arrives without the feature flag", async () => {
		const agent = await loggedIn();

		const doc = parse((await agent.get("/queue?tab=my")).text);

		const active = Array.from(doc.querySelectorAll(".queue__filter-link--active")).map((el) =>
			el.getAttribute("data-test-filter"),
		);
		expect(active).toEqual(["unread"]);
		expect(tabKeys(doc)).toEqual(["unread", "read"]);
	});
});

describe("GET /queue?tab=my&feature=my", () => {
	it("should ask a reader with no saved preference to write one", async () => {
		const agent = await loggedIn();

		const doc = parse((await agent.get(MY_TAB_PATH)).text);

		const section = doc.querySelector("[data-test-my-readplace]");
		assert(section, "the My Readplace section must render");
		expect(section.getAttribute("data-test-my-mode")).toBe("compose");
		const textarea = doc.querySelector("textarea[name='text']");
		assert(textarea, "the preference form must render a textarea");
		expect(textarea.textContent).toBe("");
	});

	it("should post the preference back to the save route with the feature flag", async () => {
		const agent = await loggedIn();

		const doc = parse((await agent.get(MY_TAB_PATH)).text);

		const form = doc.querySelector('[data-test-form="my-readplace"]');
		assert(form, "the preference form must render");
		const action = form.getAttribute("action");
		assert(action, "the preference form must post somewhere");
		expect(new URL(action, TEST_APP_ORIGIN).pathname).toBe("/queue/my-readplace");
		expect(queryOf(action).get("feature")).toBe("my");
		expect(form.getAttribute("method")).toBe("POST");
	});

	it("should mark My Readplace as the active tab", async () => {
		const agent = await loggedIn();

		const doc = parse((await agent.get(MY_TAB_PATH)).text);

		const active = Array.from(doc.querySelectorAll(".queue__filter-link--active")).map((el) =>
			el.getAttribute("data-test-filter"),
		);
		expect(active).toEqual(["my"]);
	});

	it("should keep the save-article bar off the tab so a save cannot strand the reader", async () => {
		const agent = await loggedIn();

		const doc = parse((await agent.get(MY_TAB_PATH)).text);

		const forms = Array.from(doc.querySelectorAll("[data-test-form]")).map((el) =>
			el.getAttribute("data-test-form"),
		);
		expect(forms).toEqual(["my-readplace"]);
	});
});

describe("POST /queue/my-readplace", () => {
	it("should redirect back to the My Readplace tab after a save", async () => {
		const agent = await loggedIn();

		const response = await savePreference(agent, PREFERENCE_TEXT);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(MY_TAB_PATH);
	});

	it("should show the saved preference with an edit affordance on the followed redirect", async () => {
		const agent = await loggedIn();
		const saved = await savePreference(agent, PREFERENCE_TEXT);

		const doc = parse((await agent.get(saved.headers.location)).text);

		const section = doc.querySelector("[data-test-my-readplace]");
		assert(section, "the My Readplace section must render");
		expect(section.getAttribute("data-test-my-mode")).toBe("summary");
		expect(doc.querySelector("[data-test-my-preference-text]")?.textContent).toBe(PREFERENCE_TEXT);
		const edit = doc.querySelector('[data-test-action="edit-my-readplace"]');
		assert(edit, "the summary must offer an edit action");
		expect(queryOf(edit.getAttribute("href")).get("edit")).toBe("1");
	});

	it("should illustrate the tab with three matching articles once a preference exists", async () => {
		const agent = await loggedIn();
		const saved = await savePreference(agent, PREFERENCE_TEXT);

		const doc = parse((await agent.get(saved.headers.location)).text);

		const preview = doc.querySelector("[data-test-my-preview]");
		assert(preview, "the tab must preview matching articles");
		expect(preview.querySelectorAll("[data-test-article]").length).toBe(3);
	});

	it("should render the preview cards inert so a click cannot act on a placeholder", async () => {
		const agent = await loggedIn();
		const saved = await savePreference(agent, PREFERENCE_TEXT);

		const doc = parse((await agent.get(saved.headers.location)).text);

		const preview = doc.querySelector("[data-test-my-preview]");
		assert(preview, "the tab must preview matching articles");
		const actions = Array.from(preview.querySelectorAll("[data-test-action]"));
		expect(actions.map((button) => button.getAttribute("data-test-action"))).toEqual([
			"mark-read", "delete-fallback", "delete",
			"mark-read", "delete-fallback", "delete",
			"mark-read", "delete-fallback", "delete",
		]);
		expect(actions.every((button) => button.hasAttribute("disabled"))).toBe(true);
		const titles = Array.from(preview.querySelectorAll("[data-test-article-title]")).map((el) =>
			el.getAttribute("href"),
		);
		expect(titles).toEqual(["#", "#", "#"]);
	});

	it("should trim the stored preference", async () => {
		const agent = await loggedIn();
		const saved = await savePreference(agent, `   ${PREFERENCE_TEXT}   `);

		const doc = parse((await agent.get(saved.headers.location)).text);

		expect(doc.querySelector("[data-test-my-preference-text]")?.textContent).toBe(PREFERENCE_TEXT);
	});

	it("should replace the preference when the reader saves again", async () => {
		const agent = await loggedIn();
		await savePreference(agent, PREFERENCE_TEXT);

		await savePreference(agent, "Trip reports from long hikes");
		const doc = parse((await agent.get(MY_TAB_PATH)).text);

		expect(doc.querySelector("[data-test-my-preference-text]")?.textContent).toBe(
			"Trip reports from long hikes",
		);
	});

	it("should send a blank preference back to the form flagged invalid", async () => {
		const agent = await loggedIn();

		const response = await savePreference(agent, "   ");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue?tab=my&feature=my&edit=1&invalid=1");
	});

	it("should explain the rejection on the followed redirect", async () => {
		const agent = await loggedIn();
		const rejected = await savePreference(agent, "   ");

		const doc = parse((await agent.get(rejected.headers.location)).text);

		const error = doc.querySelector("[data-test-my-error]");
		assert(error, "the form must explain why the save was rejected");
		expect(error.textContent).toBe("Write a sentence or two about what you want to read.");
	});

	it("should reject a preference longer than the field allows", async () => {
		const agent = await loggedIn();

		const response = await savePreference(agent, "a".repeat(2001));

		expect(response.headers.location).toBe("/queue?tab=my&feature=my&edit=1&invalid=1");
	});

	it("should send the reader to the plain queue when the feature flag is absent", async () => {
		const agent = await loggedIn();

		const response = await agent
			.post("/queue/my-readplace")
			.type("form")
			.send({ text: PREFERENCE_TEXT });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue");
	});

	it("should send an unauthenticated save to the login page", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server)
			.post("/queue/my-readplace?feature=my")
			.type("form")
			.send({ text: PREFERENCE_TEXT });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login");
	});
});

describe("GET /queue?tab=my&feature=my&edit=1", () => {
	it("should prefill the form with the saved preference", async () => {
		const agent = await loggedIn();
		await savePreference(agent, PREFERENCE_TEXT);

		const doc = parse((await agent.get("/queue?tab=my&feature=my&edit=1")).text);

		const section = doc.querySelector("[data-test-my-readplace]");
		assert(section, "the My Readplace section must render");
		expect(section.getAttribute("data-test-my-mode")).toBe("edit");
		expect(doc.querySelector("textarea[name='text']")?.textContent).toBe(PREFERENCE_TEXT);
	});

	it("should offer a cancel route back to the summary", async () => {
		const agent = await loggedIn();
		await savePreference(agent, PREFERENCE_TEXT);

		const doc = parse((await agent.get("/queue?tab=my&feature=my&edit=1")).text);

		const cancel = doc.querySelector('[data-test-action="cancel-my-readplace"]');
		assert(cancel, "the edit form must offer a cancel action");
		expect(cancel.getAttribute("href")).toBe(MY_TAB_PATH);
	});
});

describe("GET /queue/counts", () => {
	it("should leave the To Read tab inactive and flagged while the reader is on My Readplace", async () => {
		const agent = await loggedIn();

		const response = await agent.get("/queue/counts?tab=my&feature=my");

		const unread = parseFragment(response.text).querySelector('[data-test-filter="unread"]');
		assert(unread, "the counts fragment must re-render the To Read tab");
		expect(unread.className).toBe("queue__filter-link");
		expect(queryOf(unread.getAttribute("href")).get("feature")).toBe("my");
	});

	it("should fall back to the listing counts when tab=my arrives without the flag", async () => {
		const agent = await loggedIn();

		const response = await agent.get("/queue/counts?tab=my");

		const unread = parseFragment(response.text).querySelector('[data-test-filter="unread"]');
		assert(unread, "the counts fragment must re-render the To Read tab");
		expect(unread.className).toBe("queue__filter-link queue__filter-link--active");
	});

	it("should keep the To Read tab active and flagged on the list view", async () => {
		const agent = await loggedIn();

		const response = await agent.get("/queue/counts?feature=my");

		const unread = parseFragment(response.text).querySelector('[data-test-filter="unread"]');
		assert(unread, "the counts fragment must re-render the To Read tab");
		expect(unread.className).toBe("queue__filter-link queue__filter-link--active");
		expect(queryOf(unread.getAttribute("href")).get("feature")).toBe("my");
	});
});

describe("queue mutations with the feature flag", () => {
	it("should keep the flag on the redirect after marking an article read", async () => {
		const agent = await loggedIn();
		await agent.post("/queue/save").type("form").send({ url: "https://example.com/post" });
		const listing = parse((await agent.get("/queue?feature=my")).text);
		const articleId = listing
			.querySelector("[data-test-article-list] .queue-article")
			?.getAttribute("data-test-article");
		assert(articleId, "a saved article must be listed before it can be marked read");

		const response = await agent
			.post(`/queue/${articleId}/status?feature=my`)
			.type("form")
			.send({ status: "read" });

		expect(queryOf(response.headers.location).get("feature")).toBe("my");
	});
});
