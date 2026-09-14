import assert from "node:assert/strict";
import type { GmailFilter } from "@packages/provider-contracts/gmail-filters";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemoryGmailFilters } from "./in-memory-gmail-filters";

const USER = UserIdSchema.parse("00000000000000000000000000000001");
const GATEWAY = "gmail-a7b2c9@read.place";

describe("initInMemoryGmailFilters", () => {
	it("creates a forwarding filter, assigns the next id, and records the request", async () => {
		const gmail = initInMemoryGmailFilters();

		const result = await gmail.api.createForwardingFilter({
			userId: USER,
			query: "from:(dan@tldr.tech)",
			forwardTo: GATEWAY,
		});

		assert(result.ok);
		assert.equal(result.value.id, "f-101");
		assert.deepEqual(gmail.created, [{ query: "from:(dan@tldr.tech)", forwardTo: GATEWAY }]);
	});

	it("reads a stored filter back and refuses an id Gmail never issued", async () => {
		const seed: GmailFilter[] = [{ id: "f-live", query: "from:(dan@tldr.tech)", forwardTo: GATEWAY }];
		const gmail = initInMemoryGmailFilters(seed);

		const found = await gmail.api.getFilter({ userId: USER, filterId: "f-live" });
		assert(found.ok);
		assert.deepEqual(found.value, { id: "f-live", query: "from:(dan@tldr.tech)", forwardTo: GATEWAY });

		await assert.rejects(
			() => gmail.api.getFilter({ userId: USER, filterId: "f-missing" }),
			/getFilter must be called with an id Gmail knows/,
		);
	});

	it("lists the current set and deletes a filter by id", async () => {
		const gmail = initInMemoryGmailFilters([
			{ id: "f-a", query: "from:(dan@tldr.tech)", forwardTo: GATEWAY },
			{ id: "f-b", query: "from:(crew@morningbrew.com)", forwardTo: GATEWAY },
		]);

		const before = await gmail.api.listFilters({ userId: USER });
		assert(before.ok);
		assert.equal(before.value.length, 2);

		await gmail.api.deleteFilter({ userId: USER, filterId: "f-a" });
		assert.deepEqual(gmail.deleted, ["f-a"]);

		const after = await gmail.api.listFilters({ userId: USER });
		assert(after.ok);
		assert.deepEqual(
			after.value.map((filter) => filter.id),
			["f-b"],
		);
	});
});
