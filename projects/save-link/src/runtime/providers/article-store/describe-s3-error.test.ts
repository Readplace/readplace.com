import { S3ServiceException } from "@aws-sdk/client-s3";
import { describeS3Error } from "./describe-s3-error";

describe("describeS3Error", () => {
	it("names the missing IAM permissions for a 403, which HEAD cannot report as a typed error", () => {
		const forbidden = new S3ServiceException({
			name: "Unknown",
			$fault: "client",
			$metadata: { httpStatusCode: 403 },
		});

		expect(describeS3Error(forbidden)).toBe(
			"AccessDenied (HTTP 403) — role likely missing s3:GetObject/s3:ListBucket on the bucket",
		);
	});

	it("points a 400 at the 1024-byte key limit rather than a missing object", () => {
		const keyTooLong = new S3ServiceException({
			name: "KeyTooLongError",
			$fault: "client",
			$metadata: { httpStatusCode: 400 },
		});

		expect(describeS3Error(keyTooLong)).toBe(
			"KeyTooLongError (HTTP 400) — S3 rejected the request itself (a key over the 1024-byte limit is the known cause), not a missing object",
		);
	});

	it("reports the decoded exception name and status for any other S3 failure", () => {
		const internalError = new S3ServiceException({
			name: "InternalError",
			$fault: "server",
			$metadata: { httpStatusCode: 500 },
		});

		expect(describeS3Error(internalError)).toBe("InternalError (HTTP 500)");
	});

	it("reports an unknown status when the response carried no HTTP status code", () => {
		const noStatus = new S3ServiceException({
			name: "TimeoutError",
			$fault: "client",
			$metadata: {},
		});

		expect(describeS3Error(noStatus)).toBe("TimeoutError (HTTP unknown)");
	});

	it("passes through the message of a non-SDK error such as a socket failure", () => {
		expect(describeS3Error(new Error("socket hang up"))).toBe("socket hang up");
	});

	it("stringifies a thrown value that is not an Error at all", () => {
		expect(describeS3Error("connection reset")).toBe("connection reset");
	});
});
