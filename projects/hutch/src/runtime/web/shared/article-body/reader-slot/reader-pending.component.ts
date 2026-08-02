import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";

const TEMPLATE = readFileSync(
	join(__dirname, "reader-pending.template.html"),
	"utf-8",
);

const DEFAULT_LABEL = "Generating clean reader view";

export interface ReaderPendingInput {
	/** The next polling URL. Required: pending-without-poll is now handled
	 * by the slot dispatcher routing to `renderReaderFailed({ variant: "slow" })`. */
	pollUrl: string;
	oob?: boolean;
	label?: string;
	/** Optional secondary line rendered in a smaller, muted style below the
	 * primary label. Callers pass the hint text directly — this component stays
	 * media-type-agnostic. */
	loadingHint?: string;
}

export function renderReaderPending(input: ReaderPendingInput): string {
	return render(TEMPLATE, {
		pollUrl: input.pollUrl,
		oob: input.oob === true,
		label: input.label ?? DEFAULT_LABEL,
		loadingHint: input.loadingHint,
	});
}
