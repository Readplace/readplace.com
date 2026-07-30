import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";
import { requireEnv } from "@packages/require-env";

const FRAME_COUNT = 5;
const FRAME_INTERVAL_MS = 150;

export async function captureTransitionFrames(args: {
	page: Page;
	flow: string;
}): Promise<void> {
	const flowDir = path.join(requireEnv("TRANSITION_FRAMES_DIR"), args.flow);
	await mkdir(flowDir, { recursive: true });
	for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
		const screenshot = await args.page.screenshot();
		await writeFile(path.join(flowDir, `frame-${frame}.png`), screenshot);
		await args.page.waitForTimeout(FRAME_INTERVAL_MS);
	}
}
