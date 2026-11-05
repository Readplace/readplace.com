import assert from "node:assert/strict";
import {
	AliasNameSchema,
	type EmailDeliveryMode,
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
	emailDelivery?: EmailDeliveryMode;
}): Document {
	return new JSDOM(
		`<main>${renderReadlistInboxes(
			buildReadlistInboxes({
				readlist: {
					slug: WORK,
					label: "Work Reading",
					purpose: input.purpose,
					emailDelivery: input.emailDelivery ?? "links",
				},
				inboxes: input.inboxes,
				readlists: [
					DEFAULT_READLIST,
					{ slug: WORK, label: "Work Reading" },
					{ slug: LATER, label: "Later" },
				],
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
				destination: "Saves to All",
				button: "Send here ('Work Reading' readlist)",
			},
			{
				name: "news",
				address: "news-a7b2c9@read.place",
				destination: "Saves to All and Work Reading",
				button: "Stop sending emails from 'news' inbox to this readlist",
			},
			{
				name: "old",
				address: "old-d0e5f2@read.place",
				destination: "Saves to All",
				button: "Send here ('Work Reading' readlist)",
			},
			{
				name: "tech",
				address: "tech-b8c3d0@read.place",
				destination: "Saves to All and Later",
				button: "Send here ('Work Reading' readlist)",
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
			`/queue/queues/${WORK}/preferences/inboxes?utm_source=queue-preferences&utm_medium=internal&utm_content=unroute-inbox`,
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
			`/queue/queues/${WORK}/preferences/inboxes?utm_source=queue-preferences&utm_medium=internal&utm_content=route-inbox`,
		);
		expect(formFields(form)).toEqual({ address: "tech-b8c3d0@read.place", destination: WORK });
	});

	it("drops the feature from the routing form when the reader never asked for it", () => {
		const doc = renderInboxes({
			inboxes: [inbox({ name: "news", token: "a7b2c9" })],
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

	it("says a custom email sent here saves the articles each email links to into All and here", () => {
		const doc = renderInboxes({ inboxes: [] });

		expect(doc.querySelector("[data-test-inboxes-description]")?.textContent).toBe(
			"Send a custom email here and the articles each email links to are saved to All and Work Reading.",
		);
	});

	it("adds that only links fitting the purpose are kept once the readlist has one", () => {
		const doc = renderInboxes({ inboxes: [], purpose: "Essays on how teams ship." });

		expect(doc.querySelector("[data-test-inboxes-description]")?.textContent).toBe(
			"Send a custom email here and every article each email links to is saved to All. The ones that fit are also saved to Work Reading.",
		);
	});

	it("says each email is saved as one article to All and here when the readlist saves the email itself", () => {
		const doc = renderInboxes({ inboxes: [], emailDelivery: "issue" });

		expect(doc.querySelector("[data-test-inboxes-description]")?.textContent).toBe(
			"Send a custom email here and each email is saved as one article to All and Work Reading.",
		);
	});

	it("keeps saving the email itself to here whatever the purpose, since the email skips the fit check", () => {
		const doc = renderInboxes({ inboxes: [], emailDelivery: "issue", purpose: "Essays on how teams ship." });

		expect(doc.querySelector("[data-test-inboxes-description]")?.textContent).toBe(
			"Send a custom email here and each email is saved as one article to All and Work Reading.",
		);
	});

	it("says each email and the articles it links to are saved to All and here when the readlist saves both", () => {
		const doc = renderInboxes({ inboxes: [], emailDelivery: "both" });

		expect(doc.querySelector("[data-test-inboxes-description]")?.textContent).toBe(
			"Send a custom email here and each email is saved as one article, with the articles it links to, to All and Work Reading.",
		);
	});

	it("adds that only linked articles that fit join the email here when the readlist saves both and has a purpose", () => {
		const doc = renderInboxes({ inboxes: [], emailDelivery: "both", purpose: "Essays on how teams ship." });

		expect(doc.querySelector("[data-test-inboxes-description]")?.textContent).toBe(
			"Send a custom email here and each email is saved as one article to All and Work Reading, and the articles it links to are saved to All, with the ones that fit also saved to Work Reading.",
		);
	});

	it("posts the email delivery choice to this readlist's preferences, tagged as setting it", () => {
		const doc = renderInboxes({ inboxes: [] });
		const form = doc.querySelector("[data-test-readlist-email-delivery]");
		assert(form, "the email delivery form must render even with no custom emails");

		expect(form.getAttribute("method")).toBe("POST");
		expect(form.getAttribute("action")).toBe(
			`/queue/queues/${WORK}/preferences/email-delivery?utm_source=queue-preferences&utm_medium=internal&utm_content=set-email-delivery`,
		);
	});

	it("offers the email itself, the articles it links to, and both, checking the readlist's choice", () => {
		const doc = renderInboxes({ inboxes: [inbox({ name: "news", token: "a7b2c9" })], emailDelivery: "both" });

		const options = Array.from(doc.querySelectorAll<HTMLInputElement>("[data-test-email-delivery-option]"), (radio) => ({
			value: radio.value,
			name: radio.name,
			checked: radio.checked,
			text: radio.closest("label")?.textContent?.trim(),
		}));
		expect(options).toEqual([
			{
				value: "issue",
				name: "delivery",
				checked: false,
				text: "The email itselfEach email lands in your readlist as one article. Save the links you want while you read it.",
			},
			{
				value: "links",
				name: "delivery",
				checked: false,
				text: "The articles it links toThe articles each email links to are saved one by one. The email stays on its inbox page.",
			},
			{
				value: "both",
				name: "delivery",
				checked: true,
				text: "BothEach email lands as an article, and the articles it links to are saved beside it.",
			},
		]);
	});

	it("shows the empty state, with a tracked way to create an inbox, when the reader has none", () => {
		const doc = renderInboxes({ inboxes: [] });
		const create = doc.querySelector('[data-test-action="create-inbox"]');
		assert(create, "the empty state must offer to create an inbox");

		expect(section(doc).getAttribute("data-test-inboxes-state")).toBe("empty");
		expect(section(doc).classList.contains("readlist-inboxes--empty")).toBe(true);
		expect(create.textContent).toBe("Create a custom email");
		expect(create.getAttribute("href")).toBe(
			"/newsletters/custom-emails?utm_source=queue-preferences&utm_medium=internal&utm_content=create-inbox",
		);
	});

	it("offers a tracked way to manage the reader's custom emails once there are some to route", () => {
		const doc = renderInboxes({ inboxes: [inbox({ name: "news", token: "a7b2c9" })] });
		const manage = doc.querySelector('[data-test-action="manage-inboxes"]');
		assert(manage, "the listed state must offer to manage custom emails");

		expect(manage.textContent).toBe("Manage custom emails");
		expect(manage.getAttribute("href")).toBe(
			"/newsletters/custom-emails?utm_source=queue-preferences&utm_medium=internal&utm_content=manage-inboxes",
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
