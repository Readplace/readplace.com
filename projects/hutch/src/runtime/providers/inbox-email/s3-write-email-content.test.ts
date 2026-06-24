import type { S3Client } from "@aws-sdk/client-s3";
import { initS3WriteEmailContent } from "./s3-write-email-content";

type SendFn = S3Client["send"];

interface CapturedCommand {
	input: { Bucket?: string; Key?: string; Body?: string; ContentType?: string };
}

function fakeClient(impl: (cmd: unknown) => unknown): Pick<S3Client, "send"> {
	return { send: (async (cmd: unknown) => impl(cmd)) as unknown as SendFn };
}

describe("initS3WriteEmailContent", () => {
	it("puts the html to the content bucket under the given key", async () => {
		let captured: CapturedCommand | undefined;
		const write = initS3WriteEmailContent({
			client: fakeClient((cmd) => {
				captured = cmd as CapturedCommand;
				return {};
			}),
			bucketName: "content-bucket",
		});

		await write({ key: "content/x/content.html", html: "<p>hi</p>" });

		expect(captured?.input.Bucket).toBe("content-bucket");
		expect(captured?.input.Key).toBe("content/x/content.html");
		expect(captured?.input.Body).toBe("<p>hi</p>");
		expect(captured?.input.ContentType).toContain("text/html");
	});
});
