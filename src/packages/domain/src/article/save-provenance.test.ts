import assert from "node:assert/strict";
import { SaveProvenanceSchema, type SaveProvenance } from "./save-provenance";

describe("SaveProvenanceSchema", () => {
	it("round-trips every kind, so no stored row can fail the read path it is parsed on", () => {
		const stored: SaveProvenance[] = [
			{ kind: "web" },
			{ kind: "client", clientName: "chrome" },
			{ kind: "email", senderEmail: "news@example.com" },
			{ kind: "import" },
			{ kind: "mcp", registeredName: "Claude" },
		];

		assert.deepEqual(stored.map((value) => SaveProvenanceSchema.parse(value)), stored);
	});

	it("keeps reading a client row whose name has left the registry", () => {
		assert.deepEqual(SaveProvenanceSchema.parse({ kind: "client", clientName: "netscape" }), {
			kind: "client",
			clientName: "netscape",
		});
	});
});
