import { firefoxS3Config } from "./s3-config";

describe("firefoxS3Config", () => {
	it("should build bucket name with stage", () => {
		expect(firefoxS3Config.getBucketName("prod")).toBe("hutch-extension-prod");
	});

	it("should build extension download URL", () => {
		expect(firefoxS3Config.getExtensionDownloadUrl({ stage: "prod", filename: "hutch-1.0.0.xpi" })).toBe(
			"https://hutch-extension-prod.s3.ap-southeast-2.amazonaws.com/hutch-1.0.0.xpi",
		);
	});

	it("should build latest pointer URL", () => {
		expect(firefoxS3Config.getLatestPointerUrl("prod")).toBe(
			"https://hutch-extension-prod.s3.ap-southeast-2.amazonaws.com/latest.txt",
		);
	});

	it("should build update manifest URL", () => {
		expect(firefoxS3Config.getUpdateManifestUrl("prod", "updates.json")).toBe(
			"https://hutch-extension-prod.s3.ap-southeast-2.amazonaws.com/updates.json",
		);
	});
});
