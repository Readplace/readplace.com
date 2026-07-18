import { LAMBDA_SYNC_INVOKE_PAYLOAD_BYTES } from "../article/article.schema";
import { MAX_IMPORT_FILE_BYTES } from "./import-session.schema";

describe("import upload limit", () => {
	const BASE64_INFLATION = 4 / 3;

	it("keeps an import upload within the Lambda sync-invoke payload quota once base64-inflated, with room for the invoke envelope", () => {
		expect(MAX_IMPORT_FILE_BYTES * BASE64_INFLATION).toBeLessThan(LAMBDA_SYNC_INVOKE_PAYLOAD_BYTES);
	});

	it("stays above the previous 4 MiB cap so no previously accepted file is refused", () => {
		expect(MAX_IMPORT_FILE_BYTES).toBeGreaterThan(4 * 1024 * 1024);
	});
});
