import assert from "node:assert/strict";
import { EmailLinkOrdinalSchema } from "@packages/domain/inbox";
import {
	ReadlistFitOverrideIdSchema,
	type ReadlistFitReaderVerdict,
	type ReadlistSlug,
	ReadlistSlugSchema,
} from "@packages/domain/readlist";
import type { ReadlistFitOverride } from "@packages/provider-contracts/article-store";
import { JSDOM } from "jsdom";
import { renderReadlistFitChoices } from "./readlist-fit-choices.component";

const WORK: ReadlistSlug = ReadlistSlugSchema.parse("a1b2c3d4");

function choice(input: {
	id: string;
	anchorText: string;
	host: string;
	readerVerdict: ReadlistFitReaderVerdict;
	createdAt: string;
}): ReadlistFitOverride {
	return {
		id: ReadlistFitOverrideIdSchema.parse(input.id),
		url: `https://${input.host}/article`,
		anchorText: input.anchorText,
		host: input.host,
		readerVerdict: input.readerVerdict,
		receivedAtMessageId: "1760000000000-message",
		ordinal: EmailLinkOrdinalSchema.parse("0001"),
		createdAt: new Date(input.createdAt),
	};
}

const DOVETAIL = choice({
	id: "0009007199254740-1760000000000-message-0001",
	anchorText: "How to cut a dovetail by hand",
	host: "finewoodworking.com",
	readerVerdict: "keep",
	createdAt: "2026-10-12T09:00:00.000Z",
});

const SPONSOR = choice({
	id: "0009007199254741-1760000000000-message-0002",
	anchorText: "",
	host: "sponsor.example",
	readerVerdict: "drop",
	createdAt: "2026-10-11T09:00:00.000Z",
});

function renderChoices(input: {
	choices: readonly ReadlistFitOverride[];
	purpose?: string;
}): Document {
	return new JSDOM(
		`<main>${renderReadlistFitChoices({
			readlist: { slug: WORK, label: "Work", purpose: input.purpose },
			choices: input.choices,
		})}</main>`,
	).window.document;
}

function rowTexts(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll("[data-test-choice-text]"), (row) => row.textContent);
}

describe("renderReadlistFitChoices", () => {
	it("lists each remembered choice under Your choices, in the order the store gives", () => {
		const doc = renderChoices({ choices: [DOVETAIL, SPONSOR], purpose: "Woodworking" });

		expect(doc.querySelector("[data-test-readlist-choices] h3")?.textContent).toBe("Your choices");
		expect(rowTexts(doc)).toEqual([
			"Kept in Work · How to cut a dovetail by hand · finewoodworking.com · Oct 12, 2026",
			"Not in Work · sponsor.example · Oct 11, 2026",
		]);
	});

	it("marks the choice's date for the reader's own time zone", () => {
		const doc = renderChoices({ choices: [DOVETAIL], purpose: "Woodworking" });
		const time = doc.querySelector("[data-test-choice-text] time");
		assert(time, "every choice row carries its date");

		expect(time.getAttribute("datetime")).toBe("2026-10-12T09:00:00.000Z");
		expect(time.getAttribute("data-local-time")).toBe("date");
	});

	it("ends each row in one neutral Remove named by the choice, or by its host without anchor text", () => {
		const doc = renderChoices({ choices: [DOVETAIL, SPONSOR], purpose: "Woodworking" });
		const buttons = Array.from(doc.querySelectorAll("[data-test-action='remove-choice']"));

		expect(buttons.map((button) => button.textContent)).toEqual(["Remove", "Remove"]);
		expect(buttons.map((button) => button.className)).toEqual(["btn btn--neutral btn--m", "btn btn--neutral btn--m"]);
		expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
			"Remove Kept in Work: How to cut a dovetail by hand",
			"Remove Not in Work: sponsor.example",
		]);
	});

	it("posts Remove to the choice's encoded delete path and keeps the preferences feature", () => {
		const awkward = choice({
			id: "0009007199254740-<a#b>@mail-0003",
			anchorText: "Awkward",
			host: "example.com",
			readerVerdict: "keep",
			createdAt: "2026-10-12T09:00:00.000Z",
		});
		const doc = renderChoices({ choices: [awkward], purpose: "Woodworking" });
		const form = doc.querySelector("[data-test-readlist-choice] form");
		assert(form, "every choice row carries its Remove form");
		const action = new URL(form.getAttribute("action") ?? "", "https://readplace.test");

		expect(form.getAttribute("method")).toBe("POST");
		expect(action.pathname).toBe(
			"/queue/queues/a1b2c3d4/preferences/overrides/0009007199254740-%3Ca%23b%3E%40mail-0003/delete",
		);
		expect(action.searchParams.get("utm_content")).toBe("remove-choice");
	});

	it("renders nothing for a readlist without a purpose", () => {
		const doc = renderChoices({ choices: [DOVETAIL] });

		expect(doc.querySelector("main")?.innerHTML).toBe("");
	});

	it("renders nothing for a readlist without a remembered choice", () => {
		const doc = renderChoices({ choices: [], purpose: "Woodworking" });

		expect(doc.querySelector("main")?.innerHTML).toBe("");
	});
});
