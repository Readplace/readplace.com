import assert from "node:assert/strict";
import { initRescueAttempts } from "./rescue-attempts";

function createStore(initial: unknown) {
	let value = initial;
	const writes: string[][] = [];
	return {
		store: {
			read: async () => {
				await Promise.resolve();
				return value;
			},
			write: async (articleIds: string[]) => {
				await Promise.resolve();
				writes.push(articleIds);
				value = articleIds;
			},
		},
		writes,
	};
}

describe("initRescueAttempts", () => {
	it("claims an article id once per device", async () => {
		const { store, writes } = createStore(undefined);
		const attempts = initRescueAttempts({ store });

		assert.equal(await attempts.claim("article-1"), "first");
		assert.equal(await attempts.claim("article-2"), "first");
		assert.equal(await attempts.claim("article-1"), "repeat");

		assert.deepEqual(writes, [["article-1"], ["article-1", "article-2"]]);
	});

	it("treats a malformed store as empty", async () => {
		const { store, writes } = createStore({ articleIds: "article-1" });
		const attempts = initRescueAttempts({ store });

		assert.equal(await attempts.claim("article-1"), "first");

		assert.deepEqual(writes, [["article-1"]]);
	});

	it("settles claims made together one after another, so none is lost", async () => {
		const { store, writes } = createStore(undefined);
		const attempts = initRescueAttempts({ store });

		const answers = await Promise.all([
			attempts.claim("article-1"),
			attempts.claim("article-1"),
			attempts.claim("article-2"),
		]);

		assert.deepEqual(answers, ["first", "repeat", "first"]);
		assert.deepEqual(writes, [["article-1"], ["article-1", "article-2"]]);
	});

	it("keeps claiming after a claim whose store read failed", async () => {
		const { store, writes } = createStore(undefined);
		let failNextRead = true;
		const attempts = initRescueAttempts({
			store: {
				read: async () => {
					if (!failNextRead) return store.read();
					failNextRead = false;
					throw new Error("storage unavailable");
				},
				write: store.write,
			},
		});

		const [failed, claimed] = await Promise.allSettled([attempts.claim("article-1"), attempts.claim("article-2")]);

		assert.equal(failed.status, "rejected");
		assert.deepEqual(claimed, { status: "fulfilled", value: "first" });
		assert.deepEqual(writes, [["article-2"]]);
	});
});
