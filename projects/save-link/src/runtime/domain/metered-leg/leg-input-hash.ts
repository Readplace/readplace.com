import { createHash } from "node:crypto";
import type { MeteredLeg } from "@packages/provider-contracts/metered-leg-ledger";

export function legInputHash(p: { url: string; leg: MeteredLeg; inputs: readonly string[] }): string {
	return createHash("sha256")
		.update(`${p.url}\n${p.leg}\n${p.inputs.join("\n")}`)
		.digest("hex");
}
