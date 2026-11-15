import type { ReadOcrPagesLeft } from "@packages/provider-contracts/rate-limit";

export function initInMemoryOcrPagesLeft(params: { pagesLeft: number }): { readOcrPagesLeft: ReadOcrPagesLeft } {
	return { readOcrPagesLeft: async () => params.pagesLeft };
}
