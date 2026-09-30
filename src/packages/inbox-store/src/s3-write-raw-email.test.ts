import type { S3Client } from "@aws-sdk/client-s3";
import { initS3WriteRawEmail } from "./s3-write-raw-email";

type SendFn = S3Client["send"];

interface CapturedCommand {
	input: { Bucket?: string; Key?: string; Body?: Buffer; ContentType?: string };
}

function fakeClient(impl: (cmd: unknown) => unknown): Pick<S3Client, "send"> {
	return { send: (async (cmd: unknown) => impl(cmd)) as unknown as SendFn };
}

describe("initS3WriteRawEmail", () => {
	it("puts the raw message bytes to the raw-email bucket under the given key as RFC 822 mail", async () => {
		let captured: CapturedCommand | undefined;
		const write = initS3WriteRawEmail({
			client: fakeClient((cmd) => {
				captured = cmd as CapturedCommand;
				return {};
			}),
			bucketName: "raw-bucket",
		});
		const raw = Buffer.from("From: news@example.com\r\n\r\nHello");

		await write({ key: "gmail-import/user-1/job/abc.eml", raw });

		expect(captured?.input).toEqual({
			Bucket: "raw-bucket",
			Key: "gmail-import/user-1/job/abc.eml",
			Body: raw,
			ContentType: "message/rfc822",
		});
	});

	it("propagates a failed write so the caller can retry", async () => {
		const write = initS3WriteRawEmail({
			client: fakeClient(() => {
				throw new Error("throttled");
			}),
			bucketName: "raw-bucket",
		});

		await expect(write({ key: "k", raw: Buffer.from("x") })).rejects.toThrow("throttled");
	});
});
