import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WebDriver } from "selenium-webdriver";

const FRAME_COUNT = 5;
const FRAME_INTERVAL_MS = 150;

export async function captureTransitionFrames(args: {
	driver: WebDriver;
	flow: string;
}): Promise<void> {
	const flowDir = path.join("test-results", "transition-frames", args.flow);
	await mkdir(flowDir, { recursive: true });
	for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
		const screenshot = await args.driver.takeScreenshot();
		await writeFile(path.join(flowDir, `frame-${frame}.png`), screenshot, "base64");
		await args.driver.sleep(FRAME_INTERVAL_MS);
	}
}
