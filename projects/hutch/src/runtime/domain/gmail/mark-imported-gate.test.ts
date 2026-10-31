import assert from "node:assert/strict";
import { ForwardableSenderSchema, GmailAccountEmailSchema } from "@packages/domain/gmail";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemoryGmailMapping } from "@packages/test-fixtures/providers/gmail-mapping";
import { initFindMarkImportedSince } from "./mark-imported-gate";

const USER = UserIdSchema.parse("00000000000000000000000000000001");
const ACCOUNT = GmailAccountEmailSchema.parse("reader@gmail.com");
const SENDER = ForwardableSenderSchema.parse("dan@news.test");
const NOW = new Date("2026-10-27T00:00:00.000Z");

describe("initFindMarkImportedSince", () => {
	it("reads when the sender's marking was turned on", async () => {
		const mappings = initInMemoryGmailMapping({ now: () => NOW });
		await mappings.addSenderToFilter({ userId: USER, accountEmail: ACCOUNT, senderEmail: SENDER });
		await mappings.setMarkImported({ userId: USER, accountEmail: ACCOUNT, senderEmail: SENDER });

		const since = await initFindMarkImportedSince({ findMapping: mappings.findMapping })({ userId: USER, accountEmail: ACCOUNT, senderEmail: SENDER });

		assert.equal(since, NOW.toISOString());
	});

	it("answers nothing for a sender that is no longer mapped", async () => {
		const mappings = initInMemoryGmailMapping({ now: () => NOW });

		const since = await initFindMarkImportedSince({ findMapping: mappings.findMapping })({ userId: USER, accountEmail: ACCOUNT, senderEmail: SENDER });

		assert.equal(since, undefined);
	});
});
