import { articleDestinationUrl, calculateReadTime, hostStubMetadata, ReaderArticleHashId } from "@packages/domain/article";
import type { GlobalArticleData } from "@packages/provider-contracts/article-store";
import { ANONYMOUS_VIEWER, type Viewer, viewerFor } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
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
	const viewers: Array<Viewer | undefined> = [];
	const resolveStoredArticle = initResolveStoredArticle({
		resolveCanonicalIdentity: async (url) => params.aliases?.[url] ?? url,
		findArticleByUrl: async (url, viewer) => {
			lookedUp.push(url);
			viewers.push(viewer);
			return params.rows.find((row) => row.url === url) ?? null;
		},
	});
	return { resolveStoredArticle, lookedUp, viewers };
}

describe("initResolveStoredArticle", () => {
	const twitterUrl = "https://twitter.com/jack/status/20";
	const xUrl = "https://x.com/jack/status/20";

	it("reads each lookup for the viewer it is given, so an owner gets their own private row", async () => {
		const owner = viewerFor(UserIdSchema.parse("owner-1"));
		const { resolveStoredArticle, viewers } = resolverOver({ rows: [] });

		await resolveStoredArticle(twitterUrl, owner);

		expect(viewers).toEqual([owner, owner]);
	});

	it("serves a legacy twitter.com record under its own URL", async () => {
		const legacy = storedAt(twitterUrl);
		const { resolveStoredArticle, lookedUp } = resolverOver({ rows: [legacy, storedAt(xUrl)] });

		expect(await resolveStoredArticle(twitterUrl, ANONYMOUS_VIEWER)).toEqual({ articleUrl: twitterUrl, existing: legacy });
		expect(lookedUp).toEqual([twitterUrl]);
	});

	it("keeps a tombstoned twitter.com record rather than falling through to x.com", async () => {
		const tombstone = storedAt(twitterUrl, { purgedAt: new Date("2026-09-01T00:00:00Z") });
		const { resolveStoredArticle } = resolverOver({ rows: [tombstone, storedAt(xUrl)] });

		expect(await resolveStoredArticle(twitterUrl, ANONYMOUS_VIEWER)).toEqual({ articleUrl: twitterUrl, existing: tombstone });
	});

	it("follows the twitter.com URL's alias before looking anywhere else", async () => {
		const aliased = storedAt("https://example.com/original");
		const { resolveStoredArticle } = resolverOver({
			rows: [aliased, storedAt(xUrl)],
			aliases: { [twitterUrl]: "https://example.com/original" },
		});

		expect(await resolveStoredArticle(twitterUrl, ANONYMOUS_VIEWER)).toEqual({ articleUrl: "https://example.com/original", existing: aliased });
	});

	it("keeps a twitter.com alias whose target row is missing rather than falling through to x.com", async () => {
		const { resolveStoredArticle } = resolverOver({
			rows: [storedAt(xUrl)],
			aliases: { [twitterUrl]: "https://example.com/original" },
		});

		expect(await resolveStoredArticle(twitterUrl, ANONYMOUS_VIEWER)).toEqual({ articleUrl: "https://example.com/original", existing: null });
	});

	it("finds the x.com record for a twitter.com URL nobody saved", async () => {
		const canonical = storedAt(xUrl);
		const { resolveStoredArticle, lookedUp } = resolverOver({ rows: [canonical] });

		expect(await resolveStoredArticle(twitterUrl, ANONYMOUS_VIEWER)).toEqual({ articleUrl: xUrl, existing: canonical });
		expect(lookedUp).toEqual([twitterUrl, xUrl]);
	});

	it("follows the x.com URL's alias when falling through", async () => {
		const aliased = storedAt("https://example.com/original");
		const { resolveStoredArticle } = resolverOver({
			rows: [aliased],
			aliases: { [xUrl]: "https://example.com/original" },
		});

		expect(await resolveStoredArticle(twitterUrl, ANONYMOUS_VIEWER)).toEqual({ articleUrl: "https://example.com/original", existing: aliased });
	});

	it("names the x.com URL for a first visit to a tweet stored under neither host", async () => {
		const { resolveStoredArticle } = resolverOver({ rows: [] });

		expect(await resolveStoredArticle(twitterUrl, ANONYMOUS_VIEWER)).toEqual({ articleUrl: xUrl, existing: null });
	});

	it("looks up any other URL once", async () => {
		const { resolveStoredArticle, lookedUp } = resolverOver({ rows: [] });

		expect(await resolveStoredArticle("https://example.com/a", ANONYMOUS_VIEWER)).toEqual({ articleUrl: "https://example.com/a", existing: null });
		expect(lookedUp).toEqual(["https://example.com/a"]);
	});

	it("does not fall back from an x.com URL to twitter.com", async () => {
		const { resolveStoredArticle, lookedUp } = resolverOver({ rows: [storedAt(twitterUrl)] });

		expect(await resolveStoredArticle(xUrl, ANONYMOUS_VIEWER)).toEqual({ articleUrl: xUrl, existing: null });
		expect(lookedUp).toEqual([xUrl]);
	});
});

describe("initResolveStoredArticle for an Amazon product", () => {
	const titleUrl = "https://www.amazon.com.au/Fundamentals-Software-Architecture-Neal-Ford/dp/1492043451";
	const bareUrl = "https://www.amazon.com.au/dp/1492043451";

	it("finds the bare record for a title link nobody saved", async () => {
		const canonical = storedAt(bareUrl);
		const { resolveStoredArticle, lookedUp } = resolverOver({ rows: [canonical] });

		expect(await resolveStoredArticle(titleUrl, ANONYMOUS_VIEWER)).toEqual({ articleUrl: bareUrl, existing: canonical });
		expect(lookedUp).toEqual([titleUrl, bareUrl]);
	});

	it("names the bare link for a first visit to a product stored under neither link", async () => {
		const { resolveStoredArticle } = resolverOver({ rows: [] });

		expect(await resolveStoredArticle(titleUrl, ANONYMOUS_VIEWER)).toEqual({ articleUrl: bareUrl, existing: null });
	});

	it("serves a legacy title-link record under its own URL", async () => {
		const legacy = storedAt(titleUrl);
		const { resolveStoredArticle, lookedUp } = resolverOver({ rows: [legacy, storedAt(bareUrl)] });

		expect(await resolveStoredArticle(titleUrl, ANONYMOUS_VIEWER)).toEqual({ articleUrl: titleUrl, existing: legacy });
		expect(lookedUp).toEqual([titleUrl]);
	});

	it("does not fall back from a bare link to a title link", async () => {
		const { resolveStoredArticle, lookedUp } = resolverOver({ rows: [storedAt(titleUrl)] });

		expect(await resolveStoredArticle(bareUrl, ANONYMOUS_VIEWER)).toEqual({ articleUrl: bareUrl, existing: null });
		expect(lookedUp).toEqual([bareUrl]);
	});
});
