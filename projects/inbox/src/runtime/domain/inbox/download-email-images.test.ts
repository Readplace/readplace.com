import { MAX_IMAGE_BYTES } from "@packages/crawl-article";
import type { CrawlFetch } from "@packages/crawl-article";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { initDownloadEmailImages } from "./download-email-images";

function bodyStream(body: Buffer): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new Uint8Array(body));
			controller.close();
		},
	});
}

function fakeImageFetch(options: {
	status?: number;
	contentType?: string | null;
	contentLength?: string;
	body?: Buffer;
}): { crawlFetch: CrawlFetch; requested: string[] } {
	const { status = 200, contentType = "image/png", contentLength, body = Buffer.from([1, 2, 3]) } = options;
	const requested: string[] = [];
	const crawlFetch: CrawlFetch = async (url) => {
		requested.push(url);
		return {
			ok: status >= 200 && status < 300,
			status,
			headers: {
				get: (name: string) => {
					if (name === "content-type") return contentType;
					if (name === "content-length") return contentLength ?? null;
					return null;
				},
			},
			body: bodyStream(body),
		} as Response;
	};
	return { crawlFetch, requested };
}

function initSubject(crawlFetch: CrawlFetch) {
	return initDownloadEmailImages({ crawlFetch, logger: HutchLogger.from(noopLogger) });
}

describe("initDownloadEmailImages", () => {
	it("downloads a remote image once with a URL-derived filename", async () => {
		const { crawlFetch } = fakeImageFetch({});
		const download = initSubject(crawlFetch);

		const images = await download({
			html: '<img src="https://newsletter.test/hero.png" width="640" alt="">',
		});

		expect(images).toHaveLength(1);
		expect(images[0].originalUrl).toBe("https://newsletter.test/hero.png");
		expect(images[0].filename).toMatch(/^[0-9a-f]{16}\.png$/);
		expect(images[0].contentType).toBe("image/png");
		expect(images[0].body).toEqual(Buffer.from([1, 2, 3]));
	});

	it("deduplicates repeated srcs into a single download", async () => {
		const { crawlFetch, requested } = fakeImageFetch({});
		const download = initSubject(crawlFetch);

		const images = await download({
			html:
				'<img src="https://newsletter.test/logo.png" width="100"><img src="https://newsletter.test/logo.png" width="100">',
		});

		expect(requested).toEqual(["https://newsletter.test/logo.png"]);
		expect(images).toHaveLength(1);
	});

	it("caps downloads at 20 images", async () => {
		const { crawlFetch, requested } = fakeImageFetch({});
		const download = initSubject(crawlFetch);
		const imgs = Array.from(
			{ length: 25 },
			(_, i) => `<img src="https://newsletter.test/${i}.png" width="100">`,
		).join("");

		const images = await download({ html: imgs });

		expect(requested).toHaveLength(20);
		expect(images).toHaveLength(20);
	});

	it("never fetches an image declaring tracking-pixel dimensions (both ≤ 3)", async () => {
		const { crawlFetch, requested } = fakeImageFetch({});
		const download = initSubject(crawlFetch);

		const images = await download({
			html:
				'<img src="https://tracker.test/open.gif" width="3" height="1" alt="n">' +
				'<img src="https://newsletter.test/thin.png" width="1" height="600">' +
				'<img src="https://newsletter.test/tall.png" width="1">' +
				'<img src="https://newsletter.test/nodim.png">' +
				'<img src="https://newsletter.test/hero.png" width="640">',
		});

		// Only the attribute-declared beacon is skipped: a divider with ONE tiny
		// dimension, a tiny-width image with no declared height, and an image with
		// no dimension attributes at all are content until proven otherwise.
		expect(requested).toEqual([
			"https://newsletter.test/thin.png",
			"https://newsletter.test/tall.png",
			"https://newsletter.test/nodim.png",
			"https://newsletter.test/hero.png",
		]);
		expect(images.map((image) => image.originalUrl)).not.toContain("https://tracker.test/open.gif");
	});

	it("ignores data:, parser-local cid, relative, and protocol-relative srcs", async () => {
		const { crawlFetch, requested } = fakeImageFetch({});
		const download = initSubject(crawlFetch);

		const images = await download({
			html:
				'<img src="data:image/png;base64,AQID">' +
				'<img src="email://cid/logo@x">' +
				'<img src="/relative.png">' +
				'<img src="//host.test/protocol-relative.png">' +
				"<img>",
		});

		expect(requested).toHaveLength(0);
		expect(images).toEqual([]);
	});

	it("skips an image answering a non-OK status", async () => {
		const { crawlFetch } = fakeImageFetch({ status: 404 });
		const download = initSubject(crawlFetch);

		const images = await download({
			html: '<img src="https://newsletter.test/gone.png" width="640">',
		});

		expect(images).toEqual([]);
	});

	it("skips a response that is not an image", async () => {
		const { crawlFetch } = fakeImageFetch({ contentType: "text/html" });
		const download = initSubject(crawlFetch);

		const images = await download({
			html: '<img src="https://newsletter.test/page.png" width="640">',
		});

		expect(images).toEqual([]);
	});

	it("accepts application/octet-stream and a missing content-type header via the URL extension", async () => {
		const { crawlFetch } = fakeImageFetch({ contentType: null });
		const download = initSubject(crawlFetch);

		const images = await download({
			html: '<img src="https://newsletter.test/photo.jpg" width="640">',
		});

		expect(images[0].filename).toMatch(/\.jpg$/);
		expect(images[0].contentType).toBe("application/octet-stream");
	});

	it("downloads an image whose content-length header is within the size cap", async () => {
		const { crawlFetch } = fakeImageFetch({ contentLength: "3" });
		const download = initSubject(crawlFetch);

		const images = await download({
			html: '<img src="https://newsletter.test/small.png" width="640">',
		});

		expect(images).toHaveLength(1);
	});

	it("skips an image whose content-length header exceeds the size cap", async () => {
		const { crawlFetch } = fakeImageFetch({
			contentLength: String(MAX_IMAGE_BYTES.bytes + 1),
		});
		const download = initSubject(crawlFetch);

		const images = await download({
			html: '<img src="https://newsletter.test/huge.png" width="640">',
		});

		expect(images).toEqual([]);
	});

	it("skips an image whose streamed body exceeds the size cap (no content-length header)", async () => {
		// A chunked origin advertises no length: the incremental cap must cut the
		// stream off rather than buffering it in full before checking.
		const { crawlFetch } = fakeImageFetch({
			body: Buffer.alloc(MAX_IMAGE_BYTES.bytes + 1),
		});
		const download = initSubject(crawlFetch);

		const images = await download({
			html: '<img src="https://newsletter.test/huge.png" width="640">',
		});

		expect(images).toEqual([]);
	});

	it("logs and skips a URL whose body stream fails mid-read, keeping the rest", async () => {
		const ok = fakeImageFetch({});
		const crawlFetch: CrawlFetch = async (url, init) => {
			if (!url.includes("reset.test")) return ok.crawlFetch(url, init);
			return {
				ok: true,
				status: 200,
				headers: { get: (name: string) => (name === "content-type" ? "image/png" : null) },
				body: new ReadableStream<Uint8Array>({
					start(controller) {
						controller.error(new Error("connection reset"));
					},
				}),
			} as Response;
		};
		const download = initSubject(crawlFetch);

		const images = await download({
			html:
				'<img src="https://reset.test/x.png" width="640"><img src="https://newsletter.test/ok.png" width="640">',
		});

		// A genuine network error is NOT the size cap: it falls through to the
		// per-URL catch rather than being silently classified as oversize.
		expect(images.map((image) => image.originalUrl)).toEqual(["https://newsletter.test/ok.png"]);
	});

	it("logs and skips a URL whose fetch throws, keeping the rest", async () => {
		const ok = fakeImageFetch({});
		const crawlFetch: CrawlFetch = async (url, init) => {
			if (url.includes("dead.test")) throw new Error("connect timeout");
			return ok.crawlFetch(url, init);
		};
		const download = initSubject(crawlFetch);

		const images = await download({
			html:
				'<img src="https://dead.test/x.png" width="640"><img src="https://newsletter.test/ok.png" width="640">',
		});

		expect(images.map((image) => image.originalUrl)).toEqual(["https://newsletter.test/ok.png"]);
	});

	it("returns an empty list for HTML without remote images", async () => {
		const { crawlFetch, requested } = fakeImageFetch({});
		const download = initSubject(crawlFetch);

		const images = await download({ html: "<p>text only</p>" });

		expect(requested).toHaveLength(0);
		expect(images).toEqual([]);
	});
});
