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
		});
		expect(result).toEqual({ title: "A real post", siteName: "nodeweekly.com", excerpt: "A real excerpt." });
	});

	it("keeps everything verbatim for a same-host redirect", () => {
		const result = articleDisplayMetadata({
			url: SAVED,
			destinationUrl: destinationOf(SAVED, "https://nodeweekly.com/issues/635"),
			title: "A real post",
			siteName: "nodeweekly.com",
			excerpt: "A real excerpt.",
		});
		expect(result).toEqual({ title: "A real post", siteName: "nodeweekly.com", excerpt: "A real excerpt." });
	});

	it("rehosts the site name, the 'Article from' title and the 'Content saved from' excerpt to the destination", () => {
		const result = articleDisplayMetadata({
			url: SAVED,
			destinationUrl: destinationOf(SAVED, DESTINATION),
			title: articleFromHostTitle("nodeweekly.com"),
			siteName: "nodeweekly.com",
			excerpt: contentSavedFromHostExcerpt("nodeweekly.com"),
		});
		expect(result).toEqual({
			title: articleFromHostTitle("memcached.org"),
			siteName: "memcached.org",
			excerpt: contentSavedFromHostExcerpt("memcached.org"),
		});
	});

	it("rehosts a bare-host title and a 'Saved from' excerpt when the site name is also the bare saved host", () => {
		const result = articleDisplayMetadata({
			url: SAVED,
			destinationUrl: destinationOf(SAVED, DESTINATION),
			title: "nodeweekly.com",
			siteName: "nodeweekly.com",
			excerpt: savedFromHostExcerpt("nodeweekly.com"),
		});
		expect(result).toEqual({ title: "memcached.org", siteName: "memcached.org", excerpt: savedFromHostExcerpt("memcached.org") });
	});

	it("keeps a declared title, rehosts the site name, and rehosts an 'Image saved from' excerpt", () => {
		const result = articleDisplayMetadata({
			url: SAVED,
			destinationUrl: destinationOf(SAVED, DESTINATION),
			title: "Declared Title",
			siteName: "nodeweekly.com",
			excerpt: imageSavedFromHostExcerpt("nodeweekly.com"),
		});
		expect(result).toEqual({ title: "Declared Title", siteName: "memcached.org", excerpt: imageSavedFromHostExcerpt("memcached.org") });
	});

	it("keeps a declared site name and a bare-host title that does not match it, and keeps a real excerpt", () => {
		const result = articleDisplayMetadata({
			url: SAVED,
			destinationUrl: destinationOf(SAVED, DESTINATION),
			title: "nodeweekly.com",
			siteName: "Node Weekly",
			excerpt: "A real excerpt.",
		});
		expect(result).toEqual({ title: "nodeweekly.com", siteName: "Node Weekly", excerpt: "A real excerpt." });
	});

	it("is idempotent: a site name already naming the destination is kept", () => {
		const result = articleDisplayMetadata({
			url: SAVED,
			destinationUrl: destinationOf(SAVED, DESTINATION),
			title: "Declared Title",
			siteName: "memcached.org",
			excerpt: "A real excerpt.",
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
		});
		expect(result.siteName).toBe("www.example.com");
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
});
