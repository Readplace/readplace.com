/* c8 ignore start -- composition root, no logic to test */
import assert from "node:assert";
import { requireEnv } from "@packages/require-env";
import { type ReadplaceProviders, assembleReadplaceApp } from "./app";
import { initProdProviders } from "./providers/prod-providers";
import { initDevProviders } from "./providers/dev-providers";

export function createDevReadplaceApp({ appOrigin }: { appOrigin: string }) {
	const persistence = requireEnv<"prod" | "development">("PERSISTENCE");
	assert(
		persistence === "prod" || persistence === "development",
		`PERSISTENCE must be "prod" or "development", got "${persistence}"`,
	);
	const initProviders: (deps: { appOrigin: string }) => ReadplaceProviders =
		persistence === "prod" ? initProdProviders : initDevProviders;
	return assembleReadplaceApp({ appOrigin, initProviders });
}
/* c8 ignore stop */
