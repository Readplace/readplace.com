import assert from "node:assert/strict";
import { version } from "typescript";

describe("TypeScript 7.0 migration guard", () => {
	it("keeps the workspace below TypeScript 7.0 while the base tsconfig relies on ignoreDeprecations", () => {
		const [major] = version.split(".").map(Number);

		assert.ok(
			major < 7,
			`TypeScript ${version}: 7.0 removes node10 module resolution and the other ` +
				`6.0-deprecated compiler options, so the "ignoreDeprecations": "6.0" escape hatch ` +
				`in tsconfig.config.base.json stops silencing anything and the build hard-fails. ` +
				`Before bumping to 7.x, migrate moduleResolution "node" to "nodenext" (or "bundler") ` +
				`and remove ignoreDeprecations. The earlier nodenext attempt changed CJS emit and ` +
				`broke hutch /auth/checkout/success and a password-reset dynamic import — redo it deliberately.`,
		);
	});
});
