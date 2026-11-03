import assert from "node:assert/strict";
import type { SaveProvenance } from "@packages/domain/article";
import { isIntentionalSave, NOT_INTENTIONAL_SAVE_KINDS } from "./intentional-save";

const EVERY_KIND: { [Kind in SaveProvenance["kind"]]: { provenance: Extract<SaveProvenance, { kind: Kind }>; intentional: boolean } } = {
	web: { provenance: { kind: "web" }, intentional: true },
	client: { provenance: { kind: "client", clientName: "chrome-extension" }, intentional: true },
	mcp: { provenance: { kind: "mcp", registeredName: "Claude" }, intentional: true },
	email: { provenance: { kind: "email", senderEmail: "news@example.com" }, intentional: false },
	import: { provenance: { kind: "import" }, intentional: false },
	"founder-seed": { provenance: { kind: "founder-seed" }, intentional: false },
	"hn-suggestion": {
		provenance: { kind: "hn-suggestion", campaignId: "c-1", snapshotAt: "2026-06-01T00:00:00.000Z", hnItemId: 1, rank: 1 },
		intentional: false,
	},
};

describe("isIntentionalSave", () => {
	it.each(Object.entries(EVERY_KIND))("classifies a %s save", (_kind, { provenance, intentional }) => {
		assert.equal(isIntentionalSave({ provenance }), intentional);
	});

	it("counts a save with no provenance as intentional", () => {
		assert.equal(isIntentionalSave({}), true);
	});
});

describe("NOT_INTENTIONAL_SAVE_KINDS", () => {
	it("names exactly the four kinds the reader did not choose", () => {
		assert.deepEqual([...NOT_INTENTIONAL_SAVE_KINDS].sort(), ["email", "founder-seed", "hn-suggestion", "import"]);
	});
});
