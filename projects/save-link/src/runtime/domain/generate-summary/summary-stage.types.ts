/**
 * Worker-side stage strings.
 * Kept as a literal type, duplicating the consumer's stage union, to avoid
 * a cross-project relative import.
 * Terminal stages are omitted because by the time the worker would write
 * them the row's status attribute has already flipped to a terminal value.
 */
export type SummaryStage = "summary-started" | "summary-generating";

export type MarkSummaryStage = (params: {
	url: string;
	stage: SummaryStage;
}) => Promise<void>;
