import assert from "node:assert/strict";
import { EmailLinkOrdinalSchema, type InboxEmailLinkEntry, type InboxLinkSaveState } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { JSDOM } from "jsdom";
import { type IssueLinksSectionInput, renderIssueLinksSection } from "./issue-links.component";

function parse(html: string) {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window.document;
}

const READER = UserIdSchema.parse("00000000000000000000000000000001");

function link(overrides: Omit<Partial<InboxEmailLinkEntry>, "ordinal"> & { ordinal: string; url: string }): InboxEmailLinkEntry {
	return {
		userId: READER,
		receivedAtMessageId: "2026-06-24T09:00:00.000Z#<m@x>",
		resolvedUrl: undefined,
		status: "pending",
		title: undefined,
		excerpt: undefined,
		siteName: undefined,
		imageUrl: undefined,
		failureReason: undefined,
		skipReason: undefined,
		droppedFor: undefined,
		...overrides,
		ordinal: EmailLinkOrdinalSchema.parse(overrides.ordinal),
	};
}

function issue(overrides: Partial<IssueLinksSectionInput> = {}): IssueLinksSectionInput {
	return {
		links: [],
		extraction: "finished",
		saveStates: new Map<string, InboxLinkSaveState>(),
		justSaved: undefined,
		saveUrl: "/queue/abc/issue-links?utm_source=reader",
		returnTo: "/queue/abc/view",
		inboxHref: "/inbox/2026-06-24?tab=articles",
		...overrides,
	};
}

function sectionOf(html: string) {
	const section = parse(html).querySelector("[data-test-reader-issue-links]");
	assert(section, "the issue links section always renders");
	return section;
}

function rowsOf(html: string) {
	return Array.from(parse(html).querySelectorAll("[data-test-issue-link]")).map((row) => ({
		ordinal: row.getAttribute("data-test-issue-link"),
		title: row.querySelector(".issue-links__link-title")?.textContent,
		href: row.querySelector("a")?.getAttribute("href"),
		host: row.querySelector(".issue-links__host-name")?.textContent,
		saveState: row.querySelector("[data-test-issue-link-save-state]")?.getAttribute("data-test-issue-link-save-state"),
		label: row.querySelector("button")?.textContent,
	}));
}

describe("renderIssueLinksSection", () => {
	it("renders a hidden section for an article that is not a newsletter issue", () => {
		const section = sectionOf(renderIssueLinksSection(undefined));

		assert.deepEqual(
			[section.getAttribute("data-issue-links-state"), section.className],
			["absent", "issue-links issue-links--hidden"],
		);
	});

	it("lists the issue's article links with a Save button each, titled by their previews where they have one", () => {
		const html = renderIssueLinksSection(
			issue({
				links: [
					link({ ordinal: "0000", url: "https://a.test/x", status: "crawled", title: "The first article", resolvedUrl: "https://www.a.test/x" }),
					link({ ordinal: "0001", url: "https://b.test/y" }),
				],
			}),
		);

		assert.deepEqual(rowsOf(html), [
			{ ordinal: "0000", title: "The first article", href: "https://www.a.test/x", host: "www.a.test", saveState: "unsaved", label: "Save" },
			{ ordinal: "0001", title: "https://b.test/y", href: "https://b.test/y", host: "b.test", saveState: "unsaved", label: "Save" },
		]);
		assert.equal(
			parse(html).querySelector("[data-test-issue-links-lede]")?.textContent,
			"Save the ones worth reading. The rest stay with the email.",
		);
	});

	it("leaves out links the reader could not save as an article", () => {
		const html = renderIssueLinksSection(
			issue({
				links: [
					link({ ordinal: "0000", url: "https://a.test/unsubscribe", status: "skipped", skipReason: "list-unsubscribe" }),
					link({ ordinal: "0001", url: "https://localhost/admin" }),
					link({ ordinal: "0002", url: "https://c.test/z" }),
				],
			}),
		);

		assert.deepEqual(rowsOf(html).map(({ ordinal }) => ordinal), ["0002"]);
	});

	it("shows which links are already saved, which failed, and the one just saved", () => {
		const html = renderIssueLinksSection(
			issue({
				links: [
					link({ ordinal: "0000", url: "https://a.test/x" }),
					link({ ordinal: "0001", url: "https://b.test/y" }),
					link({ ordinal: "0002", url: "https://c.test/z" }),
				],
				saveStates: new Map<string, InboxLinkSaveState>([
					["https://a.test/x", "saved"],
					["https://b.test/y", "failed"],
				]),
				justSaved: EmailLinkOrdinalSchema.parse("0002"),
			}),
		);

		assert.deepEqual(
			rowsOf(html).map(({ saveState, label }) => [saveState, label]),
			[
				["saved", "Save again"],
				["failed", "Try again"],
				["saved", "Save again"],
			],
		);
	});

	it("says the issue has no article links once its links are read and none qualify", () => {
		const html = renderIssueLinksSection(issue());

		assert.deepEqual(
			[sectionOf(html).getAttribute("data-issue-links-state"), parse(html).querySelector("[data-test-issue-links-lede]")?.textContent],
			["ready", "This issue has no links to articles."],
		);
	});

	it("says the links are still being found while the issue is being read", () => {
		const html = renderIssueLinksSection(issue({ extraction: "pending" }));

		assert.deepEqual(
			[sectionOf(html).getAttribute("data-issue-links-state"), parse(html).querySelector("[data-test-issue-links-lede]")?.textContent],
			["extracting", "Still finding the links in this issue. Reload in a moment to see them."],
		);
	});

	it("says so when the issue's links could not be read", () => {
		const html = renderIssueLinksSection(issue({ extraction: "failed" }));

		assert.deepEqual(
			[sectionOf(html).getAttribute("data-issue-links-state"), parse(html).querySelector("[data-test-issue-links-lede]")?.textContent],
			["failed", "Couldn't read the links in this issue."],
		);
	});

	it("posts each save back to the reader's own issue links route and links to the email in the inbox", () => {
		const doc = parse(renderIssueLinksSection(issue({ links: [link({ ordinal: "0000", url: "https://a.test/x" })] })));
		const form = doc.querySelector("[data-test-issue-link] form");
		assert(form, "every listed link has a save form");

		assert.deepEqual(
			[
				form.getAttribute("action"),
				Array.from(form.querySelectorAll("input")).map((input) => [input.name, input.value]),
				doc.querySelector("[data-test-issue-links-inbox]")?.getAttribute("href"),
			],
			[
				"/queue/abc/issue-links?utm_source=reader",
				[
					["ordinal", "0000"],
					["returnTo", "/queue/abc/view"],
				],
				"/inbox/2026-06-24?tab=articles",
			],
		);
	});
});
