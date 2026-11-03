import assert from "node:assert/strict";
import { formatEmailLinkOrdinal } from "../inbox/inbox-email-link.schema";
import {
	ReadlistFitOverrideIdSchema,
	readlistFitChoiceLabel,
	readlistFitOverrideHost,
	readlistFitOverrideId,
} from "./readlist-fit-override";

describe("readlistFitOverrideHost", () => {
	it("drops a leading www. so a host reads the way the email list shows it", () => {
		assert.equal(readlistFitOverrideHost("https://www.Example.com/post"), "example.com");
	});

	it("keeps every other subdomain", () => {
		assert.equal(readlistFitOverrideHost("https://blog.example.com/post"), "blog.example.com");
	});
});

describe("readlistFitChoiceLabel", () => {
	it("names a kept article as kept in the readlist", () => {
		assert.equal(readlistFitChoiceLabel({ readerVerdict: "keep", label: "Work" }), "Kept in Work");
	});

	it("names a removed article as not in the readlist", () => {
		assert.equal(readlistFitChoiceLabel({ readerVerdict: "drop", label: "Work" }), "Not in Work");
	});
});

describe("ReadlistFitOverrideIdSchema", () => {
	it("accepts an inverted timestamp, a message id and an ordinal", () => {
		assert.equal(
			ReadlistFitOverrideIdSchema.safeParse("9005420000000000-2026-11-02T21:15:00.000Z#abc-0003").success,
			true,
		);
	});

	it("refuses an id without its ordinal", () => {
		assert.equal(ReadlistFitOverrideIdSchema.safeParse("9005420000000000-abc").success, false);
	});
});

describe("readlistFitOverrideId", () => {
	const ordinal = formatEmailLinkOrdinal(3);
	const receivedAtMessageId = "2026-11-02T21:15:00.000Z#msg-1";

	it("sorts a later choice before an earlier one", () => {
		const earlier = readlistFitOverrideId({ createdAt: new Date("2026-11-03T08:00:00.000Z"), receivedAtMessageId, ordinal });
		const later = readlistFitOverrideId({ createdAt: new Date("2026-11-03T08:00:00.001Z"), receivedAtMessageId, ordinal });

		assert.equal(later < earlier, true);
	});

	it("pads the inverted time to 16 digits so ids sort as text", () => {
		const id = readlistFitOverrideId({ createdAt: new Date(8_640_000_000_000_000), receivedAtMessageId, ordinal });

		assert.equal(id, `0367199254740991-${receivedAtMessageId}-0003`);
	});
});
