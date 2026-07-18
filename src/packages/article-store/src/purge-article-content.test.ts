import { initPurgeArticleContent } from "./purge-article-content";

const ENCODED = "example.com%2Fpost";

describe("initPurgeArticleContent", () => {
	it("deletes the canonical body plus every image, tier source, and version snapshot under the URL's prefixes", async () => {
		const listedPrefixes: string[] = [];
		const deleted: string[][] = [];
		const keysByPrefix: Record<string, string[]> = {
			[`content/${ENCODED}/images/`]: [`content/${ENCODED}/images/a.png`],
			[`articles/${ENCODED}/sources/`]: [
				`articles/${ENCODED}/sources/tier-0.html`,
				`articles/${ENCODED}/sources/tier-0.metadata.json`,
				`articles/${ENCODED}/sources/tier-1.html`,
				`articles/${ENCODED}/sources/tier-1.metadata.json`,
			],
			[`content-versions/${ENCODED}/`]: [
				`content-versions/${ENCODED}/2026-07-10T09-41Z/content.html`,
			],
		};
		const { purgeArticleContent } = initPurgeArticleContent({
			listContentKeys: async (prefix) => {
				listedPrefixes.push(prefix);
				return keysByPrefix[prefix];
			},
			deleteContentObjects: async (keys) => {
				deleted.push(keys);
			},
		});

		await purgeArticleContent("https://example.com/post");

		expect(listedPrefixes.sort()).toEqual([
			`articles/${ENCODED}/sources/`,
			`content-versions/${ENCODED}/`,
			`content/${ENCODED}/images/`,
		]);
		expect(deleted).toEqual([
			[
				`content/${ENCODED}/content.html`,
				`content/${ENCODED}/images/a.png`,
				`articles/${ENCODED}/sources/tier-0.html`,
				`articles/${ENCODED}/sources/tier-0.metadata.json`,
				`articles/${ENCODED}/sources/tier-1.html`,
				`articles/${ENCODED}/sources/tier-1.metadata.json`,
				`content-versions/${ENCODED}/2026-07-10T09-41Z/content.html`,
			],
		]);
	});

	it("still deletes the canonical body key when every prefix is empty", async () => {
		const deleted: string[][] = [];
		const { purgeArticleContent } = initPurgeArticleContent({
			listContentKeys: async () => [],
			deleteContentObjects: async (keys) => {
				deleted.push(keys);
			},
		});

		await purgeArticleContent("https://example.com/post");

		expect(deleted).toEqual([[`content/${ENCODED}/content.html`]]);
	});
});
