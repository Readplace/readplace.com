import assert from "node:assert/strict";
import { READLIST_LABEL_MAX_LENGTH, READLIST_MAX_PER_USER } from "@packages/domain/readlist";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { JSDOM } from "jsdom";
import request from "supertest";
import { z } from "zod";
import { loginAgent, useTestServer } from "../../../test-app";
import { seedInto } from "../../test-helpers/readlist-seed";

const useApp = useTestServer();
const DAY = 86_400_000;
const UNKNOWN_ARTICLE = "ffffffffffffffffffffffffffffffff";

type TestAgent = Awaited<ReturnType<typeof loginAgent>>;

function parse(html: string): Document {
	return new JSDOM(html).window.document;
}

async function createReadlist(agent: TestAgent, label: string): Promise<string> {
	const response = await agent.post("/queue/queues").type("form").send({ label });
	const slug = new URL(response.headers.location, TEST_APP_ORIGIN).searchParams.get("queue");
	assert(slug, "creating a readlist must land the reader on it");
	return slug;
}

async function articleIdOn(agent: TestAgent, input: { path: string; url: string }): Promise<string> {
	const doc = parse((await agent.get(input.path)).text);
	const card = Array.from(doc.querySelectorAll("[data-test-article]")).find(
		(el) => el.querySelector("[data-test-article-url]")?.getAttribute("href") === input.url,
	);
	const id = card?.getAttribute("data-test-article");
	assert(id, `the card for ${input.url} must render on ${input.path}`);
	return id;
}

async function saveArticle(agent: TestAgent, url: string): Promise<string> {
	await agent.post("/queue/save").type("form").send({ url });
	return articleIdOn(agent, { path: "/queue", url });
}

async function fileInto(agent: TestAgent, input: { articleId: string; readlist: string }): Promise<void> {
	const response = await agent
		.post(`/queue/${input.articleId}/assign`)
		.type("form")
		.send({ queue: input.readlist, returnTo: "/queue" });
	expect(response.status).toBe(303);
}

function moveArticle(
	agent: TestAgent,
	input: { articleId: string; query?: string; from: string; to: string },
): request.Test {
	return agent
		.post(`/queue/${input.articleId}/move${input.query ?? ""}`)
		.type("form")
		.send({ from: input.from, to: input.to });
}

function createAndMove(
	agent: TestAgent,
	input: { action: string; from: string; label: string; htmx: boolean },
): request.Test {
	const post = agent.post(input.action).type("form");
	return (input.htmx ? post.set("HX-Request", "true") : post).send({ from: input.from, label: input.label });
}

const HxLocationSchema = z
	.object({ path: z.string(), source: z.string(), target: z.string(), select: z.string(), swap: z.string() })
	.strict();

function hxLocation(response: { headers: Record<string, string> }): z.infer<typeof HxLocationSchema> {
	const header = response.headers["hx-location"];
	assert(header, "the dialog's answer must tell htmx where to land");
	return HxLocationSchema.parse(JSON.parse(header));
}

function movedTo(location: string): string {
	const slug = new URL(location, TEST_APP_ORIGIN).searchParams.get("moved_to");
	assert(slug, "a landing after a move must name the readlist the article went to");
	return slug;
}

function listedArticleIds(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll("[data-test-article-list] [data-test-article]"), (el) =>
		el.getAttribute("data-test-article"),
	);
}

async function listing(agent: TestAgent, path: string): Promise<Document> {
	const response = await agent.get(path);
	expect(response.status).toBe(200);
	return parse(response.text);
}

async function listedOn(agent: TestAgent, path: string): Promise<(string | null)[]> {
	return listedArticleIds(await listing(agent, path));
}

async function readlistLabels(agent: TestAgent): Promise<(string | null)[]> {
	return Array.from((await listing(agent, "/queue")).querySelectorAll("[data-test-readlist]"), (el) => el.textContent);
}

function toastMessage(doc: Document): string | null | undefined {
	return doc.querySelector("#status-toast [data-test-toast-message]")?.textContent;
}

function toastUndo(doc: Document): { action: string; fields: Record<string, string | null> } {
	const form = doc.querySelector("#status-toast [data-test-toast-action]")?.closest("form");
	assert(form, "the toast must offer its Undo as a form");
	const action = form.getAttribute("action");
	assert(action, "the Undo form must post somewhere");
	return {
		action,
		fields: Object.fromEntries(
			Array.from(form.querySelectorAll("input[type='hidden']"), (input) => [
				input.getAttribute("name"),
				input.getAttribute("value"),
			]),
		),
	};
}

async function undo(agent: TestAgent, location: string): Promise<request.Response> {
	const { action, fields } = toastUndo(await listing(agent, location));
	return agent.post(action).type("form").send(fields);
}

function cardMenuControls(doc: Document, articleId: string): (string | null)[] {
	const card = doc.querySelector(`[data-test-article="${articleId}"]`);
	assert(card, `the card for ${articleId} must render`);
	return Array.from(card.querySelectorAll("[data-test-article-menu] .menu__panel [data-test-action]"), (control) =>
		control.getAttribute("data-test-action"),
	);
}

function moveTrigger(doc: Document, articleId: string): Element {
	const trigger = doc.querySelector(`[data-test-article="${articleId}"] [data-test-action="move"]`);
	assert(trigger, `the card for ${articleId} must offer a move`);
	return trigger;
}

function destinationsOf(doc: Document, popoverId: string | null): (string | null)[] {
	const dialog = doc.querySelector(`[data-test-confirm-popover="move"][id="${popoverId}"]`);
	assert(dialog, `the page must render the dialog ${popoverId}`);
	return Array.from(dialog.querySelectorAll("[data-test-move-destination]"), (row) =>
		row.getAttribute("data-test-move-destination"),
	);
}

function moveDialogIds(doc: Document): string[] {
	return Array.from(
		doc.querySelectorAll('[data-test-confirm-popover="move"], [data-test-confirm-popover="readlist-create-move"]'),
		(dialog) => dialog.id,
	);
}

function createAndMoveAction(doc: Document, articleId: string): string {
	const form = doc.querySelector(`#readlist-create-move-${articleId} form[data-test-form="readlist-create-move"]`);
	assert(form, `the page must render the create dialog for ${articleId}`);
	const action = form.getAttribute("hx-post");
	assert(action, "the create dialog must post through htmx");
	expect(form.getAttribute("action")).toBe(action);
	return action;
}

async function makeReadOnly(harness: ReturnType<typeof useApp>): Promise<void> {
	const user = await harness.auth.findUserByEmail("test@example.com");
	assert(user, "the signed-in reader must exist");
	await harness.subscriptionProviders.upsertActive({
		userId: user.userId,
		subscriptionId: "sub_move",
		customerId: "cus_move",
	});
	await harness.subscriptionProviders.markCancelledByUserId({ userId: user.userId });
}

describe("POST /queue/:id/move", () => {
	describe("moving and adding", () => {
		it("moves an article out of one custom readlist and onto the top of another", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const weekend = await createReadlist(agent, "Weekend");
			const finance = await createReadlist(agent, "Finance");
			const moving = await saveArticle(agent, "https://example.com/moving");
			const staying = await saveArticle(agent, "https://example.com/staying");
			await fileInto(agent, { articleId: moving, readlist: weekend });
			await fileInto(agent, { articleId: staying, readlist: finance });

			const response = await moveArticle(agent, {
				articleId: moving,
				query: `?queue=${weekend}`,
				from: weekend,
				to: finance,
			});

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe(
				`/queue?queue=${weekend}&moved_article=${moving}&moved_from=${weekend}&moved_to=${finance}`,
			);
			expect(await listedOn(agent, `/queue?queue=${weekend}`)).toEqual([]);
			expect(await listedOn(agent, `/queue?queue=${finance}`)).toEqual([moving, staying]);
			expect(await listedOn(agent, "/queue")).toEqual([staying, moving]);
		});

		it("keeps an article's read state when it moves", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const weekend = await createReadlist(agent, "Weekend");
			const finance = await createReadlist(agent, "Finance");
			const articleId = await saveArticle(agent, "https://example.com/read");
			await fileInto(agent, { articleId, readlist: weekend });
			await agent.post(`/queue/${articleId}/status?queue=${weekend}`).type("form").send({ status: "read" });

			await moveArticle(agent, { articleId, query: `?queue=${weekend}&tab=done`, from: weekend, to: finance });

			expect(await listedOn(agent, `/queue?queue=${finance}&tab=done`)).toEqual([articleId]);
			expect(await listedOn(agent, `/queue?queue=${finance}`)).toEqual([]);
		});

		it("adds an article from All to a readlist without taking it out of All", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const finance = await createReadlist(agent, "Finance");
			const articleId = await saveArticle(agent, "https://example.com/added");

			const response = await moveArticle(agent, { articleId, from: "default", to: finance });

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe(
				`/queue?moved_article=${articleId}&moved_from=default&moved_to=${finance}`,
			);
			expect(await listedOn(agent, "/queue")).toEqual([articleId]);
			expect(await listedOn(agent, `/queue?queue=${finance}`)).toEqual([articleId]);
		});

		it("confirms a move with a toast whose Undo posts the move back to the page the reader was on", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const weekend = await createReadlist(agent, "Weekend");
			const finance = await createReadlist(agent, "Finance & Tax");
			const articleId = await saveArticle(agent, "https://example.com/toast");
			await fileInto(agent, { articleId, readlist: weekend });

			const moved = await moveArticle(agent, {
				articleId,
				query: `?queue=${weekend}`,
				from: weekend,
				to: finance,
			});
			const doc = await listing(agent, moved.headers.location);

			expect(toastMessage(doc)).toBe("Moved to Finance & Tax");
			expect(toastUndo(doc)).toEqual({
				action: `/queue/${articleId}/move?queue=${weekend}&utm_source=queue-toast&utm_medium=internal&utm_content=undo-move`,
				fields: { from: finance, to: weekend },
			});
		});

		it("confirms an add with a toast whose Undo takes the article back out of the readlist", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const finance = await createReadlist(agent, "Finance");
			const articleId = await saveArticle(agent, "https://example.com/toast-add");

			const added = await moveArticle(agent, { articleId, from: "default", to: finance });
			const doc = await listing(agent, added.headers.location);

			expect(toastMessage(doc)).toBe("Added to Finance");
			expect(toastUndo(doc)).toEqual({
				action: `/queue/${articleId}/move?utm_source=queue-toast&utm_medium=internal&utm_content=undo-move`,
				fields: { from: finance, to: "default" },
			});
		});

		it("undoes a move by moving the article back", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const weekend = await createReadlist(agent, "Weekend");
			const finance = await createReadlist(agent, "Finance");
			const articleId = await saveArticle(agent, "https://example.com/undo-move");
			await fileInto(agent, { articleId, readlist: weekend });
			const moved = await moveArticle(agent, {
				articleId,
				query: `?queue=${weekend}`,
				from: weekend,
				to: finance,
			});

			const undone = await undo(agent, moved.headers.location);

			expect(undone.status).toBe(303);
			expect(await listedOn(agent, `/queue?queue=${weekend}`)).toEqual([articleId]);
			expect(await listedOn(agent, `/queue?queue=${finance}`)).toEqual([]);
			expect(toastMessage(await listing(agent, undone.headers.location))).toBe("Moved to Weekend");
		});

		it("undoes an add by taking the article back out of the readlist and says so", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const finance = await createReadlist(agent, "Finance");
			const articleId = await saveArticle(agent, "https://example.com/undo-add");
			const added = await moveArticle(agent, { articleId, from: "default", to: finance });

			const undone = await undo(agent, added.headers.location);

			expect(undone.status).toBe(303);
			expect(await listedOn(agent, `/queue?queue=${finance}`)).toEqual([]);
			expect(await listedOn(agent, "/queue")).toEqual([articleId]);
			const doc = await listing(agent, undone.headers.location);
			expect(toastMessage(doc)).toBe("Removed from Finance");
			expect(toastUndo(doc).fields).toEqual({ from: "default", to: finance });
		});

		it("copies the article back into All when a move back to All finds its All copy gone", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const finance = await createReadlist(agent, "Finance");
			await seedInto(harness, { readlist: finance, url: "https://example.com/all-gone" });
			const articleId = await articleIdOn(agent, {
				path: `/queue?queue=${finance}`,
				url: "https://example.com/all-gone",
			});
			expect(await listedOn(agent, "/queue")).toEqual([]);

			await moveArticle(agent, { articleId, query: `?queue=${finance}`, from: finance, to: "default" });

			expect(await listedOn(agent, "/queue")).toEqual([articleId]);
			expect(await listedOn(agent, `/queue?queue=${finance}`)).toEqual([]);
		});
	});

	describe("creating a readlist to move into", () => {
		it("creates the readlist, adds the article and lands back on the listing without scrolling", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const articleId = await saveArticle(agent, "https://example.com/create-and-add");
			const action = createAndMoveAction(await listing(agent, "/queue"), articleId);

			const response = await createAndMove(agent, { action, from: "default", label: "Finance", htmx: true });

			expect(response.status).toBe(204);
			expect(response.text).toBe("");
			const landing = hxLocation(response);
			const made = movedTo(landing.path);
			expect(landing).toEqual({
				path: `/queue?utm_source=queue-card&utm_medium=internal&utm_content=create-and-move&moved_article=${articleId}&moved_from=default&moved_to=${made}`,
				source: `#readlist-create-move-${articleId}`,
				target: "main",
				select: "main",
				swap: "outerHTML show:none",
			});
			expect(await readlistLabels(agent)).toEqual(["All", "Finance"]);
			expect(await listedOn(agent, `/queue?queue=${made}`)).toEqual([articleId]);
			expect(await listedOn(agent, "/queue")).toEqual([articleId]);
			expect(toastMessage(await listing(agent, landing.path))).toBe("Added to Finance");
		});

		it("creates the readlist and moves the article out of the one it was in", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const weekend = await createReadlist(agent, "Weekend");
			const articleId = await saveArticle(agent, "https://example.com/create-and-move");
			await fileInto(agent, { articleId, readlist: weekend });
			const action = createAndMoveAction(await listing(agent, `/queue?queue=${weekend}`), articleId);

			const response = await createAndMove(agent, { action, from: weekend, label: "Finance", htmx: true });

			const { path } = hxLocation(response);
			const made = movedTo(path);
			expect(path).toBe(
				`/queue?queue=${weekend}&utm_source=queue-card&utm_medium=internal&utm_content=create-and-move&moved_article=${articleId}&moved_from=${weekend}&moved_to=${made}`,
			);
			expect(await listedOn(agent, `/queue?queue=${weekend}`)).toEqual([]);
			expect(await listedOn(agent, `/queue?queue=${made}`)).toEqual([articleId]);
			expect(toastMessage(await listing(agent, path))).toBe("Moved to Finance");
		});

		it("follows the same landing with a 303 for a browser without JavaScript", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const articleId = await saveArticle(agent, "https://example.com/create-no-js");
			const action = createAndMoveAction(await listing(agent, "/queue"), articleId);

			const response = await createAndMove(agent, { action, from: "default", label: "Finance", htmx: false });

			const made = movedTo(response.headers.location);
			expect(response.status).toBe(303);
			expect(response.headers.location).toBe(
				`/queue?utm_source=queue-card&utm_medium=internal&utm_content=create-and-move&moved_article=${articleId}&moved_from=default&moved_to=${made}`,
			);
			expect(await listedOn(agent, `/queue?queue=${made}`)).toEqual([articleId]);
			expect(await readlistLabels(agent)).toEqual(["All", "Finance"]);
		});

		it("re-renders the dialog's form for a refused name, keeping what the reader typed and the readlist the article leaves", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const finance = await createReadlist(agent, "Finance");
			const articleId = await saveArticle(agent, "https://example.com/refused");
			const action = createAndMoveAction(await listing(agent, "/queue"), articleId);

			const answers = [];
			for (const label of ["   ", "All", "finance"]) {
				const response = await createAndMove(agent, { action, from: "default", label, htmx: true });
				const form = parse(response.text).querySelector('form[data-test-form="readlist-create-move"]');
				assert(form, "a refused name must answer with the dialog's form");
				const input = form.querySelector("[data-test-readlist-create-move-input]");
				assert(input, "the re-rendered form must carry the name field");
				answers.push({
					status: response.status,
					contentType: response.headers["content-type"],
					action: form.getAttribute("action"),
					post: form.getAttribute("hx-post"),
					from: form.querySelector("input[type='hidden'][name='from']")?.getAttribute("value"),
					inputId: input.id,
					value: input.getAttribute("value"),
					invalid: input.getAttribute("aria-invalid"),
					error: form.querySelector("[data-test-readlist-create-move-error]")?.textContent,
				});
			}

			const refused = {
				status: 422,
				contentType: "text/html; charset=utf-8",
				action,
				post: action,
				from: "default",
				inputId: `readlist-create-move-${articleId}-name`,
				invalid: "true",
			};
			expect(answers).toEqual([
				{ ...refused, value: "   ", error: `Give the readlist a name of ${READLIST_LABEL_MAX_LENGTH} characters or fewer.` },
				{ ...refused, value: "All", error: "Pick a name other than All, the readlist that holds every save." },
				{ ...refused, value: "finance", error: "You already have a readlist with that name, so pick another one." },
			]);
			expect(await readlistLabels(agent)).toEqual(["All", "Finance"]);
			expect(await listedOn(agent, `/queue?queue=${finance}`)).toEqual([]);
		});

		it("sends a browser without JavaScript to the page alert for a refused name, writing nothing", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const finance = await createReadlist(agent, "Finance");
			const articleId = await saveArticle(agent, "https://example.com/refused-no-js");

			const locations = [];
			for (const label of ["   ", "All", "finance"]) {
				const response = await createAndMove(agent, {
					action: `/queue/${articleId}/move?queue=${finance}`,
					from: "default",
					label,
					htmx: false,
				});
				locations.push([response.status, response.headers.location]);
			}

			expect(locations).toEqual([
				[303, `/queue?queue=${finance}&queue_error=create_invalid-name`],
				[303, `/queue?queue=${finance}&queue_error=create_reserved-name`],
				[303, `/queue?queue=${finance}&queue_error=create_name-taken`],
			]);
			expect(await readlistLabels(agent)).toEqual(["All", "Finance"]);
			expect(await listedOn(agent, `/queue?queue=${finance}`)).toEqual([]);
		});

		it("sends the dialog to the limit alert at the top of the page when the reader is at the cap", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const articleId = await saveArticle(agent, "https://example.com/at-the-cap");
			for (let index = 1; index <= READLIST_MAX_PER_USER; index += 1) {
				await createReadlist(agent, `Readlist ${index}`);
			}
			const action = `/queue/${articleId}/move`;

			const dialog = await createAndMove(agent, { action, from: "default", label: "One Too Many", htmx: true });
			const browser = await createAndMove(agent, { action, from: "default", label: "One Too Many", htmx: false });

			expect(dialog.status).toBe(204);
			expect(hxLocation(dialog)).toEqual({
				path: "/queue?queue_error=limit",
				source: `#readlist-create-move-${articleId}`,
				target: "main",
				select: "main",
				swap: "outerHTML show:none scroll:html:top",
			});
			expect(browser.status).toBe(303);
			expect(browser.headers.location).toBe("/queue?queue_error=limit");
			expect(await readlistLabels(agent)).toHaveLength(READLIST_MAX_PER_USER + 1);
		});

		it("lands back where the reader was, creating nothing, for an article that is gone", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const weekend = await createReadlist(agent, "Weekend");

			const response = await createAndMove(agent, {
				action: `/queue/${UNKNOWN_ARTICLE}/move?queue=${weekend}`,
				from: weekend,
				label: "Finance",
				htmx: true,
			});

			expect(response.status).toBe(204);
			expect(hxLocation(response)).toEqual({
				path: `/queue?queue=${weekend}`,
				source: `#readlist-create-move-${UNKNOWN_ARTICLE}`,
				target: "main",
				select: "main",
				swap: "outerHTML show:none",
			});
			expect(await readlistLabels(agent)).toEqual(["All", "Weekend"]);
		});

		it("lands back where the reader was, creating nothing, when the readlist it leaves no longer holds the article", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const weekend = await createReadlist(agent, "Weekend");
			const articleId = await saveArticle(agent, "https://example.com/stale-create");

			const dialog = await createAndMove(agent, {
				action: `/queue/${articleId}/move?queue=${weekend}`,
				from: weekend,
				label: "Finance",
				htmx: true,
			});
			const browser = await createAndMove(agent, {
				action: `/queue/${articleId}/move?queue=${weekend}`,
				from: weekend,
				label: "Finance",
				htmx: false,
			});

			expect(hxLocation(dialog)).toEqual({
				path: `/queue?queue=${weekend}`,
				source: `#readlist-create-move-${articleId}`,
				target: "main",
				select: "main",
				swap: "outerHTML show:none",
			});
			expect(browser.status).toBe(303);
			expect(browser.headers.location).toBe(`/queue?queue=${weekend}`);
			expect(await readlistLabels(agent)).toEqual(["All", "Weekend"]);
		});
	});

	describe("refusals", () => {
		it("sends a destination the reader does not own to the readlist-not-found alert, writing nothing", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const articleId = await saveArticle(agent, "https://example.com/unknown-destination");

			const response = await moveArticle(agent, { articleId, from: "default", to: "gone" });

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue?queue_error=unknown_readlist");
			const doc = await listing(agent, response.headers.location);
			expect(doc.querySelector('[data-test-alert="readlist"] [data-test-alert-title]')?.textContent).toBe(
				"Readlist not found",
			);
			expect(listedArticleIds(doc)).toEqual([articleId]);
		});

		it("quietly re-renders the return page when the destination already holds the article", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const finance = await createReadlist(agent, "Finance");
			const articleId = await saveArticle(agent, "https://example.com/double-submit");
			await moveArticle(agent, { articleId, from: "default", to: finance });

			const response = await moveArticle(agent, { articleId, query: "?tab=done", from: "default", to: finance });

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue?tab=done");
			expect(await listedOn(agent, `/queue?queue=${finance}`)).toEqual([articleId]);
		});

		it("quietly re-renders the return page when asked to move an article into the readlist it is in", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const finance = await createReadlist(agent, "Finance");
			const articleId = await saveArticle(agent, "https://example.com/same");
			await fileInto(agent, { articleId, readlist: finance });

			const response = await moveArticle(agent, {
				articleId,
				query: `?queue=${finance}`,
				from: finance,
				to: finance,
			});

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe(`/queue?queue=${finance}`);
			expect(await listedOn(agent, `/queue?queue=${finance}`)).toEqual([articleId]);
		});

		it("quietly re-renders the return page when the source no longer holds the article", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const weekend = await createReadlist(agent, "Weekend");
			const finance = await createReadlist(agent, "Finance");
			const articleId = await saveArticle(agent, "https://example.com/stale");

			const response = await moveArticle(agent, {
				articleId,
				query: `?queue=${weekend}`,
				from: weekend,
				to: finance,
			});

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe(`/queue?queue=${weekend}`);
			expect(await listedOn(agent, `/queue?queue=${finance}`)).toEqual([]);
		});

		it("returns an unknown article to the page it came from", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const finance = await createReadlist(agent, "Finance");

			const response = await moveArticle(agent, {
				articleId: UNKNOWN_ARTICLE,
				query: `?queue=${finance}`,
				from: "default",
				to: finance,
			});

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe(`/queue?queue=${finance}`);
		});

		it("answers a boosted move with the 303 the listing swap follows, though it carries HX-Request", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const finance = await createReadlist(agent, "Finance");
			const articleId = await saveArticle(agent, "https://example.com/boosted");

			const response = await moveArticle(agent, { articleId, from: "default", to: finance }).set(
				"HX-Request",
				"true",
			);

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe(
				`/queue?moved_article=${articleId}&moved_from=default&moved_to=${finance}`,
			);
		});

		it("answers an article id that is not a reader hash with an empty 404", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const finance = await createReadlist(agent, "Finance");

			const response = await moveArticle(agent, { articleId: "not-an-id", from: "default", to: finance });

			expect(response.status).toBe(404);
			expect(response.text).toBe("");
		});

		it("answers a body with neither a destination nor a name with an empty 404", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const articleId = await saveArticle(agent, "https://example.com/no-destination");

			const response = await agent
				.post(`/queue/${articleId}/move`)
				.set("HX-Request", "true")
				.type("form")
				.send({ from: "default" });

			expect(response.status).toBe(404);
			expect(response.text).toBe("");
		});
	});

	describe("access", () => {
		function bothPosts(agent: TestAgent, articleId: string) {
			return [
				agent.post(`/queue/${articleId}/move`).type("form").send({ from: "default", to: "finance" }),
				agent
					.post(`/queue/${articleId}/move`)
					.set("HX-Request", "true")
					.type("form")
					.send({ from: "default", label: "Finance" }),
			];
		}

		it("sends a signed-out visitor to log in, for a form post and a dialog post alike", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const answers = [];
			for (const post of bothPosts(request(harness.server), UNKNOWN_ARTICLE)) {
				const response = await post;
				answers.push([response.status, response.headers.location]);
			}

			expect(answers).toEqual([
				[303, "/login"],
				[303, "/login"],
			]);
		});

		it("refuses a read-only visitor with the inactive redirect, writing nothing", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const finance = await createReadlist(agent, "Finance");
			const articleId = await saveArticle(agent, "https://example.com/read-only");
			await makeReadOnly(harness);

			const answers = [];
			for (const post of bothPosts(agent, articleId)) {
				const response = await post;
				answers.push([response.status, response.headers.location]);
			}

			expect(answers).toEqual([
				[303, "/queue?inactive=1"],
				[303, "/queue?inactive=1"],
			]);
			expect(await readlistLabels(agent)).toEqual(["All", "Finance"]);
			expect(await listedOn(agent, `/queue?queue=${finance}`)).toEqual([]);
		});

		it("shows a locked account the locked page, writing nothing", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			let offset = 0;
			fixture.shared.now = () => new Date(Date.now() + offset);
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);
			const finance = await createReadlist(agent, "Finance");
			const articleId = await saveArticle(agent, "https://example.com/locked");
			offset = 8 * DAY;

			const answers = [];
			for (const post of bothPosts(agent, articleId)) {
				const response = await post.set("Accept", "text/html");
				answers.push([response.status, parse(response.text).querySelector("h1")?.textContent]);
			}

			expect(answers).toEqual([
				[403, "Your account is locked"],
				[403, "Your account is locked"],
			]);
			offset = 0;
			expect(await readlistLabels(agent)).toEqual(["All", "Finance"]);
			expect(await listedOn(agent, `/queue?queue=${finance}`)).toEqual([]);
		});
	});

	describe("the redirect", () => {
		it("keeps the page the reader was on and carries the tracking and the move", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const weekend = await createReadlist(agent, "Weekend");
			const finance = await createReadlist(agent, "Finance");
			const articleId = await saveArticle(agent, "https://example.com/redirect");
			await fileInto(agent, { articleId, readlist: weekend });

			const response = await moveArticle(agent, {
				articleId,
				query: `?queue=${weekend}&tab=done&order=asc&page=2&utm_source=queue-card&utm_medium=internal&utm_content=move`,
				from: weekend,
				to: finance,
			});

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe(
				`/queue?queue=${weekend}&tab=done&order=asc&page=2&utm_source=queue-card&utm_medium=internal&utm_content=move&moved_article=${articleId}&moved_from=${weekend}&moved_to=${finance}`,
			);
		});

		it("lands a move of the last card on page 2 on page 1, still confirming it", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const weekend = await createReadlist(agent, "Weekend");
			const finance = await createReadlist(agent, "Finance");
			for (let index = 1; index <= 21; index += 1) {
				await seedInto(harness, { readlist: weekend, url: `https://example.com/page-${index}` });
			}
			const [lastOnPageTwo] = await listedOn(agent, `/queue?queue=${weekend}&page=2`);
			assert(lastOnPageTwo, "page 2 must hold one card");

			const moved = await moveArticle(agent, {
				articleId: lastOnPageTwo,
				query: `?queue=${weekend}&page=2`,
				from: weekend,
				to: finance,
			});
			const clamped = await agent.get(moved.headers.location);

			expect(clamped.status).toBe(302);
			expect(clamped.headers.location).toBe(
				`/queue?queue=${weekend}&moved_article=${lastOnPageTwo}&moved_from=${weekend}&moved_to=${finance}`,
			);
			expect(toastMessage(await listing(agent, clamped.headers.location))).toBe("Moved to Finance");
		});
	});

	describe("the card menu", () => {
		it("offers Add to readlist on All, opening a dialog that lists the readlists in rail order", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const ideas = await createReadlist(agent, "Ideas");
			const weekend = await createReadlist(agent, "Weekend");
			const finance = await createReadlist(agent, "Finance");
			const articleId = await saveArticle(agent, "https://example.com/menu-all");
			await fileInto(agent, { articleId, readlist: weekend });

			const doc = await listing(agent, "/queue");

			const trigger = moveTrigger(doc, articleId);
			expect(trigger.textContent).toBe("Add to readlist");
			expect(destinationsOf(doc, trigger.getAttribute("popovertarget"))).toEqual([ideas, finance]);
			expect(moveDialogIds(doc)).toEqual([`readlist-move-${articleId}`, `readlist-create-move-${articleId}`]);
		});

		it("offers Move to readlist on a custom readlist, leaving the readlist out of its own dialog", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const ideas = await createReadlist(agent, "Ideas");
			const weekend = await createReadlist(agent, "Weekend");
			const finance = await createReadlist(agent, "Finance");
			const articleId = await saveArticle(agent, "https://example.com/menu-custom");
			await fileInto(agent, { articleId, readlist: weekend });

			const doc = await listing(agent, `/queue?queue=${weekend}`);

			const trigger = moveTrigger(doc, articleId);
			expect(trigger.textContent).toBe("Move to readlist");
			expect(destinationsOf(doc, trigger.getAttribute("popovertarget"))).toEqual([ideas, finance]);
			expect(cardMenuControls(doc, articleId)).toEqual(["move-fallback", "move", "delete-fallback", "delete"]);
		});

		it("opens the create dialog straight from the item once every custom readlist holds the article", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const finance = await createReadlist(agent, "Finance");
			const articleId = await saveArticle(agent, "https://example.com/menu-full");
			await fileInto(agent, { articleId, readlist: finance });

			const doc = await listing(agent, "/queue");

			expect(moveTrigger(doc, articleId).getAttribute("popovertarget")).toBe(`readlist-create-move-${articleId}`);
			expect(cardMenuControls(doc, articleId)).toEqual(["move", "delete-fallback", "delete"]);
			expect(moveDialogIds(doc)).toEqual([`readlist-create-move-${articleId}`]);
		});

		it("offers only Delete at the cap once every custom readlist holds the article", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const articleId = await saveArticle(agent, "https://example.com/menu-cap");
			for (let index = 1; index <= READLIST_MAX_PER_USER; index += 1) {
				await fileInto(agent, { articleId, readlist: await createReadlist(agent, `Readlist ${index}`) });
			}

			const doc = await listing(agent, "/queue");

			expect(cardMenuControls(doc, articleId)).toEqual(["delete-fallback", "delete"]);
			expect(moveDialogIds(doc)).toEqual([]);
		});

		it("offers only Delete to a read-only account", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			await createReadlist(agent, "Finance");
			const articleId = await saveArticle(agent, "https://example.com/menu-read-only");
			await makeReadOnly(harness);

			const doc = await listing(agent, "/queue");

			expect(cardMenuControls(doc, articleId)).toEqual(["delete-fallback", "delete"]);
			expect(moveDialogIds(doc)).toEqual([]);
		});
	});
});
