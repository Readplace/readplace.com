export class TransportLadderFailure extends Error {
	readonly retryDisposition: "recoverable" | "unclassified";
	readonly previousErrors: readonly unknown[];

	constructor(params: { error: unknown; previousErrors: readonly unknown[]; retryDisposition: "recoverable" | "unclassified" }) {
		super(params.error instanceof Error ? params.error.message : String(params.error), { cause: params.error });
		this.retryDisposition = params.retryDisposition;
		this.previousErrors = params.previousErrors;
	}
}

export function isHardCrawlFailure(error: unknown): boolean {
	let current = error;
	while (typeof current === "object" && current !== null) {
		if (("name" in current && current.name === "AbortError") || ("code" in current && current.code === "EBLOCKEDADDRESS")) return true;
		current = "cause" in current ? current.cause : undefined;
	}
	return false;
}
