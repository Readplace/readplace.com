import assert from "node:assert/strict";
import { READLIST_LABEL_MAX_LENGTH } from "@packages/domain/readlist";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { JSDOM } from "jsdom";
import request from "supertest";
import { z } from "zod";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();

type TestAgent = Awaited<ReturnType<typeof loginAgent>>;

function parse(html: string): Document {
	return new JSDOM(html).window.document;
}

async function createReadlist(agent: TestAgent, label: string): Promise<string> {
	const response = await agent.post("/queue/queues").type("form").send({ label });
	const slug = new URL(response.headers.location, TEST_APP_ORIGIN).searchParams.get("queue");
	assert(slug, "creating a readlist must land the reader on it, ready to name");
	return slug;
}

function dialogAction(slug: string): string {
	return `/queue/queues/${slug}/rename?utm_source=queue-nav&utm_medium=internal&utm_content=rename-readlist`;
}

async function renameFromDialog(agent: TestAgent, slug: string, label: string) {
	return agent.post(dialogAction(slug)).set("HX-Request", "true").type("form").send({ label });
}

const HxLocationSchema = z
	.object({ path: z.string(), source: z.string(), target: z.string(), select: z.string(), swap: z.string() })
	.strict();

function hxLocation(response: { headers: Record<string, string> }): z.infer<typeof HxLocationSchema> {
	const header = response.headers["hx-location"];
	assert(header, "the dialog's answer must tell htmx where to land");
	return HxLocationSchema.parse(JSON.parse(header));
}

function landingFromDialog(input: { path: string; slug: string }): z.infer<typeof HxLocationSchema> {
	return {
		path: input.path,
		source: `#readlist-rename-${input.slug}`,
		target: "main",
		select: "main",
		swap: "outerHTML show:none scroll:html:top",
	};
}

function refusedForm(response: { text: string }) {
	const form = new JSDOM(response.text).window.document.querySelector('form[data-test-form="readlist-rename"]');
	assert(form, "a refused name must answer with the rename dialog's form");
	const input = form.querySelector("[data-test-readlist-rename-input]");
	assert(input, "the re-rendered form must carry the name field");
	return {
		action: form.getAttribute("action"),
		post: form.getAttribute("hx-post"),
		value: input.getAttribute("value"),
		invalid: input.getAttribute("aria-invalid"),
		autofocus: input.hasAttribute("autofocus"),
		error: form.querySelector("[data-test-readlist-rename-error]")?.textContent,
	};
}

const BROWSER_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

async function renameFromBrowser(agent: TestAgent, slug: string, label: string) {
	return agent
		.post(`/queue/queues/${slug}/rename`)
		.set("Accept", BROWSER_ACCEPT)
		.type("form")
		.send({ label });
}

function readlistTab(doc: Document, slug: string): Element {
	const tab = doc.querySelector(`[data-test-readlist="${slug}"]`);
	assert(tab, `the ${slug} readlist must render a tab`);
	return tab;
}

describe("POST /queue/queues/:slug/rename", () => {
	it("takes the name the reader typed, says so, and sends the dialog back to the readlist's listing", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlist(agent, "New Readlist");

		const response = await renameFromDialog(agent, readlist, "Work Reading");

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toBe("text/plain; charset=utf-8");
		expect(response.text).toBe("Readlist renamed to Work Reading.");
		expect(hxLocation(response)).toEqual(landingFromDialog({ path: `/queue?queue=${readlist}`, slug: readlist }));
		const doc = parse((await agent.get("/queue")).text);
		const tab = readlistTab(doc, readlist);
		expect(tab.textContent).toBe("Work Reading");
		expect(tab.getAttribute("href")).toContain(`queue=${readlist}`);
	});

	it("trims the name before storing it", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlist(agent, "New Readlist");

		const response = await renameFromDialog(agent, readlist, "   Deep Work   ");

		expect(response.text).toBe("Readlist renamed to Deep Work.");
		expect(readlistTab(parse((await agent.get("/queue")).text), readlist).textContent).toBe(
			"Deep Work",
		);
	});

	it("lets a readlist keep the name it already has, rather than numbering it against itself", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlist(agent, "New Readlist");
		await renameFromDialog(agent, readlist, "Work Reading");

		const response = await renameFromDialog(agent, readlist, "Work Reading");

		expect(response.status).toBe(200);
		expect(response.text).toBe("Readlist renamed to Work Reading.");
	});

	it("numbers a name the reader's other readlist already carries", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const first = await createReadlist(agent, "New Readlist");
		await renameFromDialog(agent, first, "Work Reading");
		const second = await createReadlist(agent, "New Readlist 2");

		const response = await renameFromDialog(agent, second, "Work Reading");

		expect(response.status).toBe(200);
		expect(hxLocation(response)).toEqual(landingFromDialog({ path: `/queue?queue=${second}`, slug: second }));
		const doc = parse((await agent.get("/queue")).text);
		expect(readlistTab(doc, first).textContent).toBe("Work Reading");
		expect(readlistTab(doc, second).textContent).toBe("Work Reading 2");
		expect(readlistTab(doc, first).getAttribute("href")).not.toBe(
			readlistTab(doc, second).getAttribute("href"),
		);
	});

	it("announces the name it stored, so the reader hears what actually landed", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const first = await createReadlist(agent, "New Readlist");
		await renameFromDialog(agent, first, "Work Reading");
		const second = await createReadlist(agent, "New Readlist 2");

		const response = await renameFromDialog(agent, second, "Work Reading");

		expect(response.text).toBe("Readlist renamed to Work Reading 2.");
		const doc = parse((await agent.get("/queue")).text);
		expect(readlistTab(doc, second).textContent).toBe("Work Reading 2");
	});

	it("matches a taken name whatever its capitalisation, storing the casing the reader typed", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const first = await createReadlist(agent, "New Readlist");
		await renameFromDialog(agent, first, "Work");
		const second = await createReadlist(agent, "New Readlist 2");

		const response = await renameFromDialog(agent, second, "work");

		expect(response.status).toBe(200);
		expect(response.text).toBe("Readlist renamed to work 2.");
	});

	it("refuses a name with no room left for the number that tells it apart, in the dialog's own form", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const longest = "a".repeat(READLIST_LABEL_MAX_LENGTH);
		const first = await createReadlist(agent, "New Readlist");
		await renameFromDialog(agent, first, longest);
		const second = await createReadlist(agent, "New Readlist 2");

		const response = await renameFromDialog(agent, second, longest);

		expect(response.status).toBe(422);
		expect(response.headers["content-type"]).toBe("text/html; charset=utf-8");
		expect(refusedForm(response)).toEqual({
			action: dialogAction(second),
			post: dialogAction(second),
			value: longest,
			invalid: "true",
			autofocus: true,
			error: "You already have a readlist with that name, and it's too long to number. Try a shorter one.",
		});
	});

	it("numbers a name the built-in readlist carries", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlist(agent, "New Readlist");

		const response = await renameFromDialog(agent, readlist, "All");

		expect(response.status).toBe(200);
		expect(
			Array.from(
				parse((await agent.get("/queue")).text).querySelectorAll(
					"[data-test-readlist]",
				),
				(el) => el.textContent,
			),
		).toEqual(["All", "All 2"]);
	});

	it("refuses a name too long to render in full, keeping what the reader typed", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlist(agent, "New Readlist");
		const tooLong = "a".repeat(READLIST_LABEL_MAX_LENGTH + 1);

		const response = await renameFromDialog(agent, readlist, tooLong);

		expect(response.status).toBe(422);
		expect(refusedForm(response)).toEqual({
			action: dialogAction(readlist),
			post: dialogAction(readlist),
			value: tooLong,
			invalid: "true",
			autofocus: true,
			error: `Give the readlist a name of ${READLIST_LABEL_MAX_LENGTH} characters or fewer.`,
		});
	});

	it("refuses a name emptied of everything but spaces, keeping the spaces the reader typed", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlist(agent, "New Readlist");

		const response = await renameFromDialog(agent, readlist, "   ");

		expect(response.status).toBe(422);
		expect(refusedForm(response)).toEqual({
			action: dialogAction(readlist),
			post: dialogAction(readlist),
			value: "   ",
			invalid: "true",
			autofocus: true,
			error: `Give the readlist a name of ${READLIST_LABEL_MAX_LENGTH} characters or fewer.`,
		});
	});

	it("takes a name made only of emoji, which the readlist's own id addresses", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlist(agent, "New Readlist");

		const response = await renameFromDialog(agent, readlist, "🎉🎉");

		expect(response.status).toBe(200);
		expect(readlistTab(parse((await agent.get("/queue")).text), readlist).textContent).toBe(
			"🎉🎉",
		);
	});

	it("sends the dialog to the not-found alert for a readlist the reader does not have", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await renameFromDialog(agent, "ffffffffffffffff", "Mine");

		expect(response.status).toBe(204);
		expect(response.text).toBe("");
		expect(hxLocation(response)).toEqual(
			landingFromDialog({ path: "/queue?queue_error=rename_unknown-readlist", slug: "ffffffffffffffff" }),
		);
	});

	it("does not rename the readlist every reader is given", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await renameFromDialog(agent, "default", "Everything");

		expect(response.status).toBe(204);
		expect(hxLocation(response)).toEqual(
			landingFromDialog({ path: "/queue?queue_error=rename_unknown-readlist", slug: "default" }),
		);
		expect(
			Array.from(
				parse((await agent.get("/queue")).text).querySelectorAll("[data-test-readlist]"),
				(el) => el.textContent,
			),
		).toEqual(["All"]);
	});

	it("redirects a readlist address that could never have been minted, since no dialog carries it", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await renameFromDialog(agent, "Not A Slug", "Mine");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue?queue_error=rename_unknown-readlist");
	});

	it("sends the dialog to the not-found alert when the readlist disappears between the check and the write", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp({
			...fixture,
			articleStore: {
				...fixture.articleStore,
				renameReadlistDefinition: async () => ({ renamed: false }),
			},
		});
		const agent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlist(agent, "New Readlist");

		const response = await renameFromDialog(agent, readlist, "Work Reading");

		expect(response.status).toBe(204);
		expect(hxLocation(response)).toEqual(
			landingFromDialog({ path: "/queue?queue_error=rename_unknown-readlist", slug: readlist }),
		);
	});

	it("sends a signed-out visitor to log in rather than renaming anything", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server)
			.post("/queue/queues/ffffffffffffffff/rename")
			.type("form")
			.send({ label: "Work" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login");
	});

	describe("without JavaScript, when the browser asks for HTML", () => {
		it("redirects back to the renamed readlist so the form submit lands on a page", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const readlist = await createReadlist(agent, "New Readlist");

			const response = await renameFromBrowser(agent, readlist, "Work Reading");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe(`/queue?queue=${readlist}`);
			expect(readlistTab(parse((await agent.get("/queue")).text), readlist).textContent).toBe(
				"Work Reading",
			);
		});

		it("renames through the plain form the menu offers a no-popover browser", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const readlist = await createReadlist(agent, "New Readlist");

			const menu = parse((await agent.get("/queue")).text).querySelector(
				`[data-test-readlist-menu="${readlist}"]`,
			);
			assert(menu, "the custom readlist must carry its menu in the rail");
			const form = menu.querySelector('form[data-test-form="readlist-rename-fallback"]');
			assert(form, "a no-popover browser must find a plain rename form in the menu");
			const action = form.getAttribute("action");
			assert(action, "the fallback form must post somewhere");
			const input = form.querySelector("[data-test-readlist-rename-fallback-input]");
			assert(input, "the fallback form must carry a name field");
			const field = input.getAttribute("name");
			assert(field, "the name field must be named");
			const target = new URL(action, TEST_APP_ORIGIN);

			const response = await agent
				.post(`${target.pathname}${target.search}`)
				.set("Accept", BROWSER_ACCEPT)
				.type("form")
				.send({ [field]: "Deep Work" });

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe(`/queue?queue=${readlist}`);
			expect(readlistTab(parse((await agent.get("/queue")).text), readlist).textContent).toBe(
				"Deep Work",
			);
		});

		it("redirects a refused name back to the readlist", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const readlist = await createReadlist(agent, "New Readlist");

			const response = await renameFromBrowser(
				agent,
				readlist,
				"a".repeat(READLIST_LABEL_MAX_LENGTH + 1),
			);

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe(
				`/queue?queue=${readlist}&queue_error=rename_invalid-name`,
			);
		});

		it("redirects an unknown readlist to a page rather than a 404 body", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await renameFromBrowser(agent, "ffffffffffffffff", "Mine");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue?queue_error=rename_unknown-readlist");
		});
	});

	it("answers a client that asks for JSON with the 303 a browser gets", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const readlist = await createReadlist(agent, "New Readlist");

		const response = await agent
			.post(`/queue/queues/${readlist}/rename`)
			.set("Accept", "application/json")
			.type("form")
			.send({ label: "Work Reading" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(`/queue?queue=${readlist}`);
		expect(readlistTab(parse((await agent.get("/queue")).text), readlist).textContent).toBe(
			"Work Reading",
		);
	});
});
