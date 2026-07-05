import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SUPPORTED_CLIENTS } from "@packages/supported-clients";

const LLMS_TXT = readFileSync(join(__dirname, "llms.txt"), "utf-8");
const LLMS_FULL_TXT = readFileSync(join(__dirname, "llms-full.txt"), "utf-8");

describe("llms AI-discovery docs", () => {
	it("mention every supported client by display name", () => {
		for (const client of SUPPORTED_CLIENTS) {
			assert.equal(
				LLMS_TXT.includes(client.displayName),
				true,
				`llms.txt must mention ${client.displayName}`,
			);
			assert.equal(
				LLMS_FULL_TXT.includes(client.displayName),
				true,
				`llms-full.txt must mention ${client.displayName}`,
			);
		}
	});
});
