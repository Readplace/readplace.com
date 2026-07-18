import { emailImageS3KeyPrefix } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import type { DownloadedEmailImage } from "./download-email-images";
import { initStoreEmailBody } from "./store-email-body";

const USER = UserIdSchema.parse("00000000000000000000000000000001");
const CDN = "https://cdn.test.readplace.com";

function heroImage(): DownloadedEmailImage {
	return {
		originalUrl: "https://newsletter.test/hero.png",
		body: Buffer.from([9, 9, 9]),
		contentType: "image/png",
		filename: "0011223344556677.png",
	};
}

function initSubject(overrides?: {
	putImageObject?: (params: { key: string; body: Buffer; contentType: string }) => Promise<void>;
}) {
	const writes: { key: string; html: string }[] = [];
	const imagePuts: { key: string; contentType: string }[] = [];
	const store = initStoreEmailBody({
		putContent: async (input) => {
			writes.push(input);
		},
		putImageObject:
			overrides?.putImageObject ??
			(async (params) => {
				imagePuts.push({ key: params.key, contentType: params.contentType });
			}),
		imagesCdnBaseUrl: CDN,
		logger: HutchLogger.from(noopLogger),
	});
	return { store, writes, imagePuts };
}

describe("initStoreEmailBody", () => {
	it("inlines cid images as data URIs, strips remote images, and writes to a user-scoped key", async () => {
		const { store, writes } = initSubject();

		const key = await store({
			userId: USER,
			receivedAtMessageId: "2026-06-24T09:00:00.000Z#<m@x>",
			html: '<p><img src="email://cid/logo@x"></p><img src="https://tracker.test/p.gif">',
			inlineImages: [
				{ cid: "logo@x", contentType: "image/png", body: Buffer.from([1, 2, 3]) },
			],
			downloadedImages: [],
		});

		expect(writes).toHaveLength(1);
		expect(writes[0].key).toBe(key);
		expect(key).toContain("content/");
		// The key is partitioned by the owning user so two users' bodies never collide.
		expect(key).toContain(USER);
		// The cid image is inlined; the remote tracker is stripped; no parser-local
		// URL leaks into stored HTML.
		expect(writes[0].html).toContain("data:image/png;base64,AQID");
		expect(writes[0].html).not.toContain("tracker.test");
		expect(writes[0].html).not.toContain("email://cid");
	});

	it("uploads each downloaded image under the recipient's opaque prefix and rewrites its src to the CDN", async () => {
		const { store, writes, imagePuts } = initSubject();
		const receivedAtMessageId = "2026-06-24T09:00:00.000Z#<cdn@x>";

		await store({
			userId: USER,
			receivedAtMessageId,
			html: '<img src="https://newsletter.test/hero.png"><img src="https://tracker.test/p.gif">',
			inlineImages: [],
			downloadedImages: [heroImage()],
		});

		const prefix = emailImageS3KeyPrefix({ userId: USER, receivedAtMessageId });
		expect(imagePuts).toEqual([
			{ key: `${prefix}/0011223344556677.png`, contentType: "image/png" },
		]);
		expect(writes[0].html).toContain(`src="${CDN}/${prefix}/0011223344556677.png"`);
		// The opaque prefix must never embed the body's resource id components, and
		// an image absent from the download set keeps today's stripped-src shape.
		expect(prefix).not.toContain(USER);
		expect(writes[0].html).not.toContain("newsletter.test");
		expect(writes[0].html).not.toContain("tracker.test");
	});

	it("skips an image whose upload fails and still stores the body", async () => {
		const { store, writes } = initSubject({
			putImageObject: async () => {
				throw new Error("s3 unavailable");
			},
		});

		await store({
			userId: USER,
			receivedAtMessageId: "2026-06-24T09:00:00.000Z#<s3down@x>",
			html: '<p>Issue</p><img src="https://newsletter.test/hero.png">',
			inlineImages: [],
			downloadedImages: [heroImage()],
		});

		expect(writes).toHaveLength(1);
		expect(writes[0].html).toContain("<p>Issue</p>");
		expect(writes[0].html).not.toContain("newsletter.test");
	});

	it("writes sanitized HTML for an email with no inline images", async () => {
		const { store, writes } = initSubject();

		await store({
			userId: USER,
			receivedAtMessageId: "2026-06-24T09:00:00.000Z#<plain@x>",
			html: "<p>Just text</p><script>alert(1)</script>",
			inlineImages: [],
			downloadedImages: [],
		});

		expect(writes[0].html).toContain("<p>Just text</p>");
		expect(writes[0].html).not.toContain("<script");
	});

	it("returns undefined and writes nothing when sanitizing leaves no renderable body", async () => {
		const { store, writes } = initSubject();

		const key = await store({
			userId: USER,
			receivedAtMessageId: "2026-06-24T09:00:00.000Z#<empty@x>",
			html: "<style>p{color:red}</style><script>alert(1)</script>",
			inlineImages: [],
			downloadedImages: [],
		});

		// A body the sanitizer empties (only stripped tags) must NOT become a
		// zero-byte object that reads back as "" and renders a blank iframe — signal
		// "no body" so the caller persists `unparsed` and shows the unavailable panel.
		expect(key).toBeUndefined();
		expect(writes).toHaveLength(0);
	});
});
