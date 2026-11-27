import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { READLIST_MAX_PER_USER, ReadlistSlugSchema } from "@packages/domain/readlist";
import { ALIVE_COOKIE_NAME, ALIVE_COOKIE_VALUE, SAVE_COOKIE_NAME, SAVE_COOKIE_VALUE, DISMISS_COOKIE_NAME } from "@packages/onboarding-extension-signal";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();
const slug = ReadlistSlugSchema.parse("ideas");
const chrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36";
const cookies = `${ALIVE_COOKIE_NAME}=${ALIVE_COOKIE_VALUE}; ${SAVE_COOKIE_NAME}=${SAVE_COOKIE_VALUE}`;
const step = '[data-test-onboarding-step="create-smart-readlist"]';
const prefs = "/queue/queues/ideas/preferences";

async function setup() {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const count = jest.spyOn(fixture.articleStore, "countSmartReadlistArticles").mockResolvedValue(9);
	const write = jest.spyOn(fixture.onboardingSignals, "recordSmartReadlistMinimumReached");
	const read = jest.spyOn(fixture.onboardingSignals, "getOnboardingSignals");
	const app = useApp(fixture);
	const agent = await loginAgent(app.server, app.auth);
	const user = await app.auth.findUserByEmail("test@example.com");
	assert(user);
	const { userId } = user;
	await fixture.articleStore.createReadlistDefinition({ userId, slug, label: "Ideas", createdAt: new Date() });
	await fixture.articleStore.setSmartReadlistRule({ userId, slug, purpose: "Ideas to explore", effectiveAt: new Date() });
	await fixture.onboardingSignals.recordEmailStepMarkedDone({ userId });
	await fixture.onboardingSignals.recordNextReadMinimumReached({ userId });
	const view = async (path: string, cookie = cookies, ua = chrome) => {
		const response = await agent.get(path).set("User-Agent", ua).set("Cookie", cookie);
		expect(response.status).toBe(200);
		return new JSDOM(response.text).window.document;
	};
	return { fixture, app, agent, count, write, read, userId, view };
}

describe("Smart Readlist guide", () => {
	it.each(["/queue", prefs])("reopens a dismissed guide at nine and honors dismissal again at ten on %s", async (path) => {
		const { count, write, view } = await setup();
		const dismissed = `${cookies}; ${DISMISS_COOKIE_NAME}=fd8f9d8a`;
		const nine = await view(path, dismissed);
		expect(nine.querySelector(".setup-guide--visible")?.querySelector(step)?.textContent).toContain("9/10");
		count.mockResolvedValue(10);
		const ten = await view(path, dismissed);
		expect(ten.querySelector(step)).toBeNull();
		expect(ten.querySelector(".setup-guide--hidden")).toBeTruthy();
		const phone = await view("/queue", "", "iPhone");
		expect(phone.querySelector(step)).toBeNull();
		expect(write).toHaveBeenCalledTimes(1);
		expect(count).toHaveBeenCalledTimes(2);
	});

	it.each([["/queue", "open-smart-readlist"], [prefs, "open-all"]])("offers no way to opt out of the step on %s, so every reader tries a Smart Readlist", async (path, primary) => {
		const { view } = await setup();
		const row = (await view(path)).querySelector(step);
		assert(row, "the Smart Readlist step must be rendered");
		const actions = Array.from(row.querySelectorAll("[data-test-onboarding-action]"), (el) => el.getAttribute("data-test-onboarding-action"));
		expect(actions).toEqual([primary]);
	});

	it.each(["initial row", "count"] as const)("a failed first %s read cannot earn success on retry", async (failure) => {
		const { count, read, view } = await setup();
		count.mockResolvedValue(10);
		(failure === "initial row" ? read : count).mockRejectedValueOnce(new Error("read interrupted"));
		const unknown = await view(prefs);
		expect(unknown.querySelector(step)?.textContent).toContain("Progress unavailable");
		const ten = await view("/queue");
		expect(ten.querySelector(".setup-guide--complete")).toBeNull();
		expect(ten.querySelector(".setup-guide--hidden")).toBeTruthy();
	});

	it("awards an earned welcome after nine, and confirms a write whose reply was lost", async () => {
		const { count, write, fixture, view } = await setup();
		await view("/queue");
		count.mockResolvedValue(10);
		const persist = write.getMockImplementation();
		assert(persist);
		write.mockImplementationOnce(async (params) => {
			await persist(params);
			throw new Error("reply lost");
		});
		expect((await view(prefs)).querySelector(".setup-guide--complete")).toBeTruthy();
		expect(fixture.onboardingSignals.recordSmartReadlistMinimumReached).toHaveBeenCalledTimes(1);
	});

	it("leaves a failed stamp unearned if the tenth article disappears", async () => {
		const { count, write, view } = await setup();
		count.mockResolvedValueOnce(10);
		write.mockRejectedValueOnce(new Error("write failed"));
		const unknown = await view(prefs, `${cookies}; ${DISMISS_COOKIE_NAME}=fd8f9d8a`);
		expect(unknown.querySelector(".setup-guide--hidden")).toBeTruthy();
		expect((await view("/queue")).querySelector(step)?.textContent).toContain("9/10");
	});

	it("uses the active or first navigable list at the readlist limit", async () => {
		const { fixture, userId, view, count } = await setup();
		await fixture.articleStore.turnOffSmartReadlistMatching({ userId, slug });
		const pinned = ReadlistSlugSchema.parse("list-1");
		for (let i = 1; i < READLIST_MAX_PER_USER; i++) {
			await fixture.articleStore.createReadlistDefinition({ userId, slug: ReadlistSlugSchema.parse(`list-${i}`), label: `List ${i}`, createdAt: new Date() });
		}
		await fixture.articleStore.pinReadlistDefinition({ userId, slug: pinned, pinnedAt: new Date() });
		const action = (doc: Document) => doc.querySelector(step)?.querySelector('form')?.getAttribute("action");
		expect(action(await view("/queue"))).toBe("/queue/queues/list-1/preferences#readlist-smart");
		expect(action(await view(prefs))).toBe(`${prefs}#readlist-smart`);
		expect(count).not.toHaveBeenCalled();
	});

	it("keeps a dismissed no-client notice closed on an unknown count and restores the task on retry", async () => {
		const { count, view } = await setup();
		count.mockRejectedValueOnce(new Error("temporarily unavailable"));
		const cookie = `${DISMISS_COOKIE_NAME}=no-client`;
		expect((await view("/queue", cookie, "unrecognised")).querySelector(".setup-guide--visible")).toBeNull();
		expect((await view(prefs, cookie, "unrecognised")).querySelector(".setup-guide--visible")?.querySelector(step)).toBeTruthy();
	});

	it("sends a reader whose purpose was removed to make it a Smart Readlist, without counting it", async () => {
		const { fixture, userId, view, count } = await setup();
		await fixture.articleStore.turnOffSmartReadlistMatching({ userId, slug });
		expect((await fixture.articleStore.listReadlistDefinitions(userId)).find((list) => list.slug === slug)?.filing).toEqual({ mode: "manual" });
		const doc = await view("/queue");
		const row = doc.querySelector(step);
		expect(row?.textContent).toContain("0/10");
		expect(row?.textContent).toContain("choose “Make this a Smart Readlist”");
		expect(row?.querySelector('[data-test-onboarding-action="set-preferences"]')?.closest("form")?.getAttribute("action")).toBe(`${prefs}#readlist-smart`);
		expect(count).not.toHaveBeenCalled();
		const target = await view(`${prefs}#readlist-smart`);
		expect(target.getElementById("readlist-smart")?.querySelector('[data-test-form="smart-convert"]')).toBeTruthy();
	});

	it("skips membership reads for Siren, matching turned off and free access, and resumes on re-upgrade", async () => {
		const { app, fixture, userId, agent, count, view } = await setup();
		const client = await app.oauthModel.getClient("hutch-firefox-extension", "");
		assert(client);
		const token = await app.oauthModel.saveToken({
			accessToken: "smart-readlist-test", accessTokenExpiresAt: new Date(Date.now() + 3600000),
			client, user: { id: userId },
		}, client, { id: userId });
		assert(token);
		for (const path of ["/queue", prefs]) {
			await agent.get(path).set("Authorization", `Bearer ${token.accessToken}`).set("Accept", "application/vnd.siren+json").expect(200);
		}
		await app.subscriptionProviders.upsertTrialing({ userId, trialEndsAt: new Date(Date.now() - 86400000).toISOString() });
		expect((await view("/queue")).querySelector(step)).toBeNull();
		await app.subscriptionProviders.upsertTrialing({ userId, trialEndsAt: new Date(Date.now() + 86400000).toISOString() });
		await fixture.articleStore.turnOffSmartReadlistMatching({ userId, slug });
		const empty = (await view(prefs)).querySelector(step);
		expect(empty?.textContent).toContain("0/10");
		expect(count).not.toHaveBeenCalled();
		await fixture.articleStore.setSmartReadlistRule({ userId, slug, purpose: "Restored", effectiveAt: new Date() });
		expect((await view(prefs)).querySelector(step)?.textContent).toContain("9/10");
	});
});
