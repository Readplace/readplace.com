import {
	articleDestinationHost,
	articleDestinationUrl,
	articleDisplayMetadata,
	articleFromHostTitle,
	articleLinkedDisplay,
	contentSavedFromHostExcerpt,
	hostStubMetadata,
	imageSavedFromHostExcerpt,
	isSameArticle,
	savedFromHostExcerpt,
	type ArticleDestinationUrl,
} from "./article-site";
import { stubMetadataFor } from "./stub-metadata";

const SAVED = "https://nodeweekly.com/link/190528/4be0b3f821";
const DESTINATION = "https://memcached.org/";

function destinationOf(url: string, displayUrl: string | undefined): ArticleDestinationUrl {
	return articleDestinationUrl({ url, displayUrl });
}

describe("articleDestinationUrl", () => {
	it("is the adopted destination when the save redirected", () => {
		expect(destinationOf(SAVED, DESTINATION)).toBe(DESTINATION);
	});

	it("is the saved URL when nothing redirected", () => {
		expect(destinationOf(SAVED, undefined)).toBe(SAVED);
	});
});

describe("articleDestinationHost", () => {
	it("is the host of the destination URL", () => {
		expect(articleDestinationHost(destinationOf(SAVED, DESTINATION))).toBe("memcached.org");
	});
});

describe("articleDisplayMetadata", () => {
	it("returns everything verbatim for a non-adopted article, without rehosting a host-shaped site name", () => {
		const result = articleDisplayMetadata({
			url: SAVED,
			destinationUrl: destinationOf(SAVED, undefined),
			title: "A real post",
			siteName: "nodeweekly.com",
			excerpt: "A real excerpt.",
			wordCount: 120,
			imageUrl: undefined,
		});
		expect(result).toStrictEqual({ title: "A real post", siteName: "nodeweekly.com", excerpt: "A real excerpt.", wordCount: 120 });
	});

	it("keeps everything verbatim for a same-host redirect", () => {
		const result = articleDisplayMetadata({
			url: SAVED,
			destinationUrl: destinationOf(SAVED, "https://nodeweekly.com/issues/635"),
			title: "A real post",
			siteName: "nodeweekly.com",
			excerpt: "A real excerpt.",
			wordCount: 120,
			imageUrl: undefined,
		});
		expect(result).toEqual({ title: "A real post", siteName: "nodeweekly.com", excerpt: "A real excerpt.", wordCount: 120 });
	});

	it("rehosts the site name, the 'Article from' title and the 'Content saved from' excerpt to the destination", () => {
		const result = articleDisplayMetadata({
			url: SAVED,
			destinationUrl: destinationOf(SAVED, DESTINATION),
			title: articleFromHostTitle("nodeweekly.com"),
			siteName: "nodeweekly.com",
			excerpt: contentSavedFromHostExcerpt("nodeweekly.com"),
			wordCount: 120,
			imageUrl: undefined,
		});
		expect(result).toEqual({
			title: articleFromHostTitle("memcached.org"),
			siteName: "memcached.org",
			excerpt: contentSavedFromHostExcerpt("memcached.org"),
			wordCount: 120,
			imageUrl: undefined,
		});
	});

	it("rehosts a bare-host title and a 'Saved from' excerpt when the site name is also the bare saved host", () => {
		const result = articleDisplayMetadata({
			url: SAVED,
			destinationUrl: destinationOf(SAVED, DESTINATION),
			title: "nodeweekly.com",
			siteName: "nodeweekly.com",
			excerpt: savedFromHostExcerpt("nodeweekly.com"),
			wordCount: 120,
			imageUrl: undefined,
		});
		expect(result).toEqual({ title: "memcached.org", siteName: "memcached.org", excerpt: savedFromHostExcerpt("memcached.org"), wordCount: 120 });
	});

	it("keeps a declared title, rehosts the site name, and rehosts an 'Image saved from' excerpt", () => {
		const result = articleDisplayMetadata({
			url: SAVED,
			destinationUrl: destinationOf(SAVED, DESTINATION),
			title: "Declared Title",
			siteName: "nodeweekly.com",
			excerpt: imageSavedFromHostExcerpt("nodeweekly.com"),
			wordCount: 120,
			imageUrl: undefined,
		});
		expect(result).toEqual({ title: "Declared Title", siteName: "memcached.org", excerpt: imageSavedFromHostExcerpt("memcached.org"), wordCount: 120 });
	});

	it("keeps a declared site name and a bare-host title that does not match it, and keeps a real excerpt", () => {
		const result = articleDisplayMetadata({
			url: SAVED,
			destinationUrl: destinationOf(SAVED, DESTINATION),
			title: "nodeweekly.com",
			siteName: "Node Weekly",
			excerpt: "A real excerpt.",
			wordCount: 120,
			imageUrl: undefined,
		});
		expect(result).toEqual({ title: "nodeweekly.com", siteName: "Node Weekly", excerpt: "A real excerpt.", wordCount: 120 });
	});

	it("is idempotent: a site name already naming the destination is kept", () => {
		const result = articleDisplayMetadata({
			url: SAVED,
			destinationUrl: destinationOf(SAVED, DESTINATION),
			title: "Declared Title",
			siteName: "memcached.org",
			excerpt: "A real excerpt.",
			wordCount: 120,
			imageUrl: undefined,
		});
		expect(result.siteName).toBe("memcached.org");
	});

	it("shows the destination host when the destination declares the origin's hostname as its name (apex→www)", () => {
		const result = articleDisplayMetadata({
			url: "https://example.com/post",
			destinationUrl: destinationOf("https://example.com/post", "https://www.example.com/post"),
			title: "A Post",
			siteName: "example.com",
			excerpt: "x",
			wordCount: 120,
			imageUrl: undefined,
		});
		expect(result.siteName).toBe("www.example.com");
	});

	it("passes the word count and the image through", () => {
		const result = articleDisplayMetadata({
			url: SAVED,
			destinationUrl: destinationOf(SAVED, undefined),
			title: "A real post",
			siteName: "nodeweekly.com",
			excerpt: "A real excerpt.",
			wordCount: 120,
			imageUrl: "https://nodeweekly.com/cover.png",
		});
		expect(result).toEqual({
			title: "A real post",
			siteName: "nodeweekly.com",
			excerpt: "A real excerpt.",
			wordCount: 120,
			imageUrl: "https://nodeweekly.com/cover.png",
		});
	});

	it("shows only the host of a webmail page, with no word count and no image", () => {
		const url = "https://mail.google.com/mail/u/2/";
		const result = articleDisplayMetadata({
			url,
			destinationUrl: destinationOf(url, "https://mail.google.com/mail/u/2/#inbox"),
			title: "Inbox (12) - private.person@example.com",
			siteName: "Gmail",
			excerpt: "A private message",
			wordCount: 9,
			imageUrl: "https://cdn.readplace.test/media/private-avatar.png",
		});
		expect(result).toStrictEqual({ title: "mail.google.com", siteName: "mail.google.com", excerpt: "", wordCount: 0 });
	});
});

describe("articleLinkedDisplay", () => {
	it("resolves the title and site name and drops the excerpt", () => {
		const result = articleLinkedDisplay({
			url: SAVED,
			destinationUrl: destinationOf(SAVED, DESTINATION),
			title: articleFromHostTitle("nodeweekly.com"),
			siteName: "nodeweekly.com",
		});
		expect(result).toEqual({ title: articleFromHostTitle("memcached.org"), siteName: "memcached.org" });
	});

	it("names a webmail page after its host", () => {
		const url = "https://mail.google.com/mail/u/2/";
		const result = articleLinkedDisplay({
			url,
			destinationUrl: destinationOf(url, undefined),
			title: "Inbox (12) - private.person@example.com",
			siteName: "Gmail",
		});
		expect(result).toEqual({ title: "mail.google.com", siteName: "mail.google.com" });
	});
});

describe("hostStubMetadata", () => {
	it("names a never-crawled row after its destination host", () => {
		expect(hostStubMetadata(destinationOf(SAVED, DESTINATION))).toEqual({
			title: "memcached.org",
			siteName: "memcached.org",
			excerpt: "",
		});
	});
});

describe("host templates", () => {
	it("produce the strings the stub factory writes, so the rehost rule keeps recognising them", () => {
		expect(stubMetadataFor("memcached.org")).toEqual({
			title: articleFromHostTitle("memcached.org"),
			siteName: "memcached.org",
			excerpt: savedFromHostExcerpt("memcached.org"),
		});
	});
});

describe("isSameArticle", () => {
	it("matches two saves whose titles differ only in case and whitespace", () => {
		expect(
			isSameArticle({
				article: {
					url: "javascriptweekly.com/link/1001/web",
					originalUrl: "https://javascriptweekly.com/link/1001/web",
					title: "Shipping  Faster Builds\n",
				},
				other: {
					url: "nodeweekly.com/link/2002/web",
					originalUrl: "https://nodeweekly.com/link/2002/web",
					title: " shipping faster BUILDS",
				},
			}),
		).toBe(true);
	});

	it("never matches on an empty title", () => {
		expect(
			isSameArticle({
				article: { url: "example.com/first-note", originalUrl: "https://example.com/first-note", title: "  " },
				other: { url: "example.com/second-note", originalUrl: "https://example.com/second-note", title: "" },
			}),
		).toBe(false);
	});

	it("never matches an untitled article on its missing title", () => {
		expect(
			isSameArticle({
				article: { url: "example.com/first-note" },
				other: { url: "example.com/second-note" },
			}),
		).toBe(false);
	});

	it("matches two saves whose destinations differ only in scheme, www., fragment and trailing slash", () => {
		expect(
			isSameArticle({
				article: {
					url: "nodeweekly.com/link/2002/web",
					originalUrl: "https://nodeweekly.com/link/2002/web",
					displayUrl: "https://www.example.com/posts/faster-builds/#comments",
					title: "Faster builds, explained",
				},
				other: {
					url: "example.com/posts/faster-builds",
					originalUrl: "http://example.com/posts/faster-builds",
					title: "Build speed notes",
				},
			}),
		).toBe(true);
	});

	it("compares an article without an original url through its table key", () => {
		expect(
			isSameArticle({
				article: { url: "example.com/posts/faster-builds", title: "Build speed notes" },
				other: {
					url: "nodeweekly.com/link/2002/web",
					originalUrl: "https://nodeweekly.com/link/2002/web",
					displayUrl: "https://example.com/posts/faster-builds",
					title: "Faster builds, explained",
				},
			}),
		).toBe(true);
	});

	it("tells apart different pages with different titles", () => {
		expect(
			isSameArticle({
				article: {
					url: "example.com/posts/faster-builds",
					originalUrl: "https://example.com/posts/faster-builds",
					title: "Faster builds, explained",
				},
				other: {
					url: "example.com/posts/slower-tests",
					originalUrl: "https://example.com/posts/slower-tests",
					title: "Why the tests got slower",
				},
			}),
		).toBe(false);
	});

	it("tells apart two official Unicode charts that share an extracted title, in both directions", () => {
		const greekChart = {
			url: "unicode.org/charts/PDF/U0370.pdf",
			originalUrl: "https://unicode.org/charts/PDF/U0370.pdf",
			displayUrl: "https://www.unicode.org/Public/18.0.0/charts/PDF/U0370.pdf",
			title: "The Unicode Standard, Version 18.0",
		};
		const cyrillicChart = {
			url: "unicode.org/charts/PDF/U0400.pdf",
			originalUrl: "https://unicode.org/charts/PDF/U0400.pdf",
			displayUrl: "https://www.unicode.org/Public/18.0.0/charts/PDF/U0400.pdf",
			title: "The Unicode Standard, Version 18.0",
		};
		expect([
			isSameArticle({ article: greekChart, other: cyrillicChart }),
			isSameArticle({ article: cyrillicChart, other: greekChart }),
		]).toEqual([false, false]);
	});

	it("tells apart two Unicode charts compared through their original url and their table key", () => {
		expect(
			isSameArticle({
				article: {
					url: "unicode.org/charts/PDF/U0370.pdf",
					originalUrl: "https://www.unicode.org/charts/PDF/U0370.pdf",
					title: "The Unicode Standard, Version 18.0",
				},
				other: { url: "unicode.org/charts/PDF/U0400.pdf", title: "The Unicode Standard, Version 18.0" },
			}),
		).toBe(false);
	});

	it("matches the versioned and unversioned links to one Unicode chart by title, in both directions", () => {
		const versionedChart = {
			url: "unicode.org/charts/PDF/U0370.pdf",
			originalUrl: "https://unicode.org/charts/PDF/U0370.pdf",
			displayUrl: "https://www.unicode.org/Public/18.0.0/charts/PDF/U0370.pdf",
			title: "The Unicode Standard, Version 18.0",
		};
		const unversionedChart = {
			url: "unicode.org/charts/PDF/U0370.pdf",
			originalUrl: "https://unicode.org/charts/PDF/U0370.pdf",
			title: "The Unicode Standard, Version 18.0",
		};
		expect([
			isSameArticle({ article: versionedChart, other: unversionedChart }),
			isSameArticle({ article: unversionedChart, other: versionedChart }),
		]).toEqual([true, true]);
	});

	it("matches a Unicode chart and a same-titled copy on another host, in both directions", () => {
		const chart = {
			url: "unicode.org/charts/PDF/U0370.pdf",
			originalUrl: "https://unicode.org/charts/PDF/U0370.pdf",
			title: "Greek and Coptic",
		};
		const copy = {
			url: "example.com/mirror/greek-and-coptic.pdf",
			originalUrl: "https://example.com/mirror/greek-and-coptic.pdf",
			title: "Greek and Coptic",
		};
		expect([isSameArticle({ article: chart, other: copy }), isSameArticle({ article: copy, other: chart })]).toEqual([
			true,
			true,
		]);
	});

	it("tells apart a Hacker News discussion and the paper it shares a title with, in both directions", () => {
		const discussion = {
			url: "news.ycombinator.com/item?id=90000001",
			originalUrl: "https://news.ycombinator.com/item?id=90000001",
			title: "Faster builds through incremental caching",
		};
		const paper = {
			url: "nodeweekly.com/link/3003/web",
			originalUrl: "https://nodeweekly.com/link/3003/web",
			displayUrl: "https://example.org/abs/2601.00001",
			title: "Faster builds through incremental caching",
		};
		expect([
			isSameArticle({ article: discussion, other: paper }),
			isSameArticle({ article: paper, other: discussion }),
		]).toEqual([false, false]);
	});

	it("tells apart a same-titled paper and a Hacker News discussion reached through a redirect or a bare table key", () => {
		const paper = {
			url: "example.org/abs/2601.00001",
			originalUrl: "https://example.org/abs/2601.00001",
			title: "Faster builds through incremental caching",
		};
		expect([
			isSameArticle({
				article: {
					url: "nodeweekly.com/link/4004/web",
					originalUrl: "https://nodeweekly.com/link/4004/web",
					displayUrl: "https://news.ycombinator.com/item?id=90000001",
					title: "Faster builds through incremental caching",
				},
				other: paper,
			}),
			isSameArticle({
				article: paper,
				other: { url: "news.ycombinator.com/item?id=90000001", title: "Faster builds through incremental caching" },
			}),
		]).toEqual([false, false]);
	});

	it("matches two saves of one Hacker News discussion whatever their titles, in both directions", () => {
		const discussion = {
			url: "news.ycombinator.com/item?id=90000001",
			originalUrl: "https://news.ycombinator.com/item?id=90000001",
			title: "Faster builds through incremental caching",
		};
		const sameDiscussion = {
			url: "nodeweekly.com/link/4004/web",
			originalUrl: "https://nodeweekly.com/link/4004/web",
			displayUrl: "http://www.news.ycombinator.com/item?id=90000001#comments",
			title: "Faster builds through incremental caching | Hacker News",
		};
		expect([
			isSameArticle({ article: discussion, other: sameDiscussion }),
			isSameArticle({ article: sameDiscussion, other: discussion }),
		]).toEqual([true, true]);
	});

	it("tells apart a Pragmatic Engineer post and its comments thread that share a title, in both directions", () => {
		const post = {
			url: "newsletter.pragmaticengineer.com/p/faster-builds-explained?utm_source=example",
			originalUrl: "https://newsletter.pragmaticengineer.com/p/faster-builds-explained?utm_source=example",
			title: "Faster builds, explained",
		};
		const comments = {
			url: "newsletter.pragmaticengineer.com/p/faster-builds-explained/comments",
			originalUrl: "https://newsletter.pragmaticengineer.com/p/faster-builds-explained/comments",
			title: "Faster builds, explained",
		};
		const commentsWithQuery = {
			url: "nodeweekly.com/link/5005/web",
			originalUrl: "https://nodeweekly.com/link/5005/web",
			displayUrl: "https://newsletter.pragmaticengineer.com/p/faster-builds-explained/comments?utm_source=example",
			title: "Faster builds, explained",
		};
		expect([
			isSameArticle({ article: post, other: comments }),
			isSameArticle({ article: comments, other: post }),
			isSameArticle({ article: post, other: commentsWithQuery }),
			isSameArticle({ article: commentsWithQuery, other: post }),
		]).toEqual([false, false, false, false]);
	});

	it("matches two saves of one Pragmatic Engineer comments thread, with the same title or different ones", () => {
		const comments = {
			url: "newsletter.pragmaticengineer.com/p/faster-builds-explained/comments",
			originalUrl: "https://newsletter.pragmaticengineer.com/p/faster-builds-explained/comments",
			title: "Faster builds, explained",
		};
		const sameComments = {
			url: "nodeweekly.com/link/5005/web",
			originalUrl: "https://nodeweekly.com/link/5005/web",
			displayUrl: "http://www.newsletter.pragmaticengineer.com/p/faster-builds-explained/comments/#latest",
			title: "Faster builds, explained",
		};
		const retitledComments = { ...sameComments, title: "Comments - Faster builds, explained" };
		expect([
			isSameArticle({ article: comments, other: sameComments }),
			isSameArticle({ article: sameComments, other: comments }),
			isSameArticle({ article: comments, other: retitledComments }),
			isSameArticle({ article: retitledComments, other: comments }),
		]).toEqual([true, true, true, true]);
	});

	it("still matches tracking variants of one Pragmatic Engineer post by title, in both directions", () => {
		const post = {
			url: "newsletter.pragmaticengineer.com/p/faster-builds-explained",
			originalUrl: "https://newsletter.pragmaticengineer.com/p/faster-builds-explained",
			title: "Faster builds, explained",
		};
		const trackedPost = {
			url: "newsletter.pragmaticengineer.com/p/faster-builds-explained?utm_source=example",
			originalUrl: "https://newsletter.pragmaticengineer.com/p/faster-builds-explained?utm_source=example",
			title: "Faster builds, explained",
		};
		expect([
			isSameArticle({ article: post, other: trackedPost }),
			isSameArticle({ article: trackedPost, other: post }),
		]).toEqual([true, true]);
	});

	it("still matches a same-titled copy on another host, in both directions", () => {
		const post = {
			url: "example.com/posts/faster-builds",
			originalUrl: "https://example.com/posts/faster-builds",
			title: "Faster builds, explained",
		};
		const mirror = {
			url: "example.org/mirror/faster-builds",
			originalUrl: "https://example.org/mirror/faster-builds",
			title: "Faster builds, explained",
		};
		expect([isSameArticle({ article: post, other: mirror }), isSameArticle({ article: mirror, other: post })]).toEqual([
			true,
			true,
		]);
	});
});
