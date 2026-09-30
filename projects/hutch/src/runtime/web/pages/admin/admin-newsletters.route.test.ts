import assert from "node:assert/strict";
import type { Server } from "node:http";
import { JSDOM } from "jsdom";
import request from "supertest";
import { ForwardableSenderSchema } from "@packages/domain/gmail";
import {
	type NewsletterCatalogRecord,
	type NewsletterCatalogSeed,
	NewsletterNameSchema,
	mergeSubmittedSender,
} from "@packages/domain/newsletter-catalog";
import type { WriteNewsletterCatalog } from "@packages/provider-contracts/newsletter-catalog";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { type InMemoryNewsletterCatalog, initInMemoryNewsletterCatalog } from "@packages/test-fixtures/providers/newsletter-catalog";
import { useTestServer } from "../../../test-app";

const ADMIN_EMAIL = "ops@readplace.com";
const ADMIN_PASSWORD = "password123";
const USER_EMAIL = "alex@example.com";
const USER_PASSWORD = "password456";
const EARLY = "2026-09-01T09:00:00.000Z";
const LATER = "2026-09-02T09:00:00.000Z";
const LATEST = "2026-09-03T09:00:00.000Z";

const useApp = useTestServer();

function record(input: {
	from: string;
	name: string | undefined;
	status: NewsletterCatalogRecord["status"];
	at?: string;
	replacedBy?: string;
}): NewsletterCatalogRecord {
	const at = input.at ?? EARLY;
	return {
		from: ForwardableSenderSchema.parse(input.from),
		name: input.name === undefined ? undefined : NewsletterNameSchema.parse(input.name),
		status: input.status,
		evidence: [
			{
				kind: "seed",
				url: "https://publisher.example/whitelist",
				note: "Publisher whitelist page",
				addedAt: at,
			},
		],
		replacedBy: input.replacedBy === undefined ? undefined : ForwardableSenderSchema.parse(input.replacedBy),
		createdAt: at,
		updatedAt: at,
		reviewedAt: undefined,
	};
}

const TLDR = record({
	from: "dan@tldrnewsletter.com",
	name: "TLDR",
	status: "pending",
	at: EARLY,
});
const SUBMITTED = record({
	from: "hello@unknown.example",
	name: undefined,
	status: "pending",
	at: LATER,
});
const MORNING_BREW = record({
	from: "crew@morningbrew.com",
	name: "Morning Brew",
	status: "approved",
	at: LATER,
});
const OLD_BYTES = record({
	from: "old@bytes.dev",
	name: "Bytes",
	status: "rejected",
	at: LATEST,
	replacedBy: "hello@bytes.dev",
});

const SPAM = record({
	from: "promo@deals.example",
	name: undefined,
	status: "rejected",
	at: LATER,
});

const EMPTY_SEED: NewsletterCatalogSeed = { version: 1, entries: [] };

function buildHarness(options: {
	records: NewsletterCatalogRecord[];
	seed?: NewsletterCatalogSeed;
	write?: (catalog: InMemoryNewsletterCatalog) => WriteNewsletterCatalog;
}) {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const catalog = initInMemoryNewsletterCatalog({
		version: 1,
		records: options.records,
	});
	const harness = useApp({
		...fixture,
		admin: {
			adminEmails: [ADMIN_EMAIL],
			recrawlServiceToken: fixture.admin.recrawlServiceToken,
		},
		newsletterCatalog: {
			readNewsletterCatalog: catalog.readCatalog,
			writeNewsletterCatalog: options.write === undefined ? catalog.writeCatalog : options.write(catalog),
			newsletterCatalogSeed: options.seed ?? EMPTY_SEED,
		},
	});
	return { harness, catalog, serviceToken: fixture.admin.recrawlServiceToken };
}

async function loginAs(input: { server: Server; email: string; password: string }) {
	const agent = request.agent(input.server);
	await agent.post("/login").type("form").send({ email: input.email, password: input.password });
	return agent;
}

async function adminAgent(harness: ReturnType<typeof buildHarness>["harness"]) {
	await harness.auth.createUser({
		email: ADMIN_EMAIL,
		password: ADMIN_PASSWORD,
	});
	return loginAs({
		server: harness.server,
		email: ADMIN_EMAIL,
		password: ADMIN_PASSWORD,
	});
}

function parse(html: string) {
	return new JSDOM(html).window.document;
}

function rows(html: string) {
	return Array.from(parse(html).querySelectorAll("[data-test-admin-newsletter-row]")).map((row) => [
		row.getAttribute("data-test-admin-newsletter-row"),
		row.getAttribute("data-status"),
	]);
}

function rowActions(html: string, from: string) {
	const row = parse(html).querySelector(`[data-test-admin-newsletter-row="${from}"]`);
	assert(row, `the row for ${from} must be rendered`);
	return Array.from(row.querySelectorAll("[data-test-admin-newsletter-action]")).map((button) =>
		button.getAttribute("data-test-admin-newsletter-action"),
	);
}

function hiddenFields(form: Element) {
	return Object.fromEntries(
		Array.from(form.querySelectorAll('input[type="hidden"]')).map((input) => [input.getAttribute("name"), input.getAttribute("value")]),
	);
}

function alertText(html: string, key: string) {
	const alert = parse(html).querySelector(`[data-test-alert="${key}"]`);
	assert(alert, `the ${key} alert must be rendered`);
	return {
		visible: alert.classList.contains("alert--visible"),
		text: alert.textContent?.replace(/\s+/g, " ").trim(),
	};
}

function fieldValue(html: string, name: string) {
	const form = parse(html).querySelector("[data-test-admin-newsletter-form]");
	assert(form, "the newsletter form must be rendered");
	const control = form.querySelector(`[name="${name}"]`);
	assert(control, `the ${name} control must be rendered`);
	return control.tagName === "TEXTAREA" ? control.textContent : control.getAttribute("value");
}

function fieldErrors(html: string) {
	return Array.from(parse(html).querySelectorAll("[data-test-error]")).map((error) => [
		error.getAttribute("data-test-error"),
		error.textContent?.trim(),
	]);
}

function stored(catalog: ReturnType<typeof buildHarness>["catalog"], from: string) {
	const found = catalog.current()?.records.find((candidate) => candidate.from === from);
	assert(found, `${from} must be stored`);
	return found;
}

describe("GET /admin/newsletters", () => {
	it("opens on the pending tab, oldest submission first, with the seed import", async () => {
		const { harness } = buildHarness({
			records: [SUBMITTED, MORNING_BREW, TLDR],
		});
		const agent = await adminAgent(harness);

		const response = await agent.get("/admin/newsletters");

		assert.equal(response.status, 200);
		assert.equal(response.headers["cache-control"], "no-store");
		const document = parse(response.text);
		assert.equal(document.body.classList.contains("page-admin-newsletters"), true);
		assert.deepEqual(rows(response.text), [
			["dan@tldrnewsletter.com", "pending"],
			["hello@unknown.example", "pending"],
		]);
		assert.deepEqual(
			Array.from(document.querySelectorAll("[data-test-admin-newsletters-tab]")).map((tab) => [
				tab.getAttribute("data-test-admin-newsletters-tab"),
				tab.getAttribute("aria-current"),
			]),
			[
				["pending", "page"],
				["approved", "false"],
				["rejected", "false"],
				["all", "false"],
			],
		);
		assert.deepEqual(rowActions(response.text, "dan@tldrnewsletter.com"), ["approve", "reject", "edit", "correct"]);
		assert.deepEqual(
			Array.from(document.querySelectorAll('[data-test-admin-newsletter-row="dan@tldrnewsletter.com"] form')).map((form) => [
				form.getAttribute("method"),
				form.getAttribute("hx-boost"),
			]),
			[
				["POST", "false"],
				["POST", "false"],
				["GET", "true"],
				["GET", "true"],
			],
		);
		const seed = document.querySelector("[data-test-admin-newsletters-seed]");
		assert(seed, "the pending tab offers the seed import");
		assert.equal(
			seed.getAttribute("action"),
			"/admin/newsletters/seed/import?utm_source=admin-newsletters&utm_medium=internal&utm_content=import-seed",
		);
		assert.equal(document.querySelector("[data-test-admin-newsletters-summary]")?.textContent, "2 newsletters");
		const unnamed = document.querySelector('[data-test-admin-newsletter-row="hello@unknown.example"] td[data-label="Name"]');
		assert.equal(unnamed?.textContent?.trim(), "No name yet");
	});

	it("lists each status tab with the actions that status allows", async () => {
		const { harness } = buildHarness({
			records: [TLDR, MORNING_BREW, OLD_BYTES],
		});
		const agent = await adminAgent(harness);

		const approved = await agent.get("/admin/newsletters?list_status=approved");
		const rejected = await agent.get("/admin/newsletters?list_status=rejected");
		const all = await agent.get("/admin/newsletters?list_status=all");

		assert.deepEqual(rows(approved.text), [["crew@morningbrew.com", "approved"]]);
		assert.deepEqual(rowActions(approved.text, "crew@morningbrew.com"), ["withdraw", "edit", "correct"]);
		assert.equal(parse(approved.text).querySelector("[data-test-admin-newsletters-summary]")?.textContent, "1 newsletter");
		assert.deepEqual(rows(rejected.text), [["old@bytes.dev", "rejected"]]);
		assert.deepEqual(rowActions(rejected.text, "old@bytes.dev"), ["edit"]);
		assert.equal(
			parse(rejected.text).querySelector("[data-test-admin-newsletter-replaced-by]")?.textContent,
			"Replaced by hello@bytes.dev",
		);
		assert.deepEqual(rows(all.text), [
			["old@bytes.dev", "rejected"],
			["crew@morningbrew.com", "approved"],
			["dan@tldrnewsletter.com", "pending"],
		]);
	});

	it("marks a tab with no records as empty", async () => {
		const { harness } = buildHarness({ records: [TLDR] });
		const agent = await adminAgent(harness);

		const response = await agent.get("/admin/newsletters?list_status=rejected");

		const empty = parse(response.text).querySelector("[data-test-admin-newsletters-empty]");
		assert(empty, "the empty state must be rendered");
		assert.deepEqual(
			[empty.getAttribute("data-test-admin-newsletters-empty"), empty.getAttribute("data-empty"), empty.textContent],
			["rejected", "true", "No newsletters are rejected."],
		);
	});

	it("searches FROM addresses and names within the chosen tab", async () => {
		const { harness } = buildHarness({
			records: [TLDR, MORNING_BREW, OLD_BYTES],
		});
		const agent = await adminAgent(harness);

		const byName = await agent.get("/admin/newsletters?list_status=all&q=morning");
		const byAddress = await agent.get("/admin/newsletters?list_status=all&q=bytes.dev");
		const nothing = await agent.get("/admin/newsletters?list_status=all&q=nowhere");

		assert.deepEqual(rows(byName.text), [["crew@morningbrew.com", "approved"]]);
		assert.deepEqual(rows(byAddress.text), [["old@bytes.dev", "rejected"]]);
		const empty = parse(nothing.text).querySelector("[data-test-admin-newsletters-empty]");
		assert.equal(empty?.textContent, "No newsletters match “nowhere”.");
		const search = parse(byName.text).querySelector('form[role="search"]');
		assert(search, "the search form must be rendered");
		assert.equal(search.querySelector('input[name="q"]')?.getAttribute("value"), "morning");
		assert.deepEqual(hiddenFields(search), {
			list_status: "all",
			utm_source: "admin-newsletters",
			utm_medium: "internal",
			utm_content: "search",
		});
	});

	it("pages through more than fifty records", async () => {
		const many = Array.from({ length: 55 }, (_, index) =>
			record({
				from: `issue${String(index).padStart(2, "0")}@letters.example`,
				name: `Letter ${index}`,
				status: "pending",
				at: new Date(Date.parse(EARLY) + index * 60_000).toISOString(),
			}),
		);
		const { harness } = buildHarness({ records: many });
		const agent = await adminAgent(harness);

		const first = await agent.get("/admin/newsletters");
		const second = await agent.get("/admin/newsletters?page=2");

		assert.equal(rows(first.text).length, 50);
		assert.deepEqual(rows(second.text), [
			["issue50@letters.example", "pending"],
			["issue51@letters.example", "pending"],
			["issue52@letters.example", "pending"],
			["issue53@letters.example", "pending"],
			["issue54@letters.example", "pending"],
		]);
		const pageControls = (html: string) => {
			const pagination = parse(html).querySelector("[data-test-admin-newsletters-pagination]");
			assert(pagination, "pagination must be rendered");
			return {
				page: pagination.querySelector("[data-test-pagination-page]")?.getAttribute("data-test-pagination-page"),
				controls: Array.from(pagination.querySelectorAll("form")).map((form) => {
					const button = form.querySelector("button");
					assert(button, "each page control has a button");
					return [button.getAttribute("data-test-admin-newsletters-page"), button.hasAttribute("disabled"), hiddenFields(form).page];
				}),
			};
		};
		assert.deepEqual(pageControls(first.text), {
			page: "1",
			controls: [
				["prev", true, "0"],
				["next", false, "2"],
			],
		});
		assert.deepEqual(pageControls(second.text), {
			page: "2",
			controls: [
				["prev", false, "1"],
				["next", true, "3"],
			],
		});
	});

	it("confirms the last change with a notice", async () => {
		const { harness } = buildHarness({ records: [TLDR] });
		const agent = await adminAgent(harness);

		const response = await agent.get("/admin/newsletters?notice=approved");

		assert.deepEqual(alertText(response.text, "newsletter-notice"), {
			visible: true,
			text: "Newsletter approved. Readers now see it as a known newsletter.",
		});
	});

	it("opens the create form from the add action", async () => {
		const { harness } = buildHarness({ records: [TLDR] });
		const agent = await adminAgent(harness);

		const listing = await agent.get("/admin/newsletters?q=tldr");
		const add = parse(listing.text).querySelector("[data-test-admin-newsletters-add]");
		assert(add, "the add action must be rendered");
		const response = await agent.get("/admin/newsletters").query(hiddenFields(add));

		const form = parse(response.text).querySelector("[data-test-admin-newsletter-form]");
		assert(form, "the create form must be rendered");
		assert.equal(form.getAttribute("data-test-admin-newsletter-form"), "create");
		assert.equal(
			form.getAttribute("action"),
			"/admin/newsletters/records/create?utm_source=admin-newsletters&utm_medium=internal&utm_content=create",
		);
		assert.deepEqual(hiddenFields(form), {
			list_status: "pending",
			q: "tldr",
			page: "1",
		});
		assert.deepEqual(
			Array.from(form.querySelectorAll("input:not([type=hidden]), textarea")).map((control) => control.getAttribute("name")),
			["from", "name", "evidence_url", "evidence_note"],
		);
	});

	it("opens the edit form prefilled from the current record", async () => {
		const { harness } = buildHarness({ records: [TLDR, SUBMITTED] });
		const agent = await adminAgent(harness);

		const named = await agent.get("/admin/newsletters?edit=dan%40tldrnewsletter.com");
		const unnamed = await agent.get("/admin/newsletters?edit=hello%40unknown.example");

		const form = parse(named.text).querySelector('[data-test-admin-newsletter-form="edit"]');
		assert(form, "the edit form must be rendered");
		assert.deepEqual(hiddenFields(form), {
			from: "dan@tldrnewsletter.com",
			updated_at: EARLY,
			list_status: "pending",
			q: "",
			page: "1",
		});
		assert.equal(fieldValue(named.text, "name"), "TLDR");
		assert.equal(fieldValue(unnamed.text, "name"), "");
	});

	it("opens the FROM correction form for a known record only", async () => {
		const { harness } = buildHarness({ records: [TLDR] });
		const agent = await adminAgent(harness);

		const correcting = await agent.get("/admin/newsletters?correct=dan%40tldrnewsletter.com");
		const unknown = await agent.get("/admin/newsletters?edit=nobody%40example.com&correct=nobody%40example.com");

		const form = parse(correcting.text).querySelector('[data-test-admin-newsletter-form="correct"]');
		assert(form, "the correction form must be rendered");
		assert.equal(parse(correcting.text).querySelector("[data-test-admin-newsletter-form-subject]")?.textContent, "dan@tldrnewsletter.com");
		assert.equal(fieldValue(correcting.text, "new_from"), "");
		assert.deepEqual(
			Array.from(parse(unknown.text).querySelectorAll("[data-test-admin-newsletter-form]")).map((candidate) =>
				candidate.getAttribute("data-test-admin-newsletter-form"),
			),
			[],
		);
	});

	it("answers 503 without claiming the catalog is empty when it cannot be read", async () => {
		const { harness, catalog } = buildHarness({ records: [TLDR] });
		const agent = await adminAgent(harness);
		catalog.failReads(true);

		const response = await agent.get("/admin/newsletters");

		assert.equal(response.status, 503);
		assert.deepEqual(alertText(response.text, "newsletter-storage"), {
			visible: true,
			text: "The newsletter catalog could not be loaded. Try again shortly.",
		});
		const document = parse(response.text);
		const empty = document.querySelector("[data-test-admin-newsletters-empty]");
		assert(empty, "the empty state must be rendered");
		assert.deepEqual(
			[empty.getAttribute("data-empty"), empty.textContent],
			["true", "The catalog could not be loaded, so its newsletters are not shown."],
		);
		assert.equal(document.querySelector("[data-test-admin-newsletters-summary]")?.textContent, "Newsletter count unavailable");
		assert.equal(document.querySelectorAll("[data-test-admin-newsletters-seed]").length, 0);
		assert.equal(stored(catalog, TLDR.from).status, "pending");
	});

	it("offers reconsider on a rejected record unless it was replaced by a corrected FROM", async () => {
		const { harness } = buildHarness({ records: [OLD_BYTES, SPAM] });
		const agent = await adminAgent(harness);

		const response = await agent.get("/admin/newsletters?list_status=rejected");

		assert.deepEqual(rows(response.text), [
			["old@bytes.dev", "rejected"],
			["promo@deals.example", "rejected"],
		]);
		assert.deepEqual(
			[rowActions(response.text, "old@bytes.dev"), rowActions(response.text, "promo@deals.example")],
			[["edit"], ["reconsider", "edit"]],
		);
	});

	it("does not open the FROM correction form for a rejected record", async () => {
		const { harness } = buildHarness({ records: [OLD_BYTES] });
		const agent = await adminAgent(harness);

		const response = await agent.get("/admin/newsletters?list_status=rejected&correct=old%40bytes.dev");

		assert.equal(response.status, 200);
		assert.deepEqual(rows(response.text), [["old@bytes.dev", "rejected"]]);
		assert.equal(parse(response.text).querySelectorAll("[data-test-admin-newsletter-form]").length, 0);
	});
});

describe("admin newsletters authorization", () => {
	it("sends a signed-out visitor to login", async () => {
		const { harness } = buildHarness({ records: [] });

		const response = await request(harness.server).get("/admin/newsletters");

		assert.equal(response.status, 303);
		assert.equal(response.headers.location, "/login");
	});

	it("does not accept the recrawl service token in place of a session", async () => {
		const { harness, serviceToken } = buildHarness({ records: [] });

		const response = await request(harness.server)
			.post("/admin/newsletters/seed/import")
			.set("x-service-token", serviceToken)
			.type("form")
			.send({});

		assert.equal(response.status, 303);
		assert.equal(response.headers.location, "/login");
	});

	it("refuses a signed-in reader who is not an admin, for reads and writes", async () => {
		const { harness, catalog } = buildHarness({ records: [TLDR] });
		await harness.auth.createUser({
			email: USER_EMAIL,
			password: USER_PASSWORD,
		});
		const agent = await loginAs({
			server: harness.server,
			email: USER_EMAIL,
			password: USER_PASSWORD,
		});

		const read = await agent.get("/admin/newsletters");
		const write = await agent.post("/admin/newsletters/records/approve").type("form").send({ from: TLDR.from, updated_at: TLDR.updatedAt });

		assert.deepEqual([read.status, write.status], [403, 403]);
		for (const refused of [read, write]) {
			const doc = new JSDOM(refused.text).window.document;
			assert.equal(doc.querySelector("[data-test-admin-forbidden] h1")?.textContent, "Admin access required");
			assert.equal(doc.querySelector("[data-test-admin-newsletter-row]"), null);
		}
		assert.equal(stored(catalog, TLDR.from).status, "pending");
	});
});

describe("POST /admin/newsletters/records/create", () => {
	it("adds the newsletter as pending and returns to the list without tracking params", async () => {
		const { harness, catalog } = buildHarness({ records: [TLDR] });
		const agent = await adminAgent(harness);

		const response = await agent.post("/admin/newsletters/records/create").type("form").send({
			from: " Weekly@Letters.Example ",
			name: "Weekly Letters",
			evidence_url: "https://letters.example/whitelist",
			evidence_note: "Whitelist page names the address",
			list_status: "approved",
			q: "weekly",
			page: "2",
		});

		assert.equal(response.status, 303);
		assert.equal(response.headers.location, "/admin/newsletters?list_status=approved&q=weekly&page=2&notice=created");
		const created = stored(catalog, "weekly@letters.example");
		assert.deepEqual(
			{
				status: created.status,
				name: created.name,
				evidence: created.evidence.map((item) => [item.kind, item.url, item.note]),
			},
			{
				status: "pending",
				name: "Weekly Letters",
				evidence: [["admin", "https://letters.example/whitelist", "Whitelist page names the address"]],
			},
		);
	});

	it("accepts a note alone as evidence and leaves the name empty", async () => {
		const { harness, catalog } = buildHarness({ records: [] });
		const agent = await adminAgent(harness);

		const response = await agent.post("/admin/newsletters/records/create").type("form").send({
			from: "weekly@letters.example",
			name: "",
			evidence_url: "",
			evidence_note: "FROM header of a real issue",
		});

		assert.equal(response.status, 303);
		assert.deepEqual(
			[stored(catalog, "weekly@letters.example").name, stored(catalog, "weekly@letters.example").status],
			[undefined, "pending"],
		);
	});

	it("re-renders the attempted values with field errors", async () => {
		const { harness, catalog } = buildHarness({ records: [] });
		const agent = await adminAgent(harness);

		const response = await agent.post("/admin/newsletters/records/create").type("form").send({
			from: "not an address",
			name: "Weekly",
			evidence_url: "javascript:alert(1)",
			evidence_note: "note",
		});

		assert.equal(response.status, 422);
		assert.deepEqual(fieldErrors(response.text), [
			["from", "Enter the exact FROM address, such as newsletter@example.com, or *@example.com for every sender at that domain."],
			["evidence_url", "Enter a full https:// link to the publisher page."],
		]);
		assert.deepEqual(
			[fieldValue(response.text, "from"), fieldValue(response.text, "name"), fieldValue(response.text, "evidence_url")],
			["not an address", "Weekly", "javascript:alert(1)"],
		);
		assert.equal(catalog.current()?.records.length, 0);
	});

	it("asks for evidence before adding a record", async () => {
		const { harness } = buildHarness({ records: [] });
		const agent = await adminAgent(harness);

		const response = await agent.post("/admin/newsletters/records/create").type("form").send({
			from: "weekly@letters.example",
			name: "Weekly",
			evidence_url: "",
			evidence_note: "",
		});

		assert.equal(response.status, 422);
		assert.deepEqual(fieldErrors(response.text), [
			["evidence_note", "Add a publisher link or a note that shows where this FROM address comes from."],
		]);
	});

	it("refuses a FROM address the catalog already has", async () => {
		const { harness, catalog } = buildHarness({ records: [MORNING_BREW] });
		const agent = await adminAgent(harness);

		const response = await agent.post("/admin/newsletters/records/create").type("form").send({
			from: "crew@morningbrew.com",
			name: "Another name",
			evidence_url: "",
			evidence_note: "note",
		});

		assert.equal(response.status, 422);
		assert.deepEqual(fieldErrors(response.text), [["from", "The catalog already has a record for this FROM address."]]);
		assert.deepEqual([stored(catalog, MORNING_BREW.from).name, stored(catalog, MORNING_BREW.from).status], ["Morning Brew", "approved"]);
	});

	it("answers 503 and keeps the attempt when the catalog cannot be written", async () => {
		const { harness, catalog } = buildHarness({ records: [] });
		const agent = await adminAgent(harness);
		catalog.failNextWrite();

		const response = await agent.post("/admin/newsletters/records/create").type("form").send({
			from: "weekly@letters.example",
			name: "Weekly",
			evidence_url: "",
			evidence_note: "note",
		});

		assert.equal(response.status, 503);
		assert.equal(alertText(response.text, "newsletter-storage").visible, true);
		assert.equal(fieldValue(response.text, "from"), "weekly@letters.example");
		assert.equal(catalog.current()?.records.length, 0);
	});

	it("answers 409 and keeps the attempt when the catalog kept changing through every attempt", async () => {
		const writes: (string | undefined)[] = [];
		const { harness, catalog } = buildHarness({
			records: [],
			write: () => async (input) => {
				writes.push(input.expectedEtag);
				return { ok: false, reason: "conflict" };
			},
		});
		const agent = await adminAgent(harness);

		const response = await agent.post("/admin/newsletters/records/create").type("form").send({
			from: "weekly@letters.example",
			name: "Weekly",
			evidence_url: "",
			evidence_note: "note",
		});

		assert.equal(response.status, 409);
		assert.deepEqual(alertText(response.text, "newsletter-conflict"), {
			visible: true,
			text: "The catalog kept changing while this was saved. Nothing was changed. Submit again.",
		});
		assert.deepEqual([fieldValue(response.text, "from"), fieldValue(response.text, "name")], ["weekly@letters.example", "Weekly"]);
		assert.deepEqual(writes, ["etag-1", "etag-1", "etag-1"]);
		assert.equal(catalog.current()?.records.length, 0);
	});

	it("answers a request with no form body without failing", async () => {
		const { harness, catalog } = buildHarness({ records: [] });
		const agent = await adminAgent(harness);

		const seed = await agent.post("/admin/newsletters/seed/import");
		const create = await agent.post("/admin/newsletters/records/create");
		const correct = await agent.post("/admin/newsletters/records/correct");

		assert.deepEqual([seed.status, seed.headers.location], [303, "/admin/newsletters?list_status=pending&notice=seeded"]);
		assert.deepEqual([create.status, fieldValue(create.text, "from")], [422, ""]);
		assert.deepEqual([correct.status, fieldValue(correct.text, "new_from")], [422, ""]);
		assert.equal(catalog.current()?.records.length, 0);
	});
});

describe("POST /admin/newsletters/records/update", () => {
	it("renames the record and keeps the new evidence beside the old", async () => {
		const { harness, catalog } = buildHarness({ records: [TLDR] });
		const agent = await adminAgent(harness);

		const response = await agent.post("/admin/newsletters/records/update").type("form").send({
			from: TLDR.from,
			updated_at: TLDR.updatedAt,
			name: "TLDR Newsletter",
			evidence_url: "",
			evidence_note: "Checked a real FROM header",
			list_status: "pending",
		});

		assert.equal(response.status, 303);
		assert.equal(response.headers.location, "/admin/newsletters?list_status=pending&notice=updated");
		const updated = stored(catalog, TLDR.from);
		assert.deepEqual(
			{
				name: updated.name,
				status: updated.status,
				notes: updated.evidence.map((item) => item.note),
			},
			{
				name: "TLDR Newsletter",
				status: "pending",
				notes: ["Publisher whitelist page", "Checked a real FROM header"],
			},
		);
	});

	it("re-renders the edit with a field error", async () => {
		const { harness } = buildHarness({ records: [TLDR] });
		const agent = await adminAgent(harness);

		const response = await agent
			.post("/admin/newsletters/records/update")
			.type("form")
			.send({
				from: TLDR.from,
				updated_at: TLDR.updatedAt,
				name: "x".repeat(81),
				evidence_url: "",
				evidence_note: "",
			});

		assert.equal(response.status, 422);
		assert.deepEqual(fieldErrors(response.text), [["name", "Keep the newsletter name to 80 characters."]]);
		const form = parse(response.text).querySelector('[data-test-admin-newsletter-form="edit"]');
		assert(form, "the edit form must be re-rendered");
		assert.equal(hiddenFields(form).updated_at, TLDR.updatedAt);
	});

	it("answers 409 with the attempt kept beside the record another admin changed", async () => {
		const renamed = {
			...TLDR,
			name: NewsletterNameSchema.parse("TLDR Daily"),
			updatedAt: LATEST,
		};
		const { harness, catalog } = buildHarness({ records: [renamed] });
		const agent = await adminAgent(harness);

		const response = await agent.post("/admin/newsletters/records/update").type("form").send({
			from: TLDR.from,
			updated_at: TLDR.updatedAt,
			name: "TLDR Tech",
			evidence_url: "",
			evidence_note: "My attempted note",
		});

		assert.equal(response.status, 409);
		assert.deepEqual(alertText(response.text, "newsletter-conflict"), {
			visible: true,
			text: "Someone else changed this newsletter after you opened it. Review the current record, then submit again.",
		});
		assert.deepEqual([fieldValue(response.text, "name"), fieldValue(response.text, "evidence_note")], ["TLDR Tech", "My attempted note"]);
		const document = parse(response.text);
		assert.equal(document.querySelector("[data-test-admin-newsletter-conflict-name]")?.textContent, "TLDR Daily");
		const form = document.querySelector('[data-test-admin-newsletter-form="edit"]');
		assert(form, "the edit form must be re-rendered");
		assert.equal(hiddenFields(form).updated_at, LATEST);
		assert.equal(stored(catalog, TLDR.from).name, "TLDR Daily");
	});

	it("answers 503 and keeps the attempted edit when the catalog cannot be written", async () => {
		const { harness, catalog } = buildHarness({ records: [TLDR] });
		const agent = await adminAgent(harness);
		catalog.failNextWrite();

		const response = await agent.post("/admin/newsletters/records/update").type("form").send({
			from: TLDR.from,
			updated_at: TLDR.updatedAt,
			name: "TLDR Tech",
			evidence_url: "",
			evidence_note: "My attempted note",
		});

		assert.equal(response.status, 503);
		assert.equal(
			alertText(response.text, "newsletter-storage").text,
			"The newsletter catalog is unavailable. Nothing was changed. Try again shortly.",
		);
		assert.deepEqual([fieldValue(response.text, "name"), fieldValue(response.text, "evidence_note")], ["TLDR Tech", "My attempted note"]);
		const form = parse(response.text).querySelector('[data-test-admin-newsletter-form="edit"]');
		assert(form, "the edit form must be re-rendered");
		assert.equal(hiddenFields(form).updated_at, TLDR.updatedAt);
		assert.equal(stored(catalog, TLDR.from).name, "TLDR");
	});
});

describe("POST /admin/newsletters/records/{approve,reject,withdraw,reconsider}", () => {
	it("moves a record through every review transition and returns to the same list state", async () => {
		const { harness, catalog } = buildHarness({ records: [TLDR, SUBMITTED] });
		const agent = await adminAgent(harness);
		const listState = { list_status: "all", q: "tldr", page: "1" };
		const review = async (action: string, from: string) => {
			const response = await agent
				.post(`/admin/newsletters/records/${action}`)
				.type("form")
				.send({
					from,
					updated_at: stored(catalog, from).updatedAt,
					...listState,
				});
			return [response.status, response.headers.location, stored(catalog, from).status];
		};

		const approve = await review("approve", TLDR.from);
		const withdraw = await review("withdraw", TLDR.from);
		const reconsider = await review("reconsider", TLDR.from);
		const reject = await review("reject", SUBMITTED.from);

		assert.deepEqual(
			[approve, withdraw, reconsider, reject],
			[
				[303, "/admin/newsletters?list_status=all&q=tldr&notice=approved", "approved"],
				[303, "/admin/newsletters?list_status=all&q=tldr&notice=withdrawn", "rejected"],
				[303, "/admin/newsletters?list_status=all&q=tldr&notice=reconsidered", "pending"],
				[303, "/admin/newsletters?list_status=all&q=tldr&notice=rejected", "rejected"],
			],
		);
	});

	it("keeps a reader submission that landed while an approval was being saved", async () => {
		const readerSender = ForwardableSenderSchema.parse("hello@fresh.example");
		const writes: (string | undefined)[] = [];
		const { harness, catalog } = buildHarness({
			records: [TLDR],
			write: (inner) => {
				let raced = false;
				return async (input) => {
					writes.push(input.expectedEtag);
					if (!raced) {
						raced = true;
						const read = await inner.readCatalog();
						assert(read.ok);
						const submitted = mergeSubmittedSender(read.document, {
							from: readerSender,
							now: new Date(LATEST),
						});
						assert(submitted.ok);
						await inner.writeCatalog({
							document: submitted.document,
							expectedEtag: read.etag,
						});
					}
					return inner.writeCatalog(input);
				};
			},
		});
		const agent = await adminAgent(harness);

		const response = await agent.post("/admin/newsletters/records/approve").type("form").send({
			from: TLDR.from,
			updated_at: TLDR.updatedAt,
			list_status: "pending",
		});

		assert.deepEqual([response.status, response.headers.location], [303, "/admin/newsletters?list_status=pending&notice=approved"]);
		assert.deepEqual(writes, ["etag-1", "etag-2"]);
		assert.deepEqual(
			catalog.current()?.records.map((entry) => [entry.from, entry.status]),
			[
				[readerSender, "pending"],
				[TLDR.from, "approved"],
			],
		);
	});

	it("answers 503 and keeps the listing when a review cannot be written", async () => {
		const { harness, catalog } = buildHarness({ records: [TLDR] });
		const agent = await adminAgent(harness);
		catalog.failNextWrite();

		const response = await agent
			.post("/admin/newsletters/records/approve")
			.type("form")
			.send({ from: TLDR.from, updated_at: TLDR.updatedAt });

		assert.equal(response.status, 503);
		assert.equal(
			alertText(response.text, "newsletter-storage").text,
			"The newsletter catalog is unavailable. Nothing was changed. Try again shortly.",
		);
		assert.deepEqual(rows(response.text), [["dan@tldrnewsletter.com", "pending"]]);
		assert.equal(stored(catalog, TLDR.from).status, "pending");
	});

	it("answers 409 when the record changed after the list was loaded", async () => {
		const { harness, catalog } = buildHarness({
			records: [{ ...TLDR, updatedAt: LATEST }],
		});
		const agent = await adminAgent(harness);

		const response = await agent.post("/admin/newsletters/records/approve").type("form").send({ from: TLDR.from, updated_at: EARLY });

		assert.equal(response.status, 409);
		assert.equal(alertText(response.text, "newsletter-conflict").visible, true);
		assert.deepEqual(rows(response.text), [["dan@tldrnewsletter.com", "pending"]]);
		assert.equal(stored(catalog, TLDR.from).status, "pending");
	});

	it("answers 409 for a transition the record's status does not allow", async () => {
		const { harness } = buildHarness({ records: [MORNING_BREW] });
		const agent = await adminAgent(harness);

		const response = await agent
			.post("/admin/newsletters/records/approve")
			.type("form")
			.send({ from: MORNING_BREW.from, updated_at: MORNING_BREW.updatedAt });

		assert.equal(response.status, 409);
		assert.equal(
			alertText(response.text, "newsletter-conflict").text,
			"That newsletter is no longer in a state that allows this action. Review the current record.",
		);
	});

	it("answers 409 and keeps a record replaced by a corrected FROM rejected when reconsidered", async () => {
		const { harness, catalog } = buildHarness({ records: [OLD_BYTES] });
		const agent = await adminAgent(harness);

		const response = await agent
			.post("/admin/newsletters/records/reconsider")
			.type("form")
			.send({ from: OLD_BYTES.from, updated_at: OLD_BYTES.updatedAt });

		assert.equal(response.status, 409);
		assert.equal(
			alertText(response.text, "newsletter-conflict").text,
			"That newsletter is no longer in a state that allows this action. Review the current record.",
		);
		assert.equal(stored(catalog, OLD_BYTES.from).status, "rejected");
	});

	it("refuses a malformed review request", async () => {
		const { harness } = buildHarness({ records: [TLDR] });
		const agent = await adminAgent(harness);

		const response = await agent.post("/admin/newsletters/records/reject").type("form").send({ from: TLDR.from });

		assert.equal(response.status, 400);
	});
});

describe("POST /admin/newsletters/records/correct", () => {
	it("creates the corrected FROM as pending and rejects the old one", async () => {
		const { harness, catalog } = buildHarness({ records: [MORNING_BREW] });
		const agent = await adminAgent(harness);

		const response = await agent.post("/admin/newsletters/records/correct").type("form").send({
			from: MORNING_BREW.from,
			updated_at: MORNING_BREW.updatedAt,
			new_from: "crew@send.morningbrew.com",
			list_status: "approved",
		});

		assert.equal(response.status, 303);
		assert.equal(response.headers.location, "/admin/newsletters?list_status=approved&notice=corrected");
		const old = stored(catalog, MORNING_BREW.from);
		const corrected = stored(catalog, "crew@send.morningbrew.com");
		assert.deepEqual(
			[old.status, old.replacedBy, corrected.status, corrected.name],
			["rejected", "crew@send.morningbrew.com", "pending", "Morning Brew"],
		);
	});

	it("widens a FROM address to every sender at its domain", async () => {
		const { harness, catalog } = buildHarness({ records: [MORNING_BREW] });
		const agent = await adminAgent(harness);

		const response = await agent.post("/admin/newsletters/records/correct").type("form").send({
			from: MORNING_BREW.from,
			updated_at: MORNING_BREW.updatedAt,
			new_from: " *@MorningBrew.com ",
			list_status: "approved",
		});

		assert.equal(response.status, 303);
		const old = stored(catalog, MORNING_BREW.from);
		const widened = stored(catalog, "*@morningbrew.com");
		assert.deepEqual(
			[old.status, old.replacedBy, widened.status, widened.name],
			["rejected", "*@morningbrew.com", "pending", "Morning Brew"],
		);
	});

	it("refuses a corrected FROM the catalog already has", async () => {
		const { harness } = buildHarness({ records: [MORNING_BREW, TLDR] });
		const agent = await adminAgent(harness);

		const response = await agent.post("/admin/newsletters/records/correct").type("form").send({
			from: MORNING_BREW.from,
			updated_at: MORNING_BREW.updatedAt,
			new_from: TLDR.from,
		});

		assert.equal(response.status, 422);
		assert.deepEqual(fieldErrors(response.text), [["new_from", "The catalog already has a record for this FROM address."]]);
		assert.equal(fieldValue(response.text, "new_from"), TLDR.from);
	});

	it("re-renders an invalid corrected FROM", async () => {
		const { harness } = buildHarness({ records: [MORNING_BREW] });
		const agent = await adminAgent(harness);

		const response = await agent.post("/admin/newsletters/records/correct").type("form").send({
			from: MORNING_BREW.from,
			updated_at: MORNING_BREW.updatedAt,
			new_from: "morning brew",
		});

		assert.equal(response.status, 422);
		assert.deepEqual(fieldErrors(response.text), [["new_from", "Enter the exact corrected FROM address, such as newsletter@example.com, or *@example.com for every sender at that domain."]]);
	});

	it("answers 409 with the attempt kept beside the record another admin changed", async () => {
		const renamed = {
			...MORNING_BREW,
			name: NewsletterNameSchema.parse("Morning Brew Daily"),
			updatedAt: LATEST,
		};
		const { harness, catalog } = buildHarness({ records: [renamed] });
		const agent = await adminAgent(harness);

		const response = await agent.post("/admin/newsletters/records/correct").type("form").send({
			from: MORNING_BREW.from,
			updated_at: MORNING_BREW.updatedAt,
			new_from: "crew@send.morningbrew.com",
		});

		assert.equal(response.status, 409);
		assert.equal(
			alertText(response.text, "newsletter-conflict").text,
			"Someone else changed this newsletter after you opened it. Review the current record, then submit again.",
		);
		assert.equal(fieldValue(response.text, "new_from"), "crew@send.morningbrew.com");
		const document = parse(response.text);
		assert.deepEqual(
			[
				document.querySelector("[data-test-admin-newsletter-conflict-name]")?.textContent,
				document.querySelector("[data-test-admin-newsletter-conflict-status]")?.textContent,
			],
			["Morning Brew Daily", "Approved"],
		);
		const form = document.querySelector('[data-test-admin-newsletter-form="correct"]');
		assert(form, "the correction form must be re-rendered");
		assert.equal(hiddenFields(form).updated_at, LATEST);
		assert.deepEqual(
			catalog.current()?.records.map((entry) => [entry.from, entry.status]),
			[[MORNING_BREW.from, "approved"]],
		);
	});

	it("refuses to correct a record that is already rejected", async () => {
		const { harness, catalog } = buildHarness({ records: [OLD_BYTES] });
		const agent = await adminAgent(harness);

		const response = await agent.post("/admin/newsletters/records/correct").type("form").send({
			from: OLD_BYTES.from,
			updated_at: OLD_BYTES.updatedAt,
			new_from: "news@bytes.dev",
		});

		assert.equal(response.status, 409);
		assert.equal(
			alertText(response.text, "newsletter-conflict").text,
			"That newsletter is no longer in a state that allows this action. Review the current record.",
		);
		assert.deepEqual(
			catalog.current()?.records.map((entry) => [entry.from, entry.status, entry.replacedBy]),
			[[OLD_BYTES.from, "rejected", "hello@bytes.dev"]],
		);
	});

	it("answers 503 and keeps the corrected FROM when the catalog cannot be written", async () => {
		const { harness, catalog } = buildHarness({ records: [MORNING_BREW] });
		const agent = await adminAgent(harness);
		catalog.failNextWrite();

		const response = await agent.post("/admin/newsletters/records/correct").type("form").send({
			from: MORNING_BREW.from,
			updated_at: MORNING_BREW.updatedAt,
			new_from: "crew@send.morningbrew.com",
		});

		assert.equal(response.status, 503);
		assert.equal(alertText(response.text, "newsletter-storage").visible, true);
		assert.equal(fieldValue(response.text, "new_from"), "crew@send.morningbrew.com");
		assert.deepEqual(
			catalog.current()?.records.map((entry) => [entry.from, entry.status]),
			[[MORNING_BREW.from, "approved"]],
		);
	});

	it("answers 409 for a record that is not in the catalog", async () => {
		const { harness } = buildHarness({ records: [] });
		const agent = await adminAgent(harness);

		const response = await agent.post("/admin/newsletters/records/correct").type("form").send({
			from: "ghost@letters.example",
			updated_at: EARLY,
			new_from: "real@letters.example",
		});

		assert.equal(response.status, 409);
		assert.equal(alertText(response.text, "newsletter-conflict").text, "That newsletter is not in the catalog.");
		const form = parse(response.text).querySelector('[data-test-admin-newsletter-form="correct"]');
		assert(form, "the correction form must be re-rendered");
		assert.equal(hiddenFields(form).updated_at, EARLY);
	});
});

describe("POST /admin/newsletters/seed/import", () => {
	const SEED: NewsletterCatalogSeed = {
		version: 1,
		entries: [
			{
				from: ForwardableSenderSchema.parse("crew@morningbrew.com"),
				name: NewsletterNameSchema.parse("Morning Brew (seed)"),
				evidence: [
					{
						url: "https://www.morningbrew.com/whitelist",
						note: "Whitelist page",
					},
				],
			},
			{
				from: ForwardableSenderSchema.parse("briefs@dailydosebriefs.com"),
				name: NewsletterNameSchema.parse("Daily Dose"),
				evidence: [{ url: undefined, note: "FAQ names the address" }],
			},
		],
	};

	it("adds absent seed entries as pending, leaves approved ones alone, and is idempotent", async () => {
		const { harness, catalog } = buildHarness({
			records: [MORNING_BREW],
			seed: SEED,
		});
		const agent = await adminAgent(harness);

		const first = await agent.post("/admin/newsletters/seed/import").type("form").send({ list_status: "pending" });
		const afterFirst = catalog.current();
		const second = await agent.post("/admin/newsletters/seed/import").type("form").send({ list_status: "pending" });

		assert.deepEqual(
			[first.status, first.headers.location, second.status, second.headers.location],
			[303, "/admin/newsletters?list_status=pending&notice=seeded", 303, "/admin/newsletters?list_status=pending&notice=seeded"],
		);
		assert.deepEqual(
			catalog.current()?.records.map((entry) => [entry.from, entry.name, entry.status]),
			[
				["crew@morningbrew.com", "Morning Brew", "approved"],
				["briefs@dailydosebriefs.com", "Daily Dose", "pending"],
			],
		);
		assert.deepEqual(catalog.current(), afterFirst);
	});

	it("answers 503 when the seed cannot be written", async () => {
		const { harness, catalog } = buildHarness({ records: [], seed: SEED });
		const agent = await adminAgent(harness);
		catalog.failNextWrite();

		const response = await agent.post("/admin/newsletters/seed/import").type("form").send({});

		assert.equal(response.status, 503);
		assert.equal(alertText(response.text, "newsletter-storage").visible, true);
		assert.equal(catalog.current()?.records.length, 0);
	});
});
