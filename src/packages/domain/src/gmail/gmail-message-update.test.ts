import assert from "node:assert/strict";
import { NormalizedMessageIdSchema } from "../inbox/email-identity";
import { ForwardableSenderSchema } from "./build-forwarding-filter-query";
import { GmailAccountEmailSchema } from "./gmail-account-email.schema";
import { GmailMessageIdSchema } from "./gmail-history-import.schema";
import { gmailAccountKey, gmailMessageOriginKey, sameGmailAccount } from "./gmail-message-update";

const account = GmailAccountEmailSchema.parse("Reader@Gmail.com");

describe("gmailMessageOriginKey", () => {
	it("keys a history origin by its account and Gmail message id", () => {
		assert.equal(
			gmailMessageOriginKey({ kind: "history", accountEmail: account, gmailMessageId: GmailMessageIdSchema.parse("abc123"), senderEmail: ForwardableSenderSchema.parse("news@example.com") }),
			"history#reader@gmail.com#abc123",
		);
	});

	it("keys a forwarded origin by its account, sender and RFC Message-ID", () => {
		assert.equal(
			gmailMessageOriginKey({
				kind: "forwarded",
				accountEmail: account,
				senderEmail: ForwardableSenderSchema.parse("news@example.com"),
				rfcMessageId: NormalizedMessageIdSchema.parse("id@example.com"),
			}),
			"forwarded#reader@gmail.com#news@example.com#id@example.com",
		);
	});
});

describe("gmail account comparison", () => {
	it("treats addresses differing only in case and padding as the same account", () => {
		assert.equal(sameGmailAccount(" Reader@gmail.com", "reader@GMAIL.com "), true);
		assert.equal(gmailAccountKey(account), "reader@gmail.com");
	});

	it("treats different addresses as different accounts", () => {
		assert.equal(sameGmailAccount("reader@gmail.com", "other@gmail.com"), false);
	});
});
