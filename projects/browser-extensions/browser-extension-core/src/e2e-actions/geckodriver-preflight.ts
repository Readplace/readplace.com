import assert from "node:assert";
import { execFileSync } from "node:child_process";

/* Every firefox suite passes --allow-system-access to geckodriver (Firefox 153
 * refuses WebDriver navigation to moz-extension:// without it), and geckodriver
 * below 0.36.0 rejects that flag by exiting with status 64 before its WebDriver
 * server starts. Selenium surfaces that as a bare "Server terminated early with
 * status 64" — which cost two red CI runs on 2026-08-09 before anyone found the
 * stale geckodriver inside the runner image. Failing here instead names the
 * remedy. */
export function assertGeckodriverSupportsSystemAccess(): void {
	const output = execFileSync("geckodriver", ["--version"], { encoding: "utf8" });
	const match = output.match(/geckodriver (\d+)\.(\d+)\.(\d+)/);
	assert(match, `could not parse a version from \`geckodriver --version\`: ${output.split("\n")[0]}`);
	const major = Number(match[1]);
	const minor = Number(match[2]);
	assert(
		major > 0 || minor >= 36,
		`geckodriver ${match[1]}.${match[2]}.${match[3]} rejects the --allow-system-access flag the firefox suites require (needs >= 0.36.0) — rebuild the self-hosted runner image: .github/runner/gha-runner/rebuild.sh`,
	);
}
