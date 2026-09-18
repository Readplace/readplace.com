import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MCP_OPERATIONS } from "@packages/domain/mcp";

const LLMS_FULL_TXT = readFileSync(join(__dirname, "llms-full.txt"), "utf-8");
const AGENT_SKILL = readFileSync(
	join(__dirname, "web/agent-skills/skills/save-to-readplace/SKILL.md"),
	"utf-8",
);
const ARTICLE_LINK_GUIDANCE =
	"Saved-article results expose `url` for the user's private Readplace reader.";

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

	it("tells agents to use article URLs as private reader links", () => {
		for (const [name, text] of [
			["llms-full.txt", LLMS_FULL_TXT],
			["the save-to-readplace skill", AGENT_SKILL],
		]) {
			assert.equal(
				text.includes(ARTICLE_LINK_GUIDANCE),
				true,
				`${name} must identify url as the private reader link`,
			);
			assert.equal(
				text.includes("Always link `url` when showing or recommending an article."),
				true,
				`${name} must tell agents to link article URLs`,
			);
			assert.equal(
				text.includes("`readerUrl`"),
				false,
				`${name} must not publish readerUrl`,
			);
			assert.equal(
				text.includes("original publisher"),
				false,
				`${name} must not describe an original-publisher result`,
			);
		}
	});
});
