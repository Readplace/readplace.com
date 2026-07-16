import { createPresignerClient, mintUploadUrl } from "./mint-upload-url";

const STATIC_CONFIG = {
	region: "us-east-1",
	credentials: { accessKeyId: "AKIAEXAMPLE", secretAccessKey: "secretexample" },
};

describe("mintUploadUrl", () => {
	it("mints a presigned PUT URL free of checksum params so a real-body PUT is not rejected", async () => {
		const client = createPresignerClient(STATIC_CONFIG);
		const url = await mintUploadUrl({
			client,
			bucket: "hutch-pending-pdf-test",
			key: "pending-pdf/example.com%2Fdoc.pdf.pdf",
			contentType: "application/pdf",
			contentLength: 12_345,
			expiresIn: 900,
		});

		const params = new URL(url).searchParams;
		const keys = [...params.keys()].map((k) => k.toLowerCase());
		expect(keys.some((k) => k.startsWith("x-amz-checksum"))).toBe(false);
		expect(keys.some((k) => k.startsWith("x-amz-sdk-checksum"))).toBe(false);
	});

	it("signs content-length so S3 rejects a body whose length differs from the slot", async () => {
		const client = createPresignerClient(STATIC_CONFIG);
		const url = await mintUploadUrl({
			client,
			bucket: "hutch-pending-pdf-test",
			key: "pending-pdf/example.com%2Fdoc.pdf.pdf",
			contentType: "application/pdf",
			contentLength: 12_345,
			expiresIn: 900,
		});

		const signed = new URL(url).searchParams.get("X-Amz-SignedHeaders") ?? "";
		expect(signed.split(";")).toContain("content-length");
	});
});
