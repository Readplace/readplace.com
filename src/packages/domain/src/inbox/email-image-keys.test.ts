import { UserIdSchema } from "../user";
import { emailImageCdnUrl, emailImageS3KeyPrefix } from "./email-image-keys";

const USER_ID = UserIdSchema.parse("c6f587a1e604f02595c1032a764543d7");
const OTHER_USER_ID = UserIdSchema.parse("0123456789abcdef0123456789abcdef");
const RECEIVED_AT_MESSAGE_ID = "2026-07-16T16:42:03.359Z#<msg@host>";

describe("emailImageS3KeyPrefix", () => {
	it("derives a deterministic opaque prefix that never embeds the resource id", () => {
		const prefix = emailImageS3KeyPrefix({
			userId: USER_ID,
			receivedAtMessageId: RECEIVED_AT_MESSAGE_ID,
		});

		expect(prefix).toMatch(/^content\/email-images\/[0-9a-f]{32}$/);
		expect(prefix).not.toContain(USER_ID);
		expect(prefix).not.toContain(encodeURIComponent(RECEIVED_AT_MESSAGE_ID));
		expect(
			emailImageS3KeyPrefix({
				userId: USER_ID,
				receivedAtMessageId: RECEIVED_AT_MESSAGE_ID,
			}),
		).toBe(prefix);
	});

	it("gives distinct emails distinct prefixes", () => {
		const prefix = emailImageS3KeyPrefix({
			userId: USER_ID,
			receivedAtMessageId: RECEIVED_AT_MESSAGE_ID,
		});

		expect(
			emailImageS3KeyPrefix({
				userId: OTHER_USER_ID,
				receivedAtMessageId: RECEIVED_AT_MESSAGE_ID,
			}),
		).not.toBe(prefix);
		expect(
			emailImageS3KeyPrefix({
				userId: USER_ID,
				receivedAtMessageId: "2026-07-16T16:42:03.359Z#<other@host>",
			}),
		).not.toBe(prefix);
	});
});

describe("emailImageCdnUrl", () => {
	it("joins the base URL, opaque prefix, and filename", () => {
		const url = emailImageCdnUrl({
			baseUrl: "https://cdn.test.readplace.com",
			userId: USER_ID,
			receivedAtMessageId: RECEIVED_AT_MESSAGE_ID,
			filename: "0123456789abcdef.png",
		});

		const prefix = emailImageS3KeyPrefix({
			userId: USER_ID,
			receivedAtMessageId: RECEIVED_AT_MESSAGE_ID,
		});
		expect(url).toBe(`https://cdn.test.readplace.com/${prefix}/0123456789abcdef.png`);
	});
});
