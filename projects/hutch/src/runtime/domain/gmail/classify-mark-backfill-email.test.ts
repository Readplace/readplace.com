import assert from "node:assert/strict";
import {
	ForwardableSenderSchema,
	GmailAccountEmailSchema,
	type GmailMarkBackfillRef,
	GmailMessageIdSchema,
	type GmailMessageOrigin,
} from "@packages/domain/gmail";
import {
	type EmailImportCandidate,
	EmailLinkOrdinalSchema,
	type EmailOutputKey,
	ISSUE_OUTPUT_KEY,
	InboxAddressSchema,
	type InboxEmailLinksMeta,
	MessageIdSchema,
	NormalizedMessageIdSchema,
	linkOutputKey,
} from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { classifyMarkBackfillEmail, needsLinksMeta } from "./classify-mark-backfill-email";

const ACCOUNT = GmailAccountEmailSchema.parse("reader@gmail.com");
const SENDER = ForwardableSenderSchema.parse("dan@news.test");
const JOB: GmailMarkBackfillRef = { userId: UserIdSchema.parse("00000000000000000000000000000001"), accountEmail: ACCOUNT, senderEmail: SENDER };
const LINK = linkOutputKey(EmailLinkOrdinalSchema.parse("0000"));
const HISTORY_ORIGIN: GmailMessageOrigin = { kind: "history", accountEmail: ACCOUNT, gmailMessageId: GmailMessageIdSchema.parse("18c2f0a1b2c3d4e5"), senderEmail: SENDER };
const OTHER_ACCOUNT_ORIGIN: GmailMessageOrigin = {
	kind: "history",
	accountEmail: GmailAccountEmailSchema.parse("someone@gmail.com"),
	gmailMessageId: GmailMessageIdSchema.parse("18c2f0a1b2c3d4e6"),
	senderEmail: SENDER,
};
const SAVED_META: InboxEmailLinksMeta = {
	truncated: false,
	extractionFailed: false,
	savesHeld: false,
	issueSave: { readlists: [], held: false },
};

function candidate(overrides: Partial<EmailImportCandidate> = {}): EmailImportCandidate {
	return {
		receivedAtMessageId: "2026-10-01T00:00:00.000Z#<issue@news.test>",
		messageId: MessageIdSchema.parse("<issue@news.test>"),
		senderEmail: "Dan@News.test",
		status: "received",
		gmailDestinationAddresses: [InboxAddressSchema.parse("gmail-abc123@read.place")],
		gmailDeliveryMode: undefined,
		selection: undefined,
		savedOutputs: new Set(),
		origins: [],
		...overrides,
	};
}

function selected(outputs: EmailOutputKey[]) {
	return { outputs, truncated: false, selectedAt: "2026-10-01T00:00:01.000Z" };
}

const FORWARDED_FROM_MESSAGE_ID: GmailMessageOrigin = {
	kind: "forwarded",
	accountEmail: ACCOUNT,
	rfcMessageId: NormalizedMessageIdSchema.parse("issue@news.test"),
	senderEmail: SENDER,
};

describe("classifyMarkBackfillEmail", () => {
	it("leaves an email that was not received as other", () => {
		assert.deepEqual(classifyMarkBackfillEmail({ email: candidate({ status: "unparsed" }), meta: SAVED_META, job: JOB }), { kind: "other" });
	});

	it("leaves an email that did not arrive through Gmail as other", () => {
		assert.deepEqual(classifyMarkBackfillEmail({ email: candidate({ gmailDestinationAddresses: undefined }), meta: SAVED_META, job: JOB }), { kind: "other" });
	});

	it("leaves an email from another sender as other", () => {
		assert.deepEqual(classifyMarkBackfillEmail({ email: candidate({ senderEmail: "kate@news.test" }), meta: SAVED_META, job: JOB }), { kind: "other" });
	});

	it("leaves an email whose sender cannot be forwarded as other", () => {
		assert.deepEqual(classifyMarkBackfillEmail({ email: candidate({ senderEmail: "not an address" }), meta: SAVED_META, job: JOB }), { kind: "other" });
	});

	it("counts an email with a selection that is not saved everywhere as not saved", () => {
		const email = candidate({ selection: selected([LINK, ISSUE_OUTPUT_KEY]), savedOutputs: new Set([LINK]), origins: [HISTORY_ORIGIN] });

		assert.deepEqual(classifyMarkBackfillEmail({ email, meta: undefined, job: JOB }), { kind: "not-saved" });
	});

	it("counts an email with origins but no selection yet as not saved", () => {
		assert.deepEqual(classifyMarkBackfillEmail({ email: candidate({ origins: [HISTORY_ORIGIN] }), meta: SAVED_META, job: JOB }), { kind: "not-saved" });
	});

	it("marks an email saved to every selected output through its own account's origins", () => {
		const email = candidate({ selection: selected([LINK]), savedOutputs: new Set([LINK]), origins: [OTHER_ACCOUNT_ORIGIN, HISTORY_ORIGIN] });

		assert.deepEqual(classifyMarkBackfillEmail({ email, meta: undefined, job: JOB }), { kind: "eligible", origins: [HISTORY_ORIGIN] });
	});

	it("cannot locate a saved email whose origins all belong to another account", () => {
		const email = candidate({ selection: selected([LINK]), savedOutputs: new Set([LINK]), origins: [OTHER_ACCOUNT_ORIGIN] });

		assert.deepEqual(classifyMarkBackfillEmail({ email, meta: undefined, job: JOB }), { kind: "unlocatable" });
	});

	it("locates a saved email without origins by its Message-ID in the mapping's account", () => {
		const email = candidate({ selection: selected([ISSUE_OUTPUT_KEY]), savedOutputs: new Set([ISSUE_OUTPUT_KEY]) });

		assert.deepEqual(classifyMarkBackfillEmail({ email, meta: undefined, job: JOB }), { kind: "eligible", origins: [FORWARDED_FROM_MESSAGE_ID] });
	});

	it("cannot locate a saved email whose Message-ID was synthesised", () => {
		const email = candidate({ messageId: MessageIdSchema.parse("sha256:abc"), selection: selected([LINK]), savedOutputs: new Set([LINK]) });

		assert.deepEqual(classifyMarkBackfillEmail({ email, meta: undefined, job: JOB }), { kind: "unlocatable" });
	});

	describe("an email saved before selections were recorded", () => {
		it("is marked when its links meta shows the links were saved", () => {
			assert.deepEqual(classifyMarkBackfillEmail({ email: candidate(), meta: SAVED_META, job: JOB }), { kind: "eligible", origins: [FORWARDED_FROM_MESSAGE_ID] });
		});

		it("is marked when its links meta shows the issue was saved", () => {
			const meta = { ...SAVED_META, savesHeld: undefined };

			assert.deepEqual(classifyMarkBackfillEmail({ email: candidate({ gmailDeliveryMode: "issue" }), meta, job: JOB }), {
				kind: "eligible",
				origins: [FORWARDED_FROM_MESSAGE_ID],
			});
		});

		it("is left alone when it has no links meta", () => {
			assert.deepEqual(classifyMarkBackfillEmail({ email: candidate(), meta: undefined, job: JOB }), { kind: "unverifiable" });
		});

		it("is left alone when its links meta predates held link saves", () => {
			assert.deepEqual(classifyMarkBackfillEmail({ email: candidate(), meta: { ...SAVED_META, savesHeld: undefined }, job: JOB }), { kind: "unverifiable" });
		});

		it("is left alone when its links meta predates held issue saves", () => {
			const meta = { ...SAVED_META, issueSave: undefined };

			assert.deepEqual(classifyMarkBackfillEmail({ email: candidate({ gmailDeliveryMode: "both" }), meta, job: JOB }), { kind: "unverifiable" });
		});

		it("is not saved when its link extraction failed", () => {
			assert.deepEqual(classifyMarkBackfillEmail({ email: candidate(), meta: { ...SAVED_META, extractionFailed: true }, job: JOB }), { kind: "not-saved" });
		});

		it("is not saved when its links were truncated", () => {
			assert.deepEqual(classifyMarkBackfillEmail({ email: candidate(), meta: { ...SAVED_META, truncated: true }, job: JOB }), { kind: "not-saved" });
		});

		it("is not saved when its link saves were held", () => {
			assert.deepEqual(classifyMarkBackfillEmail({ email: candidate(), meta: { ...SAVED_META, savesHeld: true }, job: JOB }), { kind: "not-saved" });
		});

		it("is not saved when its issue save was held", () => {
			const meta = { ...SAVED_META, issueSave: { readlists: [], held: true } };

			assert.deepEqual(classifyMarkBackfillEmail({ email: candidate({ gmailDeliveryMode: "issue" }), meta, job: JOB }), { kind: "not-saved" });
		});
	});
});

describe("needsLinksMeta", () => {
	it("asks for the links meta of a mapped sender's email with no recorded selection or origins", () => {
		assert.equal(needsLinksMeta({ email: candidate(), job: JOB }), true);
	});

	it("does not ask for the links meta of an email with a recorded selection", () => {
		assert.equal(needsLinksMeta({ email: candidate({ selection: selected([LINK]) }), job: JOB }), false);
	});

	it("does not ask for the links meta of an email with recorded origins", () => {
		assert.equal(needsLinksMeta({ email: candidate({ origins: [HISTORY_ORIGIN] }), job: JOB }), false);
	});

	it("does not ask for the links meta of another sender's email", () => {
		assert.equal(needsLinksMeta({ email: candidate({ senderEmail: "kate@news.test" }), job: JOB }), false);
	});
});
