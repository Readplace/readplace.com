/* c8 ignore start -- composition root, no logic to test */
import assert from "node:assert";
import { requireEnv } from "@packages/require-env";
import { type HutchProviders, assembleHutchApp } from "./app";
import { initProdProviders } from "./providers/prod-providers";
import { initDevProviders } from "./providers/dev-providers";

export function createDevHutchApp({ appOrigin }: { appOrigin: string }) {
	const persistence = requireEnv<"prod" | "development">("PERSISTENCE");
	assert(
		persistence === "prod" || persistence === "development",
		`PERSISTENCE must be "prod" or "development", got "${persistence}"`,
	);
	const initProviders: (deps: { appOrigin: string }) => HutchProviders =
		persistence === "prod" ? initProdProviders : initDevProviders;
	return assembleHutchApp({ appOrigin, initProviders });
}
/* c8 ignore stop */
