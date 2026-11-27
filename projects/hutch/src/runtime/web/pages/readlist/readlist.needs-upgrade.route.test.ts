import assert from "node:assert/strict";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { JSDOM } from "jsdom";
import request from "supertest";
import { useTestServer } from "../../../test-app";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";

const useApp = useTestServer();
const ONE_DAY_MS = 86_400_000;
const WORK = ReadlistSlugSchema.parse("work");

async function setUpReader(trialEndsAt: Date) {
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
	return { agent, harness, userId: lookup.userId };
}

async function readerWithArticleAndReadlist(trialEndsAt: Date) {
	return (await setUpReader(trialEndsAt)).agent;
}

function freePlanReader() {
	return readerWithArticleAndReadlist(new Date(Date.now() - ONE_DAY_MS));
}

function page(html: string): Document {
	return new JSDOM(html).window.document;
}

function lockKeys(doc: Document): string[] {
	return Array.from(doc.querySelectorAll('button[data-test-action="upgrade-open"]'), (el) => {
		const key = el.getAttribute("data-test-needs-upgrade");
		assert(key, "a lock must name itself");
		return key;
	});
}

function articleIdOf(doc: Document): string {
	const card = doc.querySelector("[data-test-article]");
	assert(card, "the saved article must be listed");
	const articleId = card.getAttribute("data-test-article");
	assert(articleId, "the card must name its article");
	return articleId;
}

describe("a free-plan reader's queue page", () => {
	it("keeps Add link, the save skeleton, the rail's edit controls and the card's move open", async () => {
		const agent = await freePlanReader();

		const doc = page((await agent.get("/queue")).text);

		const addLink = doc.querySelector('[data-test-add-link] [data-test-action="add-link"]');
		assert(addLink, "Add link must render its real trigger");
		expect(addLink.getAttribute("popovertarget")).toBe("add-link");
		const saveInput = doc.querySelector<HTMLInputElement>('#add-link [data-test-form="save-article"] input[name="url"]');
		assert(saveInput, "the Add link dialog must render its save form");
		expect(saveInput.disabled).toBe(false);
		const skeleton = doc.querySelector("[data-test-save-skeleton]");
		assert(skeleton, "the save skeleton must render");
		expect(skeleton.classList.contains("readlist-save-skeleton--armed")).toBe(true);
		const create = doc.querySelector('[data-test-action="new-readlist"]');
		assert(create, "the rail must offer the real create row");
		const menu = doc.querySelector(`[data-test-readlist-menu="${WORK}"]`);
		assert(menu, "the custom readlist must keep its menu");
		expect(menu.querySelectorAll('[data-test-action="readlist-rename"]').length).toBeGreaterThan(0);
		const card = doc.querySelector(`[data-test-article="${articleIdOf(doc)}"]`);
		assert(card, "the card must render");
		expect(card.querySelectorAll('[data-test-action="move"]')).toHaveLength(1);
	});

	it("locks only the Inbox entry in the header nav, beside one plan chooser", async () => {
		const agent = await freePlanReader();

		const doc = page((await agent.get("/queue")).text);

		expect(lockKeys(doc)).toEqual(["inbox"]);
		const inbox = doc.querySelector('button[data-test-needs-upgrade="inbox"]');
		assert(inbox, "the Inbox entry must render as a lock");
		expect(inbox.getAttribute("popovertarget")).toBe("subscribe-plans");
		expect(doc.querySelectorAll("#subscribe-plans")).toHaveLength(1);
	});

	it("keeps a polled card's move open", async () => {
		const agent = await freePlanReader();
		const articleId = articleIdOf(page((await agent.get("/queue")).text));

		const polled = page((await agent.get(`/queue/${articleId}/card?poll=1`)).text);

		expect(polled.querySelectorAll('[data-test-action="move"]')).toHaveLength(1);
		expect(lockKeys(polled)).toEqual([]);
	});

	it("locks the readlist purpose behind the plan chooser on the preferences page", async () => {
		const agent = await freePlanReader();

		const doc = page((await agent.get(`/queue/queues/${WORK}/preferences`)).text);

		const lock = doc.querySelector('#readlist-smart button[data-test-needs-upgrade="make-smart-readlist"]');
		assert(lock, "the Smart section must carry the needs-upgrade lock");
		expect(lock.getAttribute("popovertarget")).toBe("subscribe-plans");
		expect(doc.querySelectorAll('[data-test-form="smart-convert"]')).toHaveLength(0);
		expect(doc.querySelectorAll('[data-test-action="new-readlist"]')).toHaveLength(1);
	});

	it("shows an active trial reader the purpose set-up and no lock", async () => {
		const agent = await readerWithArticleAndReadlist(new Date(Date.now() + ONE_DAY_MS));

		const doc = page((await agent.get(`/queue/queues/${WORK}/preferences`)).text);

		expect(lockKeys(doc)).toEqual([]);
		expect(doc.querySelectorAll('[data-test-form="smart-convert"]')).toHaveLength(1);
	});

	it("offers a regular readlist's Smart section no form and no lock on the iOS surface", async () => {
		const agent = await freePlanReader();

		const doc = page((await agent.get(`/queue/queues/${WORK}/preferences?platform=ios`)).text);

		const smart = doc.querySelector('#readlist-smart[data-test-smart-filing="manual"]');
		assert(smart, "the regular readlist must still render its Smart section");
		expect(smart.querySelectorAll("form")).toHaveLength(0);
		expect(smart.querySelectorAll("[data-test-needs-upgrade]")).toHaveLength(0);
	});

	it("shows a free-plan Smart Readlist its locked inboxes and its read-only Purpose card", async () => {
		const { agent, harness, userId } = await setUpReader(new Date(Date.now() - ONE_DAY_MS));
		await harness.articleStore.setSmartReadlistRule({
			userId,
			slug: WORK,
			purpose: "Essays on how teams actually ship.",
			effectiveAt: new Date(),
		});

		const doc = page((await agent.get(`/queue/queues/${WORK}/preferences`)).text);

		const inboxes = doc.querySelector("[data-test-readlist-inboxes]");
		assert(inboxes, "a Smart Readlist must render its inboxes section");
		expect(Array.from(inboxes.querySelectorAll('[data-test-action="upgrade-open"]'), (lock) => lock.getAttribute("data-test-needs-upgrade"))).toEqual(["create-inbox"]);
		const card = doc.querySelector("section[data-test-readlist-purpose]");
		assert(card, "a free-plan Smart Readlist must show its purpose read-only");
		expect(card.querySelector("[data-test-readlist-purpose-text]")?.textContent).toBe("Essays on how teams actually ship.");
		expect(doc.querySelectorAll('[data-test-action="readlist-purpose-edit"]')).toHaveLength(0);
	});

	it("keeps the save controls open on the iOS surface, where no plan chooser is offered", async () => {
		const agent = await freePlanReader();

		const doc = page((await agent.get("/queue?platform=ios")).text);

		expect(lockKeys(doc)).toEqual([]);
		expect(doc.querySelectorAll("#subscribe-plans")).toHaveLength(0);
		const saveInput = doc.querySelector<HTMLInputElement>('#add-link input[name="url"]');
		assert(saveInput, "Add link keeps its dialog");
		expect(saveInput.disabled).toBe(false);
	});
});

describe("a free-plan reader's article reader", () => {
	async function openReader(agent: Awaited<ReturnType<typeof freePlanReader>>, query: string): Promise<Document> {
		const articleId = articleIdOf(page((await agent.get("/queue")).text));
		return page((await agent.get(`/queue/${articleId}/view${query}`)).text);
	}

	it("locks Next read behind the plan chooser and requests no topic reads", async () => {
		const agent = await freePlanReader();

		const doc = await openReader(agent, "");

		const slot = doc.querySelector("[data-test-reader-related]");
		assert(slot, "the reader must render the Next read slot");
		const lock = slot.querySelector('button[data-test-needs-upgrade="next-read"]');
		assert(lock, "the Next read slot must carry the needs-upgrade lock");
		expect(lock.getAttribute("popovertarget")).toBe("subscribe-plans");
		expect(lock.textContent).toContain("Find your next read");
		expect(slot.classList.contains("next-read--ready")).toBe(true);
		expect(slot.hasAttribute("hx-get")).toBe(false);
		expect(doc.querySelectorAll("form.past-reads__request")).toHaveLength(0);
	});

	it("requests topic reads for an active trial reader and shows no Next read lock", async () => {
		const agent = await readerWithArticleAndReadlist(new Date(Date.now() + ONE_DAY_MS));

		const doc = await openReader(agent, "");

		expect(doc.querySelectorAll("form.past-reads__request")).toHaveLength(1);
		expect(doc.querySelectorAll('[data-test-needs-upgrade="next-read"]')).toHaveLength(0);
	});

	it("requests no topic reads on the iOS surface, where no plan chooser is offered", async () => {
		const agent = await freePlanReader();

		const doc = await openReader(agent, "?platform=ios");

		expect(lockKeys(doc)).toEqual([]);
		expect(doc.querySelectorAll("form.past-reads__request")).toHaveLength(0);
	});
});
