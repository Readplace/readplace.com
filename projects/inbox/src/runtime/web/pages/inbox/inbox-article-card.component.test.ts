import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { EmailLinkOrdinalSchema, type InboxEmailLinkEntry } from "@packages/domain/inbox";
import { ReadlistFitOverrideIdSchema, ReadlistSlugSchema } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import { renderInboxArticleCard } from "./inbox-article-card.component";
import { toInboxLinkCardViewModel } from "./inbox-link-card.viewmodel";
import type { InboxLinkCardReadlistFit } from "./inbox-readlist-fit";

const EMAIL_ID = "2026-06-24T09:00:00.000Z#<m@x>";
const ORDINAL = EmailLinkOrdinalSchema.parse("0002");
const WORK = ReadlistSlugSchema.parse("work");
const SCIENCE = ReadlistSlugSchema.parse("science");

const link: InboxEmailLinkEntry = {
	userId: UserIdSchema.parse("user-1"),
	receivedAtMessageId: EMAIL_ID,
	ordinal: ORDINAL,
	url: "https://example.com/post",
	resolvedUrl: undefined,
	status: "crawled",
	title: "A post",
	excerpt: undefined,
	siteName: undefined,
	imageUrl: undefined,
	failureReason: undefined,
	skipReason: undefined,
	anchorText: undefined,
};

const fits: InboxLinkCardReadlistFit[] = [
	{
		readlist: WORK,
		label: "Work",
		outcome: {
			readlist: WORK,
			readlistLabel: "Work",
			decision: "filtered",
			fit: [{ ordinal: ORDINAL, verdict: "keep", reason: "About distributed systems." }],
		},
		override: undefined,
	},
	{
		readlist: SCIENCE,
		label: "Science",
		outcome: { readlist: SCIENCE, readlistLabel: "Science", decision: "filtered", fit: [] },
		override: {
			id: ReadlistFitOverrideIdSchema.parse(`0000000000000001-${EMAIL_ID}-0002`),
			url: "https://example.com/post",
			anchorText: "Post",
			host: "example.com",
			readerVerdict: "keep",
			receivedAtMessageId: EMAIL_ID,
			ordinal: ORDINAL,
			createdAt: new Date("2026-10-14T10:00:00.000Z"),
		},
	},
];

function card(): Element {
	const html = renderInboxArticleCard(
		toInboxLinkCardViewModel({
			link,
			emailId: EMAIL_ID,
			pollCount: 1,
			maxPolls: 300,
			shown: 20,
			filter: undefined,
			fit: fits,
			linkSaveStates: new Map(),
			savePollContext: { mode: "static" },
		}),
	);
	const el = new JSDOM(html).window.document.querySelector("[data-test-inbox-article-card]");
	assert(el, "the card must render");
	return el;
}

describe("renderInboxArticleCard", () => {
	it("renders the engine's marker as an accent chip with its reason", () => {
		const marker = card().querySelector('[data-test-fit-marker="work"]');
		assert(marker, "the Work marker must render");

		expect(marker.querySelector("[data-test-fit-marker-label]")?.className).toBe("chip chip--accent");
		expect(marker.querySelector("[data-test-fit-marker-label]")?.textContent).toBe("Fits Work");
		expect(marker.querySelector("[data-test-fit-marker-reason]")?.textContent).toBe("About distributed systems.");
		expect(marker.querySelector("[data-test-fit-marker-chosen]")).toBeNull();
	});

	it("renders the reader's choice with a local-time date line", () => {
		const marker = card().querySelector('[data-test-fit-marker="science"]');
		assert(marker, "the Science marker must render");

		expect(marker.querySelector("[data-test-fit-marker-label]")?.textContent).toBe("Kept in Science");
		expect(marker.querySelector("[data-test-fit-marker-chosen]")?.textContent).toBe("You chose this on Oct 14, 2026.");
		const time = marker.querySelector("time");
		expect(time?.getAttribute("datetime")).toBe("2026-10-14T10:00:00.000Z");
		expect(time?.getAttribute("data-local-time")).toBe("date");
	});

	it("renders each fit control as a form posting the choice into the card", () => {
		const forms = Array.from(card().querySelectorAll("form")).filter((form) =>
			form.querySelector("[data-test-fit-readlist]"),
		);

		expect(
			forms.map((form) => {
				const button = form.querySelector("button");
				return {
					action: form.getAttribute("action"),
					hxPost: form.getAttribute("hx-post"),
					target: form.getAttribute("hx-target"),
					fields: Array.from(form.querySelectorAll("input[type=hidden]")).map((input) => [
						input.getAttribute("name"),
						input.getAttribute("value"),
					]),
					label: button?.textContent,
					ariaLabel: button?.getAttribute("aria-label"),
					className: button?.className,
				};
			}),
		).toEqual([
			{
				action: `/inbox/${encodeURIComponent(EMAIL_ID)}/links/0002/fit?tab=articles&utm_source=inbox-link-card&utm_medium=internal&utm_content=fit-drop`,
				hxPost: `/inbox/${encodeURIComponent(EMAIL_ID)}/links/0002/fit?tab=articles&utm_source=inbox-link-card&utm_medium=internal&utm_content=fit-drop`,
				target: "#inbox-card-0002",
				fields: [
					["readlist", "work"],
					["verdict", "drop"],
				],
				label: "Doesn't fit Work",
				ariaLabel: "Doesn't fit Work: https://example.com/post",
				className: "btn btn--secondary btn--m",
			},
			{
				action: `/inbox/${encodeURIComponent(EMAIL_ID)}/links/0002/fit?tab=articles&utm_source=inbox-link-card&utm_medium=internal&utm_content=fit-drop`,
				hxPost: `/inbox/${encodeURIComponent(EMAIL_ID)}/links/0002/fit?tab=articles&utm_source=inbox-link-card&utm_medium=internal&utm_content=fit-drop`,
				target: "#inbox-card-0002",
				fields: [
					["readlist", "science"],
					["verdict", "drop"],
				],
				label: "Doesn't fit Science",
				ariaLabel: "Doesn't fit Science: https://example.com/post",
				className: "btn btn--secondary btn--m",
			},
		]);
	});
});
