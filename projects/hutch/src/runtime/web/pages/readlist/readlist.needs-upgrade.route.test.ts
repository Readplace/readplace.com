import assert from "node:assert/strict";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { JSDOM } from "jsdom";
import request from "supertest";
import { useTestServer } from "../../../test-app";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";

const useApp = useTestServer();
const ONE_DAY_MS = 86_400_000;
const WORK = ReadlistSlugSchema.parse("work");

const FALLBACK_HREFS: Record<string, string> = {
	"create-readlist": "/account/plans?utm_source=queue-nav&utm_medium=internal&utm_content=upgrade-create-readlist",
	"rename-readlist": "/account/plans?utm_source=queue-nav&utm_medium=internal&utm_content=upgrade-rename-readlist",
	"delete-readlist": "/account/plans?utm_source=queue-nav&utm_medium=internal&utm_content=upgrade-delete-readlist",
	"move-article": "/account/plans?utm_source=queue-card&utm_medium=internal&utm_content=upgrade-move-article",
	"add-link": "/account/plans?utm_source=queue-add-link&utm_medium=internal&utm_content=upgrade-add-link",
};

async function readerWithArticleAndReadlist(trialEndsAt: Date) {
	const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
	const email = "needs-upgrade@example.com";
	await harness.auth.createUser({ email, password: "password123" });
	const lookup = await harness.auth.findUserByEmail(email);
	assert(lookup, "test user should exist");
	const agent = request.agent(harness.server);
	await agent.post("/login").type("form").send({ email, password: "password123" });
	await agent.post("/queue/save").type("form").send({ url: "https://example.com/needs-upgrade" });
	await harness.articleStore.createReadlistDefinition({
		userId: lookup.userId,
		slug: WORK,
		label: "Work",
		createdAt: new Date(),
	});
	await harness.subscriptionProviders.upsertTrialing({
		userId: lookup.userId,
		trialEndsAt: trialEndsAt.toISOString(),
	});
	return agent;
}

function expiredTrialReader() {
	return readerWithArticleAndReadlist(new Date(Date.now() - ONE_DAY_MS));
}

function page(html: string): Document {
	return new JSDOM(html).window.document;
}

function pageLockKeys(doc: Document): string[] {
	return Array.from(doc.querySelectorAll('[data-test-action="upgrade-open"]'), (el) => {
		const key = el.getAttribute("data-test-needs-upgrade");
		assert(key, "a lock must name itself");
		return key;
	}).filter((key) => key in FALLBACK_HREFS);
}

function expectLocksOpenTheChooser(doc: Document, keys: string[]) {
	for (const key of keys) {
		const trigger = doc.querySelector(`[data-test-action="upgrade-open"][data-test-needs-upgrade="${key}"]`);
		const fallback = doc.querySelector(`[data-test-action="upgrade-fallback"][data-test-needs-upgrade="${key}"]`);
		assert(trigger, `the ${key} lock must carry its trigger`);
		assert(fallback, `the ${key} lock must carry its fallback`);
		expect(trigger.getAttribute("popovertarget")).toBe("subscribe-plans");
		expect(fallback.getAttribute("href")).toBe(FALLBACK_HREFS[key]);
	}
}

describe("needs-upgrade controls on the queue page", () => {
	it("locks the rail, the card and Add link for a read-only reader on All, beside one plan chooser", async () => {
		const agent = await expiredTrialReader();

		const doc = page((await agent.get("/queue")).text);

		expect(pageLockKeys(doc)).toEqual(["rename-readlist", "delete-readlist", "create-readlist", "add-link", "move-article"]);
		expectLocksOpenTheChooser(doc, pageLockKeys(doc));
		expect(doc.querySelectorAll("#subscribe-plans")).toHaveLength(1);
		expect(doc.querySelectorAll("#add-link")).toHaveLength(0);
		expect(doc.querySelector('[data-test-needs-upgrade="move-article"] .needs-upgrade__label')?.textContent).toBe("Add to readlist");
	});

	it("locks only the rail on a custom readlist with no articles", async () => {
		const agent = await expiredTrialReader();

		const doc = page((await agent.get(`/queue?queue=${WORK}`)).text);

		expect(pageLockKeys(doc)).toEqual(["rename-readlist", "delete-readlist", "create-readlist"]);
		expect(doc.querySelectorAll("#subscribe-plans")).toHaveLength(1);
	});

	it("keeps the empty custom readlist's Beta link to its preferences beside the locks", async () => {
		const agent = await expiredTrialReader();

		const doc = page((await agent.get(`/queue?queue=${WORK}`)).text);

		const main = doc.querySelector("main");
		assert(main, "the page must have a main");
		expect(main.textContent).toContain("Set readlist preferences");
		expect(main.textContent).toContain("Beta");
	});

	it("keeps the lock on a polled card, whose chooser the page already holds", async () => {
		const agent = await expiredTrialReader();
		const listing = page((await agent.get("/queue")).text);
		const card = listing.querySelector("[data-test-article]");
		assert(card, "the saved article must be listed");
		const articleId = card.getAttribute("data-test-article");

		const polled = page((await agent.get(`/queue/${articleId}/card?poll=1`)).text);

		expect(pageLockKeys(polled)).toEqual(["move-article"]);
	});

	it("carries the rail's locks onto the preferences page, beside one plan chooser", async () => {
		const agent = await expiredTrialReader();

		const doc = page((await agent.get(`/queue/queues/${WORK}/preferences`)).text);

		const rail = doc.querySelector("[data-test-readlist-nav]");
		assert(rail, "the preferences page must render the rail");
		expect(pageLockKeys(doc)).toEqual(expect.arrayContaining(["rename-readlist", "delete-readlist", "create-readlist"]));
		expect(doc.querySelectorAll("#subscribe-plans")).toHaveLength(1);
	});

	it("shows an active trial reader the real controls and no lock", async () => {
		const agent = await readerWithArticleAndReadlist(new Date(Date.now() + ONE_DAY_MS));

		const doc = page((await agent.get("/queue")).text);

		expect(pageLockKeys(doc)).toEqual([]);
		expect(doc.querySelectorAll('[data-test-action="add-link"]')).toHaveLength(1);
		expect(doc.querySelectorAll('[data-test-action="new-readlist"]')).toHaveLength(1);
	});

	it("keeps today's withheld rendering on the iOS surface", async () => {
		const agent = await expiredTrialReader();

		const doc = page((await agent.get("/queue?platform=ios")).text);

		expect(pageLockKeys(doc)).toEqual([]);
		expect(doc.querySelectorAll("#subscribe-plans")).toHaveLength(0);
		expect(doc.querySelectorAll('[data-test-readlist-menu]')).toHaveLength(0);
		const saveInput = doc.querySelector<HTMLInputElement>('#add-link input[name="url"]');
		assert(saveInput, "the withheld Add link keeps its dialog");
		expect(saveInput.disabled).toBe(true);
	});
});
