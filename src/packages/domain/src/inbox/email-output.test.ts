import assert from "node:assert/strict";
import { ForwardableSenderSchema } from "../gmail/build-forwarding-filter-query";
import { GmailAccountEmailSchema } from "../gmail/gmail-account-email.schema";
import { GmailMessageIdSchema } from "../gmail/gmail-history-import.schema";
import {
	ISSUE_OUTPUT_KEY,
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
