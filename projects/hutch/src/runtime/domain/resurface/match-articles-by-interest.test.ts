import assert from "node:assert/strict";
import { initMatchArticlesByInterest, type CreateChatCompletion } from "./match-articles-by-interest";
import type { ResurfaceCandidate } from "@packages/provider-contracts/resurface";

const candidates: ResurfaceCandidate[] = [
	{ id: "a", title: "Espresso", text: "Coffee history." },
	{ id: "b", title: "Rust", text: "Borrow checker." },
	{ id: "c", title: "Latte", text: "Milk art." },
];

function stubCompletion(content: string): {
	createChatCompletion: CreateChatCompletion;
	calls: Parameters<CreateChatCompletion>[0][];
} {
	const calls: Parameters<CreateChatCompletion>[0][] = [];
	const createChatCompletion: CreateChatCompletion = async (params) => {
		calls.push(params);
		return { choices: [{ message: { content } }] };
	};
	return { createChatCompletion, calls };
}

describe("initMatchArticlesByInterest", () => {
	it("maps the 1-based numbers DeepSeek returns back to article ids", async () => {
		const { createChatCompletion, calls } = stubCompletion('{"matches":[3,1]}');
		const match = initMatchArticlesByInterest({ createChatCompletion });

		const { matchedIds } = await match({ prompt: "coffee", candidates });

		assert.deepEqual(matchedIds, ["c", "a"]);
		assert.equal(calls.length, 1);
		assert.equal(calls[0].temperature, 0);
		assert.equal(calls[0].response_format.type, "json_object");
		assert.match(calls[0].messages[1].content, /Reader's interest: coffee/);
		assert.match(calls[0].messages[1].content, /1\. Espresso/);
	});

	it("short-circuits without calling DeepSeek when there are no candidates", async () => {
		const { createChatCompletion, calls } = stubCompletion('{"matches":[1]}');
		const match = initMatchArticlesByInterest({ createChatCompletion });

		const { matchedIds } = await match({ prompt: "coffee", candidates: [] });

		assert.deepEqual(matchedIds, []);
		assert.equal(calls.length, 0);
	});

	it("drops out-of-range and duplicate numbers", async () => {
		const { createChatCompletion } = stubCompletion('{"matches":[2,2,99,0]}');
		const match = initMatchArticlesByInterest({ createChatCompletion });

		const { matchedIds } = await match({ prompt: "rust", candidates });

		assert.deepEqual(matchedIds, ["b"]);
	});

	it("returns an empty list when DeepSeek matches nothing", async () => {
		const { createChatCompletion } = stubCompletion('{"matches":[]}');
		const match = initMatchArticlesByInterest({ createChatCompletion });

		const { matchedIds } = await match({ prompt: "astrophysics", candidates });

		assert.deepEqual(matchedIds, []);
	});

	it("throws when the response carries no message content", async () => {
		const createChatCompletion: CreateChatCompletion = async () => ({ choices: [] });
		const match = initMatchArticlesByInterest({ createChatCompletion });

		await assert.rejects(
			() => match({ prompt: "coffee", candidates }),
			/missing message content/,
		);
	});
});
