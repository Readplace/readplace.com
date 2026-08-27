import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
	AliasNameSchema,
	INBOX_ADDRESS_MAX_PER_USER,
	type InboxAddressEntry,
	InboxAddressSchema,
	InboxTokenSchema,
} from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { InboxPage } from "./inbox.component";

function entry(overrides: Partial<InboxAddressEntry> = {}): InboxAddressEntry {
	return {
		address: InboxAddressSchema.parse("in-3f9a2c@read.place"),
		userId: UserIdSchema.parse("user-1"),
		name: AliasNameSchema.parse("in"),
		token: InboxTokenSchema.parse("3f9a2c"),
		createdAt: "2026-06-23T00:00:00.000Z",
		disabledAt: undefined,
		purpose: "user-alias",
		...overrides,
	};
}

function parse(html: string): Document {
	return new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`).window.document;
}

function alertKeys(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll("[data-test-inbox-alert]")).map((el) =>
		el.getAttribute("data-test-inbox-alert"),
	);
}

describe("InboxPage", () => {
	it("noindexes the page and ships the copy-enhancement script", () => {
		const page = InboxPage({ addresses: [], limitReached: false, submittedName: "" });
		assert.equal(page.seo.robots, "noindex, nofollow");
		assert.equal(page.bodyClass, "page-inbox");
		assert.match(page.scripts ?? "", /inbox\.client\.js/);
	});

	it("shows an empty state with a create CTA when the user has no addresses", () => {
		const doc = parse(InboxPage({ addresses: [], limitReached: false, submittedName: "" }).content.html);
		assert.ok(doc.querySelector("[data-test-inbox-empty]"), "empty state must render");
		assert.ok(doc.querySelector("[data-test-inbox-create]"), "create CTA must render");
		const list = doc.querySelector("[data-test-inbox-list]");
		assert.ok(list, "the list renders in both states, hidden when there is nothing in it");
		assert.equal(list.getAttribute("data-test-inbox-addresses-state"), "empty");
	});

	it("switches the same list element to its populated state once an address exists", () => {
		const doc = parse(InboxPage({ addresses: [entry()], limitReached: false, submittedName: "" }).content.html);
		const list = doc.querySelector("[data-test-inbox-list]");
		assert.ok(list, "the address list must render");
		assert.equal(list.getAttribute("data-test-inbox-addresses-state"), "list");
	});

	it("renders each address into a selectable read-only field with a copy button", () => {
		const doc = parse(InboxPage({ addresses: [entry()], limitReached: false, submittedName: "" }).content.html);
		const field = doc.querySelector(".inbox-copyable__value");
		assert.equal(field?.getAttribute("value"), "in-3f9a2c@read.place");
		assert.equal(field?.getAttribute("readonly"), "");
		assert.equal(field?.hasAttribute("disabled"), false);
		const copy = doc.querySelector("[data-inbox-copy]");
		assert.equal(copy?.getAttribute("data-inbox-address"), "in-3f9a2c@read.place");
		assert.equal(copy?.hasAttribute("hidden"), true);
		const box = doc.querySelector(".inbox-copyable");
		assert.ok(box, "the address renders inside one copyable box");
		assert.equal(
			box.querySelector("[data-inbox-copy]"),
			copy,
			"the copy button is a child of the box, not a sibling beside it",
		);
	});

	it("renders a disabled address as a disabled field and drops its copy button, leaving the copy affordance only on the active one", () => {
		const doc = parse(
			InboxPage({
				addresses: [
					entry(),
					entry({
						address: InboxAddressSchema.parse("in-abc123@read.place"),
						token: InboxTokenSchema.parse("abc123"),
						disabledAt: "2026-06-22T00:00:00.000Z",
					}),
				],
				limitReached: false,
				submittedName: "",
			}).content.html,
		);

		const fieldValues = Array.from(
			doc.querySelectorAll(".inbox-copyable__value, .inbox__address-field"),
		).map((el) => el.getAttribute("value"));
		assert.deepEqual(
			fieldValues,
			["in-3f9a2c@read.place", "in-abc123@read.place"],
			"both addresses still render a field",
		);

		const active = doc.querySelector(".inbox-copyable__value");
		assert.ok(active, "the active address renders inside the copyable box");
		assert.equal(active.hasAttribute("readonly"), true);
		assert.equal(active.hasAttribute("disabled"), false);

		const disabled = doc.querySelector(".inbox__address-field");
		assert.ok(disabled, "the disabled address renders as its own field");
		assert.equal(disabled.hasAttribute("disabled"), true);
		assert.equal(disabled.hasAttribute("readonly"), false);
		assert.equal(
			disabled.classList.contains("inbox__address-field--disabled"),
			true,
			"disabled field carries the disabled modifier",
		);

		const copyableAddresses = Array.from(doc.querySelectorAll("[data-inbox-copy]")).map((el) =>
			el.getAttribute("data-inbox-address"),
		);
		assert.deepEqual(
			copyableAddresses,
			["in-3f9a2c@read.place"],
			"only the active address keeps a copy button",
		);
	});

	it("gives each control in a row a per-row accessible name so screen-reader users can tell rows apart", () => {
		const doc = parse(
			InboxPage({
				addresses: [
					entry({
						name: AliasNameSchema.parse("netflix"),
						address: InboxAddressSchema.parse("netflix-def456@read.place"),
						token: InboxTokenSchema.parse("def456"),
					}),
					entry({
						name: AliasNameSchema.parse("stratechery"),
						address: InboxAddressSchema.parse("stratechery-abc123@read.place"),
						token: InboxTokenSchema.parse("abc123"),
						disabledAt: "2026-06-22T00:00:00.000Z",
					}),
				],
				limitReached: false,
				submittedName: "",
			}).content.html,
		);

		assert.equal(
			doc.querySelector("[data-inbox-copy]")?.getAttribute("aria-label"),
			"Copy inbox email: netflix",
		);
		assert.equal(
			doc.querySelector("[data-test-inbox-disable]")?.getAttribute("aria-label"),
			"Disable inbox email: netflix",
		);

		const active = doc.querySelector(".inbox-copyable__value");
		const disabled = doc.querySelector(".inbox__address-field");
		assert.ok(active, "the active address field must render");
		assert.ok(disabled, "the disabled address field must render");
		assert.equal(active.getAttribute("aria-label"), "Inbox email: netflix");
		assert.equal(disabled.getAttribute("aria-label"), "Inbox email: stratechery");
		assert.notEqual(
			active.getAttribute("aria-label"),
			disabled.getAttribute("aria-label"),
			"each row's field carries a distinct accessible name",
		);
	});

	it("shows a Disable action for enabled addresses and a Disabled marker (no action) for disabled ones", () => {
		const doc = parse(
			InboxPage({
				addresses: [
					entry(),
					entry({
						address: InboxAddressSchema.parse("in-abc123@read.place"),
						token: InboxTokenSchema.parse("abc123"),
						disabledAt: "2026-06-22T00:00:00.000Z",
					}),
				],
				limitReached: false,
				submittedName: "",
			}).content.html,
		);
		assert.equal(doc.querySelectorAll("[data-test-inbox-item]").length, 2);
		const statuses = Array.from(doc.querySelectorAll("[data-test-inbox-status]")).map((el) =>
			el.getAttribute("data-test-inbox-status"),
		);
		assert.deepEqual(statuses, ["enabled", "disabled"]);
		assert.equal(doc.querySelectorAll("[data-test-inbox-disable]").length, 1);
	});

	it("points the create and disable forms at their routes", () => {
		const doc = parse(InboxPage({ addresses: [entry()], limitReached: false, submittedName: "" }).content.html);
		assert.equal(
			doc.querySelector(".inbox__create")?.getAttribute("action"),
			"/inbox/create",
		);
		assert.equal(
			doc.querySelector(".inbox__disable")?.getAttribute("action"),
			"/inbox/disable",
		);
	});

	it("renders the chosen alias name as a per-row label", () => {
		const doc = parse(
			InboxPage({
				addresses: [entry({ name: AliasNameSchema.parse("netflix") })],
				limitReached: false,
				submittedName: "",
			}).content.html,
		);
		const label = doc.querySelector("[data-test-inbox-name]");
		assert.equal(label?.textContent, "netflix");
	});

	it("offers a required, length-capped name input on the create form", () => {
		const doc = parse(InboxPage({ addresses: [], limitReached: false, submittedName: "" }).content.html);
		const input = doc.querySelector("[data-test-inbox-name-input]");
		assert.ok(input, "name input must render");
		assert.equal(input.getAttribute("name"), "name");
		assert.equal(input.hasAttribute("required"), true);
		assert.equal(input.getAttribute("maxlength"), "24");
	});

	it("shows exactly the alerts its inputs call for, and none otherwise", () => {
		assert.deepEqual(
			alertKeys(
				parse(InboxPage({ addresses: [], limitReached: false, submittedName: "" }).content.html),
			),
			[],
		);
		assert.deepEqual(
			alertKeys(
				parse(
					InboxPage({ addresses: [], limitReached: false, nameInvalid: true, submittedName: "" })
						.content.html,
				),
			),
			["name-invalid"],
		);
		assert.deepEqual(
			alertKeys(
				parse(
					InboxPage({ addresses: [], limitReached: false, nameTaken: true, submittedName: "" })
						.content.html,
				),
			),
			["name-taken"],
		);
		assert.deepEqual(
			alertKeys(
				parse(
					InboxPage({ addresses: [], limitReached: false, createFailed: true, submittedName: "" })
						.content.html,
				),
			),
			["create-failed"],
		);
	});

	it("stacks a rejected submission above the standing cap notice, in that order", () => {
		const doc = parse(
			InboxPage({ addresses: [entry()], limitReached: true, nameTaken: true, submittedName: "" })
				.content.html,
		);

		assert.deepEqual(alertKeys(doc), ["name-taken", "limit"]);
	});

	it("names the cap in the limit message so the reader knows the number", () => {
		const doc = parse(
			InboxPage({ addresses: [entry()], limitReached: true, submittedName: "" }).content.html,
		);

		const message = doc.querySelector('[data-test-inbox-alert="limit"]');
		assert.ok(message, "limit message must render when the cap is reached");
		assert.match(message.textContent ?? "", new RegExp(String(INBOX_ADDRESS_MAX_PER_USER)));
	});

	it("orders active addresses before disabled ones regardless of creation order", () => {
		const doc = parse(
			InboxPage({
				addresses: [
					entry({
						name: AliasNameSchema.parse("gmail"),
						address: InboxAddressSchema.parse("gmail-abc123@read.place"),
						token: InboxTokenSchema.parse("abc123"),
						disabledAt: "2026-06-22T00:00:00.000Z",
					}),
					entry({
						name: AliasNameSchema.parse("netflix"),
						address: InboxAddressSchema.parse("netflix-def456@read.place"),
						token: InboxTokenSchema.parse("def456"),
					}),
				],
				limitReached: false,
				submittedName: "",
			}).content.html,
		);

		const statuses = Array.from(doc.querySelectorAll("[data-test-inbox-status]")).map((el) =>
			el.getAttribute("data-test-inbox-status"),
		);
		assert.deepEqual(statuses, ["enabled", "disabled"]);
		const names = Array.from(doc.querySelectorAll("[data-test-inbox-name]")).map(
			(el) => el.textContent,
		);
		assert.deepEqual(names, ["netflix", "gmail"]);
	});

	it("collapses every disabled address into a closed details group holding the disabled rows", () => {
		const doc = parse(
			InboxPage({
				addresses: [
					entry(),
					entry({
						name: AliasNameSchema.parse("gmail"),
						address: InboxAddressSchema.parse("gmail-abc123@read.place"),
						token: InboxTokenSchema.parse("abc123"),
						disabledAt: "2026-06-21T00:00:00.000Z",
					}),
					entry({
						name: AliasNameSchema.parse("substack"),
						address: InboxAddressSchema.parse("substack-def456@read.place"),
						token: InboxTokenSchema.parse("def456"),
						disabledAt: "2026-06-22T00:00:00.000Z",
					}),
				],
				limitReached: false,
				submittedName: "",
			}).content.html,
		);

		const group = doc.querySelector("[data-test-inbox-disabled-group]");
		assert.ok(group, "disabled group must render");
		assert.equal(group.tagName, "DETAILS");
		assert.equal(group.hasAttribute("open"), false);
		assert.equal(
			group.querySelector(".inbox__disabled-summary")?.textContent,
			"Disabled inbox emails (2)",
		);
		const namesInside = Array.from(group.querySelectorAll("[data-test-inbox-name]")).map(
			(el) => el.textContent,
		);
		assert.deepEqual(namesInside, ["gmail", "substack"]);
	});

	it("keeps the details group rendered but hidden when no address is disabled", () => {
		const doc = parse(InboxPage({ addresses: [entry()], limitReached: false, submittedName: "" }).content.html);

		const group = doc.querySelector("[data-test-inbox-disabled-group]");
		assert.ok(group, "disabled group must render");
		assert.equal(group.classList.contains("inbox__disabled-group--hidden"), true);
		assert.equal(
			group.querySelector(".inbox__disabled-summary")?.textContent,
			"Disabled inbox emails (0)",
		);
	});

	it("marks the details group visible when a disabled address exists", () => {
		const doc = parse(
			InboxPage({
				addresses: [
					entry({
						address: InboxAddressSchema.parse("in-abc123@read.place"),
						token: InboxTokenSchema.parse("abc123"),
						disabledAt: "2026-06-22T00:00:00.000Z",
					}),
				],
				limitReached: false,
				submittedName: "",
			}).content.html,
		);

		const group = doc.querySelector("[data-test-inbox-disabled-group]");
		assert.ok(group, "disabled group must render");
		assert.equal(group.classList.contains("inbox__disabled-group--visible"), true);
	});

	it("lays out the page as create, then active, then disabled sections", () => {
		const doc = parse(InboxPage({ addresses: [entry()], limitReached: false, submittedName: "" }).content.html);

		const sections = Array.from(doc.querySelectorAll("[data-test-inbox-section]")).map((el) =>
			el.getAttribute("data-test-inbox-section"),
		);
		assert.deepEqual(sections, ["create", "active", "disabled"]);
	});

	it("orders an active row as name, the one-box copyable address, then right-edge controls", () => {
		const doc = parse(InboxPage({ addresses: [entry()], limitReached: false, submittedName: "" }).content.html);

		const row = doc.querySelector('[data-test-inbox-section="active"] [data-test-inbox-item]');
		assert.ok(row, "active row must render");
		const childClasses = Array.from(row.children).map(
			(el) => el.classList[el.classList.length - 1],
		);
		assert.deepEqual(childClasses, ["inbox__name", "inbox-copyable", "inbox__controls"]);
	});

	it("keeps the explainer first and the create form last in the create section, with the limit error and create confirmation between them", () => {
		const shape = (el: Element) => `${el.tagName.toLowerCase()}.${el.classList[0]}`;

		const withoutErrors = parse(InboxPage({ addresses: [], limitReached: false, submittedName: "" }).content.html);
		const section = withoutErrors.querySelector('[data-test-inbox-section="create"]');
		assert.ok(section, "create section must render");
		assert.deepEqual(Array.from(section.children).map(shape), [
			"section.inbox__instructions",
			"p.inbox__success",
			"form.inbox__create",
		]);

		const withLimit = parse(
			InboxPage({ addresses: [], limitReached: true, submittedName: "" }).content.html,
		);
		const limitedSection = withLimit.querySelector('[data-test-inbox-section="create"]');
		assert.ok(limitedSection, "create section must render");
		assert.deepEqual(Array.from(limitedSection.children).map(shape), [
			"section.inbox__instructions",
			"p.inbox__error",
			"p.inbox__success",
			"form.inbox__create",
		]);
	});
});
