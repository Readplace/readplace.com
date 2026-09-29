import { articleDestinationUrl, calculateReadTime, hostStubMetadata, ReaderArticleHashId } from "@packages/domain/article";
import type { GlobalArticleData } from "@packages/provider-contracts/article-store";
import { initResolveStoredArticle } from "./resolve-stored-article";

function storedAt(url: string, extra: Partial<GlobalArticleData> = {}): GlobalArticleData {
	const destinationUrl = articleDestinationUrl({ url, displayUrl: undefined });
	return {
		id: ReaderArticleHashId.from(url),
		url,
		destinationUrl,
		metadata: { ...hostStubMetadata(destinationUrl), wordCount: 0 },
		estimatedReadTime: calculateReadTime(0),
		savedAt: new Date("2026-08-01T00:00:00Z"),
		...extra,
	};
}

function resolverOver(params: { rows: GlobalArticleData[]; aliases?: Record<string, string> }) {
	const lookedUp: string[] = [];
	const resolveStoredArticle = initResolveStoredArticle({
		resolveCanonicalIdentity: async (url) => params.aliases?.[url] ?? url,
		findArticleByUrl: async (url) => {
			lookedUp.push(url);
			return params.rows.find((row) => row.url === url) ?? null;
		},
	});
	return { resolveStoredArticle, lookedUp };
}

describe("initResolveStoredArticle", () => {
	const twitterUrl = "https://twitter.com/jack/status/20";
	const xUrl = "https://x.com/jack/status/20";

	it("serves a legacy twitter.com record under its own URL", async () => {
		const legacy = storedAt(twitterUrl);
		const { resolveStoredArticle, lookedUp } = resolverOver({ rows: [legacy, storedAt(xUrl)] });

		expect(await resolveStoredArticle(twitterUrl)).toEqual({ articleUrl: twitterUrl, existing: legacy });
		expect(lookedUp).toEqual([twitterUrl]);
	});

	it("keeps a tombstoned twitter.com record rather than falling through to x.com", async () => {
		const tombstone = storedAt(twitterUrl, { purgedAt: new Date("2026-09-01T00:00:00Z") });
		const { resolveStoredArticle } = resolverOver({ rows: [tombstone, storedAt(xUrl)] });

		expect(await resolveStoredArticle(twitterUrl)).toEqual({ articleUrl: twitterUrl, existing: tombstone });
	});

	it("follows the twitter.com URL's alias before looking anywhere else", async () => {
		const aliased = storedAt("https://example.com/original");
		const { resolveStoredArticle } = resolverOver({
			rows: [aliased, storedAt(xUrl)],
			aliases: { [twitterUrl]: "https://example.com/original" },
		});

		expect(await resolveStoredArticle(twitterUrl)).toEqual({ articleUrl: "https://example.com/original", existing: aliased });
	});

	it("keeps a twitter.com alias whose target row is missing rather than falling through to x.com", async () => {
		const { resolveStoredArticle } = resolverOver({
			rows: [storedAt(xUrl)],
			aliases: { [twitterUrl]: "https://example.com/original" },
		});

		expect(await resolveStoredArticle(twitterUrl)).toEqual({ articleUrl: "https://example.com/original", existing: null });
	});

	it("finds the x.com record for a twitter.com URL nobody saved", async () => {
		const canonical = storedAt(xUrl);
		const { resolveStoredArticle, lookedUp } = resolverOver({ rows: [canonical] });

		expect(await resolveStoredArticle(twitterUrl)).toEqual({ articleUrl: xUrl, existing: canonical });
		expect(lookedUp).toEqual([twitterUrl, xUrl]);
	});

	it("follows the x.com URL's alias when falling through", async () => {
		const aliased = storedAt("https://example.com/original");
		const { resolveStoredArticle } = resolverOver({
			rows: [aliased],
			aliases: { [xUrl]: "https://example.com/original" },
		});

		expect(await resolveStoredArticle(twitterUrl)).toEqual({ articleUrl: "https://example.com/original", existing: aliased });
	});

	it("names the x.com URL for a first visit to a tweet stored under neither host", async () => {
		const { resolveStoredArticle } = resolverOver({ rows: [] });

		expect(await resolveStoredArticle(twitterUrl)).toEqual({ articleUrl: xUrl, existing: null });
	});

	it("looks up any other URL once", async () => {
		const { resolveStoredArticle, lookedUp } = resolverOver({ rows: [] });

		expect(await resolveStoredArticle("https://example.com/a")).toEqual({ articleUrl: "https://example.com/a", existing: null });
		expect(lookedUp).toEqual(["https://example.com/a"]);
	});

	it("does not fall back from an x.com URL to twitter.com", async () => {
		const { resolveStoredArticle, lookedUp } = resolverOver({ rows: [storedAt(twitterUrl)] });

		expect(await resolveStoredArticle(xUrl)).toEqual({ articleUrl: xUrl, existing: null });
		expect(lookedUp).toEqual([xUrl]);
	});
});
