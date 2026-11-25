import assert from "node:assert/strict";
import { ForwardableSenderSchema, GmailAccountEmailSchema } from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemoryGmailMapping } from "@packages/test-fixtures/providers/gmail-mapping";
import { initIsGmailSenderMapped } from "./mark-imported-gate";

const ref = {
	userId: UserIdSchema.parse("00000000000000000000000000000001"),
	accountEmail: GmailAccountEmailSchema.parse("reader@gmail.com"),
	senderEmail: ForwardableSenderSchema.parse("dan@news.test"),
};

describe("initIsGmailSenderMapped", () => {
	it.each([false, true])("allows a configured sender regardless of its old checkbox state (%s)", async (oldCheckbox) => {
		const mappings = initInMemoryGmailMapping({ now: () => new Date("2026-10-27T00:00:00.000Z") });
		await mappings.addSenderToFilter(ref);
		await mappings.mapSenderToAddress({ ...ref, mappedAddresses: [InboxAddressSchema.parse("reader-abc123@read.place")], deliveryMode: "issue" });
		if (oldCheckbox) await mappings.setMarkImported(ref);

		assert.equal(await initIsGmailSenderMapped({ findMapping: mappings.findMapping })(ref), true);
	});

	it("requires both a forwarding sender and a selected destination", async () => {
		const mappings = initInMemoryGmailMapping({ now: () => new Date() });
		const isMapped = initIsGmailSenderMapped({ findMapping: mappings.findMapping });

		assert.equal(await isMapped(ref), false);
		await mappings.addSenderToFilter(ref);
		assert.equal(await isMapped(ref), false);
	});
});
