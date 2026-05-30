import assert from "node:assert/strict";
import { internetReaderUserAgent } from "./user-agent";

describe("internetReaderUserAgent", () => {
	it("identifies the product while keeping a Chrome token", () => {
		const ua = internetReaderUserAgent({
			appVersion: "0.1.0",
			chromeVersion: "124.0.0.0",
		});
		assert.ok(ua.startsWith("Mozilla/5.0"));
		assert.ok(ua.includes("InternetReader/0.1.0"));
		assert.ok(ua.includes("Chrome/124.0.0.0 Safari/537.36"));
	});
});
