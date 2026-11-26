import assert from "node:assert/strict";
import { ForwardableSenderSchema } from "../gmail/build-forwarding-filter-query";
import { GmailAccountEmailSchema } from "../gmail/gmail-account-email.schema";
import { GmailMessageIdSchema } from "../gmail/gmail-history-import.schema";
import {
	ISSUE_OUTPUT_KEY,
	amendEmailSelection,
	emailMatchBatch,
	isEmailSavedToAll,
	linkOutputKey,
	outputLinkOrdinal,
	uniqueGmailOrigins,
} from "./email-output";
import { formatEmailLinkOrdinal } from "./inbox-email-link.schema";

const link = linkOutputKey(formatEmailLinkOrdinal(3));
const selection = (outputs: typeof link[], truncated = false) => ({ outputs, truncated, selectedAt: "2026-10-27T00:00:00.000Z" });

describe("email output keys", () => {
	it("round-trips a link ordinal through its output key", () => {
		assert.equal(link, "link#0003");
		assert.equal(outputLinkOrdinal(link), "0003");
	});

	it("names no link ordinal for the issue output", () => {
		assert.equal(outputLinkOrdinal(ISSUE_OUTPUT_KEY), undefined);
	});
});

describe("isEmailSavedToAll", () => {
	it("is not saved before any selection is persisted", () => {
		assert.equal(isEmailSavedToAll({ selection: undefined, savedOutputs: new Set() }), false);
	});

	it("is saved once every selected output is acknowledged", () => {
		assert.equal(isEmailSavedToAll({ selection: selection([ISSUE_OUTPUT_KEY, link]), savedOutputs: new Set([link, ISSUE_OUTPUT_KEY]) }), true);
	});

	it("is not saved while one selected output is unacknowledged", () => {
		assert.equal(isEmailSavedToAll({ selection: selection([ISSUE_OUTPUT_KEY, link]), savedOutputs: new Set([ISSUE_OUTPUT_KEY]) }), false);
	});

	it("is saved when extraction selected nothing", () => {
		assert.equal(isEmailSavedToAll({ selection: selection([]), savedOutputs: new Set() }), true);
	});

	it("never counts truncated processing as saved", () => {
		assert.equal(isEmailSavedToAll({ selection: selection([link], true), savedOutputs: new Set([link]) }), false);
	});
});

describe("uniqueGmailOrigins", () => {
	it("collapses origins that name the same Gmail message", () => {
		const origin = { kind: "history" as const, accountEmail: GmailAccountEmailSchema.parse("a@gmail.com"), gmailMessageId: GmailMessageIdSchema.parse("m1"), senderEmail: ForwardableSenderSchema.parse("dan@news.test") };
		assert.deepEqual(uniqueGmailOrigins([origin, { ...origin, accountEmail: GmailAccountEmailSchema.parse("A@gmail.com") }]), [{ ...origin, accountEmail: "A@gmail.com" }]);
	});
});

describe("amendEmailSelection", () => {
	it("assigns a shared match once and waits for both readlists and the article save", () => {
		const work = emailMatchBatch("work", 0);
		const science = emailMatchBatch("science", 0);
		const first = { ...selection([ISSUE_OUTPUT_KEY]), matches: { [work]: null, [science]: null } };
		const matched = amendEmailSelection(first, { kind: "match", batch: work, outputs: [link, link] });
		assert.deepEqual(matched.matches?.[work], [link]);
		assert.equal(isEmailSavedToAll({ selection: matched, savedOutputs: new Set([ISSUE_OUTPUT_KEY, link]) }), false);
		const finished = amendEmailSelection(matched, { kind: "match", batch: science, outputs: [link] });
		assert.deepEqual(finished.matches?.[science], []);
		assert.deepEqual(finished.outputs, [ISSUE_OUTPUT_KEY, link]);
		assert.equal(isEmailSavedToAll({ selection: finished, savedOutputs: new Set([ISSUE_OUTPUT_KEY]) }), false);
		assert.equal(isEmailSavedToAll({ selection: finished, savedOutputs: new Set([ISSUE_OUTPUT_KEY, link]) }), true);
		assert.equal(amendEmailSelection(finished, { kind: "match", batch: work, outputs: [] }), finished);
	});

	it("lets a later decision fill a batch that a failed decision left empty", () => {
		const work = emailMatchBatch("work", 0);
		const failed = amendEmailSelection({ ...selection([ISSUE_OUTPUT_KEY]), matches: { [work]: null } }, { kind: "match", batch: work, outputs: [] });
		assert.deepEqual(failed.matches?.[work], []);
		assert.equal(isEmailSavedToAll({ selection: failed, savedOutputs: new Set([ISSUE_OUTPUT_KEY]) }), true);
		assert.equal(amendEmailSelection(failed, { kind: "match", batch: work, outputs: [] }), failed);
		const decided = amendEmailSelection(failed, { kind: "match", batch: work, outputs: [link] });
		assert.deepEqual(decided.matches?.[work], [link]);
		assert.deepEqual(decided.outputs, [ISSUE_OUTPUT_KEY, link]);
		assert.equal(amendEmailSelection(decided, { kind: "match", batch: work, outputs: [] }), decided);
	});

	it("ignores a decision for a batch the selection does not hold", () => {
		const first = selection([ISSUE_OUTPUT_KEY]);
		assert.equal(amendEmailSelection(first, { kind: "match", batch: emailMatchBatch("work", 0), outputs: [link] }), first);
	});

	it("keeps the existing issue and decisions when a continuation appends links", () => {
		const first = { ...selection([ISSUE_OUTPUT_KEY], true), nextLinkIndex: 300, matches: { "0#work": [] } };
		const page = { ...selection([link]), matches: { "300#work": null } };
		const continued = amendEmailSelection(first, { kind: "continue", start: 300, page });
		assert.deepEqual(continued, { ...selection([ISSUE_OUTPUT_KEY, link]), matches: { "0#work": [], "300#work": null } });
		assert.equal(amendEmailSelection(continued, { kind: "continue", start: 300, page }), continued);
	});

	it("can finish a continuation with no matching destinations", () => {
		const first = { ...selection([ISSUE_OUTPUT_KEY], true), nextLinkIndex: 300 };
		assert.deepEqual(amendEmailSelection(first, { kind: "continue", start: 300, page: selection([link]) }), selection([ISSUE_OUTPUT_KEY, link]));
	});
});
