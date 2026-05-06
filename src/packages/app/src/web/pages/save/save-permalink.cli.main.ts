import { runSavePermalinkCli } from "./save-permalink";

const exitCode = runSavePermalinkCli({
	argv: process.argv.slice(2),
	stdout: process.stdout,
	stderr: process.stderr,
});
process.exit(exitCode);
