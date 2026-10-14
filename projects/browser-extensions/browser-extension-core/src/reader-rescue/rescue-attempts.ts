import "../zod-config";
import { z } from "zod";

export const READER_RESCUES_STORAGE_KEY = "hutch_reader_rescues";

const ClaimedArticleIdsSchema = z.array(z.string());

export interface RescueAttemptStore {
	read: () => Promise<unknown>;
	write: (articleIds: string[]) => Promise<void>;
}

export type RescueAttempts = { claim: (articleId: string) => Promise<"first" | "repeat"> };

export function initRescueAttempts(deps: { store: RescueAttemptStore }): RescueAttempts {
	let settled: Promise<unknown> = Promise.resolve();

	async function claimInTurn(articleId: string): Promise<"first" | "repeat"> {
		const stored = ClaimedArticleIdsSchema.safeParse(await deps.store.read());
		const claimed = stored.success ? stored.data : [];
		if (claimed.includes(articleId)) return "repeat";
		await deps.store.write([...claimed, articleId]);
		return "first";
	}

	return {
		claim(articleId) {
			const claimed = settled.then(() => claimInTurn(articleId));
			settled = Promise.allSettled([claimed]);
			return claimed;
		},
	};
}
