export const PARSE_ERROR_STREAM = "parse-errors";

export interface ParseErrorEvent {
	stream: typeof PARSE_ERROR_STREAM;
	event: "parse-failure";
	timestamp: string;
	url: string | null;
	reason: string;
	source:
		| "save-link"
		| "save-link-raw-html"
		| "hutch-handler"
		| "hutch-view"
		| "hutch-queue"
		| "generate-summary";
}
