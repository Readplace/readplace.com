import assert from "node:assert/strict";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { JSDOM } from "jsdom";
import type { UpgradeOffer } from "../../shared/upgrade-offer/upgrade-offer";
import { purposeStateOf, renderReadlistPurpose, renderReadlistPurposeCard, renderReadlistPurposeWizard } from "./readlist-purpose-card.component";

const WORK = ReadlistSlugSchema.parse("a1b2c3d4");
const OFFER: UpgradeOffer = { popoverId: "subscribe-plans", plansPath: "/account/plans", checkedPlan: "monthly" };
const LONG_PURPOSE =
	"Essays on how teams ship software, with a focus on the habits that let small groups release often and recover quickly from mistakes.";

function cardOf(html: string): Element {
	const card = new JSDOM(html).window.document.querySelector("[data-test-readlist-purpose]");
	assert(card, "the Purpose card must render");
	return card;
}

describe("renderReadlistPurposeCard", () => {
	it("renders nothing while the purpose is unset", () => {
		expect(renderReadlistPurposeCard({ purpose: undefined, standing: "open", offer: undefined })).toBe("");
	});

	it("titles the card Purpose and makes the whole of it one button that opens the edit dialog", () => {
		const card = cardOf(renderReadlistPurposeCard({ purpose: "Shipping essays.", standing: "open", offer: undefined }));

		expect(card.tagName).toBe("BUTTON");
		expect(card.getAttribute("popovertarget")).toBe("readlist-preferences-wizard");
		expect(card.querySelector(".readlist-purpose__heading")?.textContent).toBe("Purpose");
		expect(card.querySelectorAll(".readlist-purpose__pencil svg")).toHaveLength(1);
		expect(card.querySelector(".sr-only")?.textContent).toBe("Edit purpose");
	});

	it("shows a short purpose whole, with no view more", () => {
		const card = cardOf(renderReadlistPurposeCard({ purpose: "Shipping essays.", standing: "open", offer: undefined }));

		expect(card.querySelector("[data-test-readlist-purpose-text]")?.textContent).toBe("Shipping essays.");
		expect(card.querySelectorAll("[data-test-readlist-purpose-more]")).toHaveLength(0);
	});

	it("cuts a long purpose at a word and invites the reader to view more", () => {
		const card = cardOf(renderReadlistPurposeCard({ purpose: LONG_PURPOSE, standing: "open", offer: undefined }));

		expect(card.querySelector("[data-test-readlist-purpose-text]")?.textContent).toBe(
			"Essays on how teams ship software, with a focus on the habits that let small groups release often view more …",
		);
	});

	it("flattens line breaks into the preview", () => {
		const card = cardOf(renderReadlistPurposeCard({ purpose: "Shipping\n\nessays.", standing: "open", offer: undefined }));

		expect(card.querySelector("[data-test-readlist-purpose-text]")?.textContent).toBe("Shipping essays.");
	});

	it.each(["needs-upgrade", "withheld"] as const)(
		"shows a %s reader the whole purpose, keeping its line breaks, with nothing to press",
		(standing) => {
			const card = cardOf(renderReadlistPurposeCard({ purpose: `${LONG_PURPOSE}\nSecond line.`, standing, offer: OFFER }));

			expect(card.tagName).toBe("SECTION");
			expect(card.querySelector("h2")?.textContent).toBe("Purpose");
			expect(card.querySelector("[data-test-readlist-purpose-text]")?.textContent).toBe(`${LONG_PURPOSE}\nSecond line.`);
			expect(card.querySelectorAll("[popovertarget='readlist-preferences-wizard'], [data-test-readlist-purpose-more]")).toHaveLength(0);
		},
	);

	it("locks the edit under the purpose for a reader who can upgrade", () => {
		const card = cardOf(renderReadlistPurposeCard({ purpose: "Shipping essays.", standing: "needs-upgrade", offer: OFFER }));

		expect(
			Array.from(card.querySelectorAll('.readlist-purpose__lock [data-test-action="upgrade-open"]'), (lock) =>
				lock.getAttribute("data-test-needs-upgrade"),
			),
		).toEqual(["edit-purpose"]);
	});

	it("shows no lock to a reader whose upgrade is withheld", () => {
		const card = cardOf(renderReadlistPurposeCard({ purpose: "Shipping essays.", standing: "withheld", offer: undefined }));

		expect(card.querySelectorAll(".readlist-purpose__lock")).toHaveLength(0);
	});
});

describe("renderReadlistPurpose", () => {
	it("pairs an editable card with an edit dialog prefilled with the purpose", () => {
		const rendered = renderReadlistPurpose({
			readlist: { slug: WORK, purpose: "Shipping essays." },
			standing: "open",
			offer: undefined,
			from: "done",
		});
		const dialog = new JSDOM(rendered.wizardPopoverHtml).window.document;

		expect(dialog.querySelector<HTMLTextAreaElement>("textarea[name='purpose']")?.value).toBe("Shipping essays.");
		expect(dialog.querySelector("[data-test-wizard]")?.getAttribute("action")).toBe(
			`/queue/queues/${WORK}/preferences?from=done&utm_source=queue-preferences&utm_medium=internal&utm_content=save-purpose`,
		);
	});

	it("points the inline form's Cancel at the tab the edit came from", () => {
		const inline = renderReadlistPurposeWizard({
			readlist: { slug: WORK, purpose: "Shipping essays." },
			values: { purpose: "Shipping essays." },
			from: "done",
		}).inlineHtml;
		const cancel = new JSDOM(inline).window.document.querySelector("a.btn");

		expect(cancel?.getAttribute("href")).toBe(
			`/queue?queue=${WORK}&tab=done&utm_source=queue-preferences&utm_medium=internal&utm_content=cancel`,
		);
	});

	it.each([
		["an unset purpose", undefined, "open"],
		["a read-only reader", "Shipping essays.", "needs-upgrade"],
	] as const)("renders no edit dialog for %s", (_case, purpose, standing) => {
		expect(
			renderReadlistPurpose({ readlist: { slug: WORK, purpose }, standing, offer: OFFER, from: "queue" }).wizardPopoverHtml,
		).toBe("");
	});
});

describe("purposeStateOf", () => {
	it("calls a readlist without a purpose unset and one with a purpose set", () => {
		expect([purposeStateOf({}), purposeStateOf({ purpose: "Shipping essays." })]).toEqual(["unset", "set"]);
	});
});
