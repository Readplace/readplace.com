import { requireEnv } from "@packages/require-env";
import { z } from "zod";

export function transcriptAllowanceSecondsFromEnv(): number {
	return z.coerce.number().int().positive().parse(requireEnv("TRANSCRIPT_ALLOWANCE_SECONDS"));
}
