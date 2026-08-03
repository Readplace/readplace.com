import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WebDriver } from "selenium-webdriver";
import { getEnv } from "@packages/require-env";
import { transitionFramesPath } from "../e2e/transition-frames-path";

const FRAME_COUNT = 5;
const FRAME_INTERVAL_MS = 150;

export async function captureTransitionFrames(args: {
	driver: WebDriver;
	flow: string;
}): Promise<void> {
	const flowDir = transitionFramesPath({
		root: getEnv("CI_ARTIFACT_ROOT"),
		runId: getEnv("GITHUB_RUN_ID"),
		flow: args.flow,
	});
	await mkdir(flowDir, { recursive: true });
	for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
		const screenshot = await args.driver.takeScreenshot();
		await writeFile(path.join(flowDir, `frame-${frame}.png`), screenshot, "base64");
		await args.driver.sleep(FRAME_INTERVAL_MS);
	}
}
