import { parseS3Uri } from "./parse-s3-uri";

describe("parseS3Uri", () => {
	it("splits s3://bucket/key into bucket and key", () => {
		expect(parseS3Uri("s3://test-bucket/content/abc.html")).toEqual({
			bucket: "test-bucket",
			key: "content/abc.html",
		});
	});

	it("preserves the full path including nested slashes", () => {
		expect(parseS3Uri("s3://hutch-content/content/example.com%2Fblog%2Fpost/content.html")).toEqual({
			bucket: "hutch-content",
			key: "content/example.com%2Fblog%2Fpost/content.html",
		});
	});
});
