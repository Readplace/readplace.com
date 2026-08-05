import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MCP_OPERATIONS } from "@packages/domain/mcp";

const LLMS_FULL_TXT = readFileSync(join(__dirname, "llms-full.txt"), "utf-8");
const AGENT_SKILL = readFileSync(
	join(__dirname, "web/agent-skills/skills/save-to-readplace/SKILL.md"),
	"utf-8",
);

describe("MCP operations reach every agent-facing doc", () => {
	it.each(MCP_OPERATIONS.map((operation) => operation.name))(
		"documents %s in llms-full.txt and the published agent skill",
		(name) => {
			assert.equal(
				LLMS_FULL_TXT.includes(name),
				true,
				`llms-full.txt must document the ${name} operation`,
			);
			assert.equal(
				AGENT_SKILL.includes(name),
				true,
				`the save-to-readplace skill must document the ${name} operation`,
			);
		},
	);

	it("describes each operation in llms-full.txt with the shared summary", () => {
		for (const operation of MCP_OPERATIONS) {
			assert.equal(
				LLMS_FULL_TXT.includes(operation.summary),
				true,
				`llms-full.txt must carry the shared summary for ${operation.name}`,
			);
		}
	});
});
