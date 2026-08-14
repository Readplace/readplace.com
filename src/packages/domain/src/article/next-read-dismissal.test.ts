import assert from "node:assert/strict";
import { MinutesSchema } from "./article.schema";
import type { SavedArticle } from "./article.types";
import {
	NEXT_READ_SNOOZE_MS,
	decideNextReadSlot,
	nextReadDismissalOf,
} from "./next-read-dismissal";
import { UserIdSchema } from "../user/user.schema";
import { ReaderArticleHashId } from "./reader-article-hash-id";

const NOW = new Date("2026-08-13T12:00:00.000Z");
const SUGGESTED = ReaderArticleHashId.fromHash("0123456789abcdef0123456789abcdef");
const SIBLING = ReaderArticleHashId.fromHash("fedcba9876543210fedcba9876543210");
const dismissedAgo = (ms: number) => new Date(NOW.getTime() - ms);

function buildArticle(overrides: Partial<SavedArticle> = {}): SavedArticle {
	return {
		id: SUGGESTED,
		userId: UserIdSchema.parse("user-1"),
		url: "https://example.com/article",
		metadata: { title: "t", siteName: "s", excerpt: "e", wordCount: 1 },
		estimatedReadTime: MinutesSchema.parse(1),
		status: "unread",
		savedAt: NOW,
		...overrides,
	};
}

describe("nextReadDismissalOf", () => {
	it("reads no dismissal off an article nobody has dismissed", () => {
		assert.equal(nextReadDismissalOf(buildArticle()), undefined);
	});

	it("carries the moment and the suggestion the reader waved away", () => {
		const at = dismissedAgo(1000);

		assert.deepEqual(
			nextReadDismissalOf(
				buildArticle({
					relatedDismissedAt: at,
					relatedDismissedSuggestionId: SUGGESTED,
				}),
			),
			{ at, suggestionId: SUGGESTED },
		);
	});
});

describe("decideNextReadSlot", () => {
	const unreadSuggestion = [{ id: SUGGESTED, status: "unread" }] as const;
	const readSuggestion = [{ id: SUGGESTED, status: "read" }] as const;

	it("shows the slot to a reader who never dismissed it", () => {
		assert.equal(
			decideNextReadSlot({
				dismissal: undefined,
				related: unreadSuggestion,
				now: NOW,
			}),
			"show",
		);
	});

	it("keeps a dismissal made before suggestions were recorded permanent, so nothing already waved away comes back", () => {
		assert.equal(
			decideNextReadSlot({
				dismissal: { at: dismissedAgo(NEXT_READ_SNOOZE_MS * 30), suggestionId: undefined },
				related: unreadSuggestion,
				now: NOW,
			}),
			"suppress",
		);
	});

	it("suppresses a dismissed past read for good", () => {
		assert.equal(
			decideNextReadSlot({
				dismissal: { at: dismissedAgo(NEXT_READ_SNOOZE_MS * 365), suggestionId: SUGGESTED },
				related: readSuggestion,
				now: NOW,
			}),
			"suppress",
		);
	});

	it("suppresses a dismissed unread suggestion for the rest of the day", () => {
		assert.equal(
			decideNextReadSlot({
				dismissal: { at: dismissedAgo(NEXT_READ_SNOOZE_MS - 1), suggestionId: SUGGESTED },
				related: unreadSuggestion,
				now: NOW,
			}),
			"suppress",
		);
	});

	it("shows a dismissed unread suggestion again once the day is up", () => {
		assert.equal(
			decideNextReadSlot({
				dismissal: { at: dismissedAgo(NEXT_READ_SNOOZE_MS), suggestionId: SUGGESTED },
				related: unreadSuggestion,
				now: NOW,
			}),
			"show",
		);
	});

	it("turns a dismissed suggestion permanent once the reader finishes it", () => {
		assert.equal(
			decideNextReadSlot({
				dismissal: { at: dismissedAgo(NEXT_READ_SNOOZE_MS * 2), suggestionId: SUGGESTED },
				related: readSuggestion,
				now: NOW,
			}),
			"suppress",
		);
	});

	it("shows the slot again once the dismissed suggestion is no longer among the relations", () => {
		assert.equal(
			decideNextReadSlot({
				dismissal: { at: dismissedAgo(1000), suggestionId: SUGGESTED },
				related: [{ id: SIBLING, status: "read" }],
				now: NOW,
			}),
			"show",
		);
	});

	it("judges the suggestion that was dismissed, not whichever one the card would pick now", () => {
		assert.equal(
			decideNextReadSlot({
				dismissal: { at: dismissedAgo(NEXT_READ_SNOOZE_MS * 2), suggestionId: SUGGESTED },
				related: [
					{ id: SIBLING, status: "unread" },
					{ id: SUGGESTED, status: "read" },
				],
				now: NOW,
			}),
			"suppress",
		);
	});
});
