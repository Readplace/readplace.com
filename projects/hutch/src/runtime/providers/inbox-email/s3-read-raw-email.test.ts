import { NoSuchKey, type S3Client } from "@aws-sdk/client-s3";
import { initS3ReadRawEmail } from "./s3-read-raw-email";

type SendFn = S3Client["send"];

interface CapturedCommand {
	input: { Bucket?: string; Key?: string };
}

function fakeClient(impl: (cmd: unknown) => unknown): Pick<S3Client, "send"> {
	return { send: (async (cmd: unknown) => impl(cmd)) as unknown as SendFn };
}

function noSuchKey(): NoSuchKey {
	return new NoSuchKey({ $metadata: {}, message: "missing" });
}

describe("initS3ReadRawEmail", () => {
	it("returns the object bytes as a Buffer", async () => {
		let captured: CapturedCommand | undefined;
		const read = initS3ReadRawEmail({
			client: fakeClient((cmd) => {
				captured = cmd as CapturedCommand;
				return { Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } };
			}),
			bucketName: "raw-bucket",
		});

		const result = await read("inbound/x");

		expect(captured?.input.Bucket).toBe("raw-bucket");
		expect(captured?.input.Key).toBe("inbound/x");
		expect(result).toEqual(Buffer.from([1, 2, 3]));
	});

	it("returns undefined when the object is missing (NoSuchKey)", async () => {
		const read = initS3ReadRawEmail({
			client: fakeClient(() => {
				throw noSuchKey();
			}),
			bucketName: "raw-bucket",
		});

		expect(await read("missing")).toBeUndefined();
	});

	it("returns undefined when the response has no Body", async () => {
		const read = initS3ReadRawEmail({
			client: fakeClient(() => ({})),
			bucketName: "raw-bucket",
		});

		expect(await read("x")).toBeUndefined();
	});

	it("rethrows errors that are not NoSuchKey", async () => {
		const read = initS3ReadRawEmail({
			client: fakeClient(() => {
				throw new Error("throttled");
			}),
			bucketName: "raw-bucket",
		});

		await expect(read("x")).rejects.toThrow("throttled");
	});
});
