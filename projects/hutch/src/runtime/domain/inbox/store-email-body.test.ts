import { UserIdSchema } from "@packages/domain/user";
import { initStoreEmailBody } from "./store-email-body";

const USER = UserIdSchema.parse("00000000000000000000000000000001");

describe("initStoreEmailBody", () => {
	it("inlines cid images as data URIs, strips remote images, and writes to a user-scoped key", async () => {
		const writes: { key: string; html: string }[] = [];
		const store = initStoreEmailBody({
			putContent: async (input) => {
				writes.push(input);
			},
		});

		const key = await store({
			userId: USER,
			receivedAtMessageId: "2026-06-24T09:00:00.000Z#<m@x>",
			html: '<p><img src="email://cid/logo@x"></p><img src="https://tracker.test/p.gif">',
			inlineImages: [
				{ cid: "logo@x", contentType: "image/png", body: Buffer.from([1, 2, 3]) },
			],
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

	it("writes sanitized HTML for an email with no inline images", async () => {
		let written: string | undefined;
		const store = initStoreEmailBody({
			putContent: async ({ html }) => {
				written = html;
			},
		});

		await store({
			userId: USER,
			receivedAtMessageId: "2026-06-24T09:00:00.000Z#<plain@x>",
			html: "<p>Just text</p><script>alert(1)</script>",
			inlineImages: [],
		});

		expect(written).toContain("<p>Just text</p>");
		expect(written).not.toContain("<script");
	});

	it("returns undefined and writes nothing when sanitizing leaves no renderable body", async () => {
		const writes: { key: string; html: string }[] = [];
		const store = initStoreEmailBody({
			putContent: async (input) => {
				writes.push(input);
			},
		});

		const key = await store({
			userId: USER,
			receivedAtMessageId: "2026-06-24T09:00:00.000Z#<empty@x>",
			html: "<style>p{color:red}</style><script>alert(1)</script>",
			inlineImages: [],
		});

		// A body the sanitizer empties (only stripped tags) must NOT become a
		// zero-byte object that reads back as "" and renders a blank iframe — signal
		// "no body" so the caller persists `unparsed` and shows the unavailable panel.
		expect(key).toBeUndefined();
		expect(writes).toHaveLength(0);
	});
});
