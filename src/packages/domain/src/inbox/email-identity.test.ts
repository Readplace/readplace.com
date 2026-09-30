import assert from "node:assert/strict";
import { ForwardableSenderSchema } from "../gmail/build-forwarding-filter-query";
import { GmailAccountEmailSchema } from "../gmail/gmail-account-email.schema";
import { GmailHistoryImportJobIdSchema, GmailMessageIdSchema } from "../gmail/gmail-history-import.schema";
import { UserIdSchema } from "../user";
import {
	ingestionAttemptKey,
	messageIdentityKey,
	NormalizedMessageIdSchema,
	normalizeMessageId,
} from "./email-identity";
import { MessageIdSchema } from "./inbox-email.schema";

describe("normalizeMessageId", () => {
	it("strips the angle brackets and surrounding whitespace of a Message-ID header", () => {
		assert.equal(normalizeMessageId(MessageIdSchema.parse("  <CAF=abc.123@mail.gmail.com> ")), "CAF=abc.123@mail.gmail.com");
	});

	it("trims whitespace left inside the angle brackets", () => {
		assert.equal(normalizeMessageId(MessageIdSchema.parse("< abc@example.com >")), "abc@example.com");
	});

	it("keeps a Message-ID that arrives without angle brackets, preserving its case", () => {
		assert.equal(normalizeMessageId(MessageIdSchema.parse("ABC@Example.COM")), "ABC@Example.COM");
	});

	it("strips only one pair of angle brackets", () => {
		assert.equal(normalizeMessageId(MessageIdSchema.parse("<<abc@example.com>>")), "<abc@example.com>");
	});

	it("has no identity for the byte-hash fallback of a message without a Message-ID", () => {
		assert.equal(normalizeMessageId(MessageIdSchema.parse(`sha256:${"a".repeat(64)}`)), undefined);
	});

	it("has no identity for an empty pair of angle brackets", () => {
		assert.equal(normalizeMessageId(MessageIdSchema.parse("< >")), undefined);
	});
});

describe("messageIdentityKey", () => {
	it("keys an email by its owner, sender and Message-ID", () => {
		const key = messageIdentityKey({
			userId: UserIdSchema.parse("user-1"),
			sender: ForwardableSenderSchema.parse("dan@tldr.tech"),
			messageId: NormalizedMessageIdSchema.parse("abc@example.com"),
		});

		assert.equal(key, "MSG#user-1#dan@tldr.tech#abc@example.com");
	});
});

describe("ingestionAttemptKey", () => {
	it("identifies a forwarded delivery by its SES message", () => {
		assert.equal(ingestionAttemptKey({ origin: "receive", sesMessageId: "ses-1" }), "receive#ses-1");
	});

	it("identifies an imported message by its job, Gmail account and Gmail message", () => {
		const key = ingestionAttemptKey({
			origin: "gmail-import",
			jobId: GmailHistoryImportJobIdSchema.parse("0123456789abcdef0123456789abcdef"),
			accountEmail: GmailAccountEmailSchema.parse("reader@gmail.com"),
			gmailMessageId: GmailMessageIdSchema.parse("18c2f0a1b2c3d4e5"),
		});

		assert.equal(key, "gmail-import#0123456789abcdef0123456789abcdef#reader@gmail.com#18c2f0a1b2c3d4e5");
	});

	it("gives every adoption of a pre-existing row the same identity", () => {
		assert.equal(ingestionAttemptKey({ origin: "pre-claim-row" }), "pre-claim-row");
	});
});
