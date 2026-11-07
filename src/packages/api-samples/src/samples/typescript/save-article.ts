import assert from "node:assert";
import { z } from "zod";
import { type SirenCollection, sirenHeaders } from "./discover";

const savedArticle = z.object({
	class: z.array(z.string()),
	properties: z.object({ url: z.string() }),
});
export type SavedArticle = z.infer<typeof savedArticle>;

export async function saveArticle(params: {
	origin: string;
	token: string;
	collection: SirenCollection;
	url: string;
	readlists?: string[];
}): Promise<SavedArticle> {
	const action = params.collection.actions.find((candidate) => candidate.name === "save-article");
	assert(action, "the collection advertises no save-article action");
	const response = await fetch(new URL(action.href, params.origin), {
		method: action.method,
		headers: {
			...sirenHeaders(params.token),
			"Content-Type": action.type ?? "application/json",
			Prefer: "return=representation",
		},
		body: JSON.stringify({ url: params.url, readlists: params.readlists }),
	});
	assert.equal(response.status, 201, `save-article answered ${response.status}`);
	return savedArticle.parse(await response.json());
}
