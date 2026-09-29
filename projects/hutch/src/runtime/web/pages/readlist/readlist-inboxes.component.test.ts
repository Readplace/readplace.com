import assert from "node:assert/strict";
import {
	AliasNameSchema,
	type InboxAddressEntry,
	type InboxAddressPurpose,
	InboxAddressSchema,
	InboxTokenSchema,
} from "@packages/domain/inbox";
import { DEFAULT_READLIST, ReadlistSlugSchema, type ReadlistSlug } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import { JSDOM } from "jsdom";
import { buildReadlistInboxes, renderReadlistInboxes } from "./readlist-inboxes.component";

const READER = UserIdSchema.parse("reader-1");
const WORK: ReadlistSlug = ReadlistSlugSchema.parse("a1b2c3d4");
const LATER: ReadlistSlug = ReadlistSlugSchema.parse("e5f6a7b8");
const DELETED: ReadlistSlug = ReadlistSlugSchema.parse("c9d0e1f2");

function inbox(input: {
	name: string;
	token: string;
	readlist?: ReadlistSlug;
	purpose?: InboxAddressPurpose;
	disabled?: boolean;
}): InboxAddressEntry {
	return {
		address: InboxAddressSchema.parse(`${input.name}-${input.token}@read.place`),
		userId: READER,
		name: AliasNameSchema.parse(input.name),
		token: InboxTokenSchema.parse(input.token),
		createdAt: "2026-09-24T00:00:00.000Z",
		disabledAt: input.disabled ? "2026-09-24T01:00:00.000Z" : undefined,
		purpose: input.purpose ?? "user-alias",
		readlist: input.readlist,
	};
}

function renderInboxes(input: {
	inboxes: readonly InboxAddressEntry[];
	purpose?: string;
	preferencesEnabled?: boolean;
}): Document {
	return new JSDOM(
		`<main>${renderReadlistInboxes(
			buildReadlistInboxes({
				readlist: { slug: WORK, label: "Work Reading", purpose: input.purpose },
				inboxes: input.inboxes,
				readlists: [
					DEFAULT_READLIST,
					{ slug: WORK, label: "Work Reading" },
					{ slug: LATER, label: "Later" },
				],
				preferencesEnabled: input.preferencesEnabled ?? true,
			}),
		)}</main>`,
	).window.document;
}

function section(doc: Document): Element {
	const inboxes = doc.querySelector("[data-test-readlist-inboxes]");
	assert(inboxes, "the inboxes section must render in every state");
	return inboxes;
}

function row(doc: Document, address: string): Element {
	const found = doc.querySelector(`[data-test-preferences-inbox="${address}"]`);
	assert(found, `the ${address} row must render`);
	return found;
}

function rowSummaries(doc: Document) {
	return Array.from(doc.querySelectorAll("[data-test-preferences-inbox]"), (found) => ({
		name: found.querySelector("[data-test-inbox-name]")?.textContent,
		address: found.querySelector("[data-test-inbox-address]")?.textContent,
		destination: found.querySelector("[data-test-inbox-destination]")?.textContent,
		button: found.querySelector("button")?.textContent,
	}));
}

function formFields(form: Element): Record<string, string | null> {
	return Object.fromEntries(
		Array.from(form.querySelectorAll("input"), (input) => [
			input.getAttribute("name"),
			input.getAttribute("value"),
		]),
	);
}

describe("buildReadlistInboxes", () => {
	it("says where each inbox's newsletters go now, and offers the one move that changes it", () => {
		const doc = renderInboxes({
			inboxes: [
				inbox({ name: "news", token: "a7b2c9", readlist: WORK }),
				inbox({ name: "tech", token: "b8c3d0", readlist: LATER }),
				inbox({ name: "deals", token: "c9d4e1" }),
				inbox({ name: "old", token: "d0e5f2", readlist: DELETED }),
			],
		});

		expect(rowSummaries(doc)).toEqual([
			{
				name: "deals",
				address: "deals-c9d4e1@read.place",
				destination: "Goes to All",
				button: "Send here",
			},
			{
				name: "news",
				address: "news-a7b2c9@read.place",
				destination: "Goes to Work Reading",
				button: "Send to All",
			},
			{
				name: "old",
				address: "old-d0e5f2@read.place",
				destination: "Goes to All",
				button: "Send here",
			},
			{
				name: "tech",
				address: "tech-b8c3d0@read.place",
				destination: "Goes to Later",
				button: "Send here",
			},
		]);
	});

	it("marks which inboxes already come to this readlist", () => {
		const doc = renderInboxes({
			inboxes: [
				inbox({ name: "news", token: "a7b2c9", readlist: WORK }),
				inbox({ name: "tech", token: "b8c3d0", readlist: LATER }),
			],
		});

		const routing = Array.from(doc.querySelectorAll("[data-test-preferences-inbox]"), (found) =>
			found.getAttribute("data-test-inbox-routing"),
		);
		expect(routing).toEqual(["here", "elsewhere"]);
	});

	it("lists mapped Gmail inboxes beside the reader's own, leaving out the Gmail gateway and every turned-off inbox", () => {
		const doc = renderInboxes({
			inboxes: [
				inbox({ name: "gmail", token: "a1a1a1", purpose: "gmail-forwarding" }),
				inbox({ name: "tldr", token: "b2b2b2", purpose: "gmail-mapped" }),
				inbox({ name: "paused", token: "c3c3c3", disabled: true }),
				inbox({ name: "stale", token: "d4d4d4", purpose: "gmail-mapped", disabled: true }),
				inbox({ name: "news", token: "e5e5e5" }),
			],
		});

		expect(rowSummaries(doc).map((summary) => summary.address)).toEqual([
			"news-e5e5e5@read.place",
			"tldr-b2b2b2@read.place",
		]);
	});

	it("orders inboxes by name, then by address when two share a name", () => {
		const doc = renderInboxes({
			inboxes: [
				inbox({ name: "news", token: "zz9999" }),
				inbox({ name: "alpha", token: "mm5555" }),
				inbox({ name: "news", token: "aa1111" }),
			],
		});

		expect(rowSummaries(doc).map((summary) => summary.address)).toEqual([
			"alpha-mm5555@read.place",
			"news-aa1111@read.place",
			"news-zz9999@read.place",
		]);
	});

	it("posts an inbox coming here back to All, tagged as taking it away", () => {
		const doc = renderInboxes({ inboxes: [inbox({ name: "news", token: "a7b2c9", readlist: WORK })] });
		const form = row(doc, "news-a7b2c9@read.place").querySelector("form");
		assert(form, "every row must carry its routing form");

		expect(form.getAttribute("method")).toBe("POST");
		expect(form.getAttribute("action")).toBe(
			`/queue/queues/${WORK}/preferences/inboxes?feature=pref&utm_source=queue-preferences&utm_medium=internal&utm_content=unroute-inbox`,
		);
		expect(formFields(form)).toEqual({
			address: "news-a7b2c9@read.place",
			destination: "default",
		});
	});

	it("posts any other inbox to this readlist, tagged as bringing it here", () => {
		const doc = renderInboxes({ inboxes: [inbox({ name: "tech", token: "b8c3d0", readlist: LATER })] });
		const form = row(doc, "tech-b8c3d0@read.place").querySelector("form");
		assert(form, "every row must carry its routing form");

		expect(form.getAttribute("action")).toBe(
			`/queue/queues/${WORK}/preferences/inboxes?feature=pref&utm_source=queue-preferences&utm_medium=internal&utm_content=route-inbox`,
		);
		expect(formFields(form)).toEqual({ address: "tech-b8c3d0@read.place", destination: WORK });
	});

	it("drops the feature from the routing form when the reader never asked for it", () => {
		const doc = renderInboxes({
			inboxes: [inbox({ name: "news", token: "a7b2c9" })],
			preferencesEnabled: false,
		});

		expect(
			row(doc, "news-a7b2c9@read.place").querySelector("form")?.getAttribute("action"),
		).toBe(
			`/queue/queues/${WORK}/preferences/inboxes?utm_source=queue-preferences&utm_medium=internal&utm_content=route-inbox`,
		);
	});

	it("names each routing button's inbox for assistive technology", () => {
		const doc = renderInboxes({
			inboxes: [inbox({ name: "news", token: "a7b2c9" }), inbox({ name: "tech", token: "b8c3d0" })],
		});

		const described = Array.from(doc.querySelectorAll("[data-test-preferences-inbox] button"), (button) =>
			doc.getElementById(button.getAttribute("aria-describedby") ?? "")?.textContent,
		);
		expect(described).toEqual(["news", "tech"]);
	});

	it("says newsletters sent to the inboxes are saved here instead of All", () => {
		const doc = renderInboxes({ inboxes: [] });

		expect(doc.querySelector("[data-test-inboxes-description]")?.textContent).toBe(
			"Newsletters sent to these inboxes are saved to Work Reading instead of All.",
		);
	});

	it("adds that only links fitting the purpose are kept once the readlist has one", () => {
		const doc = renderInboxes({ inboxes: [], purpose: "Essays on how teams ship." });

		expect(doc.querySelector("[data-test-inboxes-description]")?.textContent).toBe(
			"Newsletters sent to these inboxes are saved to Work Reading instead of All, keeping only the links that fit its purpose.",
		);
	});

	it("shows the empty state, with a tracked way to create an inbox, when the reader has none", () => {
		const doc = renderInboxes({ inboxes: [] });
		const create = doc.querySelector('[data-test-action="create-inbox"]');
		assert(create, "the empty state must offer to create an inbox");

		expect(section(doc).getAttribute("data-test-inboxes-state")).toBe("empty");
		expect(section(doc).classList.contains("readlist-inboxes--empty")).toBe(true);
		expect(create.textContent).toBe("Create an inbox");
		expect(create.getAttribute("href")).toBe(
			"/inbox/addresses?utm_source=queue-preferences&utm_medium=internal&utm_content=create-inbox",
		);
	});

	it("shows the empty state when no inbox the reader has can be routed", () => {
		const doc = renderInboxes({
			inboxes: [
				inbox({ name: "gmail", token: "a1a1a1", purpose: "gmail-forwarding" }),
				inbox({ name: "paused", token: "c3c3c3", disabled: true }),
			],
		});

		expect(section(doc).getAttribute("data-test-inboxes-state")).toBe("empty");
	});

	it("swaps the empty state for the list once an inbox can be routed", () => {
		const doc = renderInboxes({ inboxes: [inbox({ name: "news", token: "a7b2c9" })] });

		expect(section(doc).getAttribute("data-test-inboxes-state")).toBe("listed");
		expect(section(doc).classList.contains("readlist-inboxes--listed")).toBe(true);
	});
});
