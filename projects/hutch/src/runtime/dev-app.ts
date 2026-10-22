/* c8 ignore start -- composition root, no logic to test */
import assert from "node:assert";
import express from "express";
import { requireEnv } from "@packages/require-env";
import { assembleReadplaceApp } from "./app";
import { initProdProviders } from "./providers/prod-providers";
import { initDevProviders } from "./providers/dev-providers";
import { initInMemoryArticleImages } from "./providers/in-memory-article-images";

export function createDevReadplaceApp({ appOrigin }: { appOrigin: string }) {
	const persistence = requireEnv<"prod" | "development">("PERSISTENCE");
	assert(
		persistence === "prod" || persistence === "development",
		`PERSISTENCE must be "prod" or "development", got "${persistence}"`,
	);
	if (persistence === "prod") return assembleReadplaceApp({ appOrigin, initProviders: initProdProviders });
	const images = initInMemoryArticleImages();
	const assembled = assembleReadplaceApp({
		appOrigin,
		initProviders: (input) => initDevProviders({ ...input, putImageObject: images.putImageObject }),
	});
	return { ...assembled, app: express().use(images.router).use(assembled.app) };
}
/* c8 ignore stop */
