import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
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
		token: InboxTokenSchema.parse("3f9a2c"),
		createdAt: "2026-06-23T00:00:00.000Z",
		disabledAt: undefined,
		...overrides,
	};
}

function parse(html: string): Document {
	return new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`).window.document;
}

describe("InboxPage", () => {
	it("noindexes the page and ships the copy-enhancement script", () => {
		const page = InboxPage({ addresses: [], limitReached: false });
		assert.equal(page.seo.robots, "noindex, nofollow");
		assert.equal(page.bodyClass, "page-inbox");
		assert.match(page.scripts ?? "", /inbox\.client\.js/);
	});

	it("shows an empty state with a create CTA and no list when the user has no addresses", () => {
		const doc = parse(InboxPage({ addresses: [], limitReached: false }).content.html);
		assert.ok(doc.querySelector("[data-test-inbox-empty]"), "empty state must render");
		assert.ok(doc.querySelector("[data-test-inbox-create]"), "create CTA must render");
		assert.equal(doc.querySelector("[data-test-inbox-list]"), null);
	});

	it("renders each address into a selectable read-only field with a copy button", () => {
		const doc = parse(InboxPage({ addresses: [entry()], limitReached: false }).content.html);
		const field = doc.querySelector(".inbox__address-field");
		assert.equal(field?.getAttribute("value"), "in-3f9a2c@read.place");
		assert.equal(field?.getAttribute("readonly"), "");
		assert.equal(field?.hasAttribute("disabled"), false);
		const copy = doc.querySelector("[data-inbox-copy]");
		assert.equal(copy?.getAttribute("data-inbox-address"), "in-3f9a2c@read.place");
		assert.equal(copy?.hasAttribute("hidden"), true);
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
			}).content.html,
		);

		const fields = Array.from(doc.querySelectorAll(".inbox__address-field"));
		assert.equal(fields.length, 2, "both addresses still render a field");

		const [active, disabled] = fields;
		assert.equal(active.getAttribute("value"), "in-3f9a2c@read.place");
		assert.equal(active.hasAttribute("readonly"), true);
		assert.equal(active.hasAttribute("disabled"), false);

		assert.equal(disabled.getAttribute("value"), "in-abc123@read.place");
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
			}).content.html,
		);
		assert.equal(doc.querySelectorAll("[data-test-inbox-item]").length, 2);
		const statuses = Array.from(doc.querySelectorAll("[data-test-inbox-status]")).map((el) =>
			el.getAttribute("data-test-inbox-status"),
		);
		assert.deepEqual(statuses, ["enabled", "disabled"]);
		assert.equal(doc.querySelectorAll("[data-test-inbox-disable]").length, 1);
	});

	it("points the create and disable forms at the flag-carrying routes", () => {
		const doc = parse(InboxPage({ addresses: [entry()], limitReached: false }).content.html);
		assert.equal(
			doc.querySelector(".inbox__create")?.getAttribute("action"),
			"/inbox/create?feature=email",
		);
		assert.equal(
			doc.querySelector(".inbox__disable")?.getAttribute("action"),
			"/inbox/disable?feature=email",
		);
	});

	it("shows the per-user limit message naming the cap only when the limit is reached", () => {
		const without = parse(InboxPage({ addresses: [entry()], limitReached: false }).content.html);
		assert.equal(without.querySelector("[data-test-inbox-limit]"), null);

		const withLimit = parse(InboxPage({ addresses: [entry()], limitReached: true }).content.html);
		const message = withLimit.querySelector("[data-test-inbox-limit]");
		assert.ok(message, "limit message must render when the cap is reached");
		assert.match(message.textContent ?? "", new RegExp(String(INBOX_ADDRESS_MAX_PER_USER)));
	});
});
