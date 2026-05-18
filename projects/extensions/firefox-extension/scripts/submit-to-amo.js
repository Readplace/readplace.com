#!/usr/bin/env node
// Wraps `pnpm sign` (web-ext sign → AMO) for the firefox-extension
// publish workflow. Idempotent: when AMO reports the version already
// exists, exits 0 so re-runs of the CI job don't fail on a no-op.

const { execSync } = require("node:child_process");

try {
	const output = execSync("pnpm sign", {
		cwd: __dirname + "/..",
		encoding: "utf-8",
		stdio: ["inherit", "pipe", "pipe"],
	});
	process.stdout.write(output);
} catch (error) {
	const output = (error.stdout ?? "") + (error.stderr ?? "");
	process.stderr.write(output);

	if (/Version .* already exists/.test(output)) {
		console.warn("Version already exists on AMO. Skipping — a previous submission with this version is already being processed.");
		process.exit(0);
	}
	process.exit(error.status ?? 1);
}
