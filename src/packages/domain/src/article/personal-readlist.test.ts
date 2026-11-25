import { UserIdSchema } from "../user";
import { SaveAttemptIdSchema } from "./article.schema";
import { personalDecisionKey, personalReadlistOrder, personalReadlistPartition } from "./personal-readlist";
import { ReaderArticleHashId } from "./reader-article-hash-id";

describe("personal readlist storage keys", () => {
	const owner = UserIdSchema.parse("reader");
	const at = "2026-11-24T00:00:00.000Z";

	it("orders simultaneous decisions by their originating attempt", () => {
		const decision = (instant: string, id: string) =>
			personalDecisionKey({ requestedAt: instant, attemptId: SaveAttemptIdSchema.parse(id) });
		expect(decision(at, "a")).toBe(decision("2026-11-24T00:00:00Z", "a"));
		expect([decision(at, "b"), decision(at, "a")].sort()).toEqual([decision(at, "a"), decision(at, "b")]);
	});
	it("partitions by account, classification and reading status", () => {
		expect(personalReadlistPartition(owner, "uncertain", "unread")).toBe("reader#uncertain#unread");
		expect(personalReadlistPartition(owner, "picked", "read")).toBe("reader#picked#read");
	});
	it("breaks article order ties with their canonical reader identity", () => {
		const hash = ReaderArticleHashId.from("https://example.com/article");
		expect(personalReadlistOrder("2026-11-24T11:00:00+11:00", hash)).toBe(`${at}#${hash.value}`);
	});
});
