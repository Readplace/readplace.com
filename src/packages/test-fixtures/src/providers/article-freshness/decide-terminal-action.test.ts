import assert from "node:assert/strict";
import { decideTerminalAction } from "./decide-terminal-action";

describe("decideTerminalAction", () => {
	it("treats undefined crawl as refresh-eligible so the TTL gate decides", () => {
		assert.equal(decideTerminalAction(undefined), "refresh-eligible");
	});

	it("treats pending crawl as refresh-eligible (in-flight; TTL gate decides)", () => {
		assert.equal(
			decideTerminalAction({ status: "pending" }),
			"refresh-eligible",
		);
	});

	it("treats ready crawl as refresh-eligible (stale-TTL applies)", () => {
		assert.equal(
			decideTerminalAction({ status: "ready" }),
			"refresh-eligible",
		);
	});

	it("skips failed crawl — operator owns recovery via /admin/recrawl", () => {
		assert.equal(
			decideTerminalAction({ status: "failed", reason: "parse-error" }),
			"skip",
		);
	});

	it("skips unsupported crawl — PDFs / paywalls never auto-reprime", () => {
		assert.equal(
			decideTerminalAction({ status: "unsupported", reason: "pdf" }),
			"skip",
		);
	});
});
