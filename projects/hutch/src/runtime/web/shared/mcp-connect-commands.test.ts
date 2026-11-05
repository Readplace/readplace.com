import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GEMINI_MCP_ADD_COMMAND } from "./mcp-connect-commands";

describe("GEMINI_MCP_ADD_COMMAND", () => {
	it.each(["llms.txt", "llms-full.txt"])("is the command %s tells an assistant to run", (file) => {
		expect(readFileSync(join(__dirname, "../..", file), "utf-8")).toContain(GEMINI_MCP_ADD_COMMAND);
	});
});
