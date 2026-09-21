import assert from "node:assert";

export interface PlaywrightRenderer {
	image: string;
	workspaceRoot: string;
	forwardEnv: string[];
}

export function playwrightImage(pinnedVersion: string | undefined): string {
	assert(
		pinnedVersion && /^\d+\.\d+\.\d+$/.test(pinnedVersion),
		`@playwright/test must be pinned to an exact version so the container matches the browsers the baselines were captured with, got "${pinnedVersion}"`,
	);
	return `mcr.microsoft.com/playwright:v${pinnedVersion}-noble`;
}

export function containerisedCommand(
	command: string,
	renderer: PlaywrightRenderer,
	projectRoot: string,
): string {
	const forwarded = renderer.forwardEnv.map((name) => `--env ${name}`).join(" ");
	const inside = [
		`cd '${renderer.workspaceRoot}'`,
		". ./.envrc",
		`cd '${projectRoot}'`,
		`exec ${command}`,
	].join(" && ");
	return [
		"docker run --rm --ipc=host",
		`--volume '${renderer.workspaceRoot}:${renderer.workspaceRoot}'`,
		`--workdir '${projectRoot}'`,
		forwarded,
		renderer.image,
		`bash -c "${inside}"`,
	].join(" ");
}
