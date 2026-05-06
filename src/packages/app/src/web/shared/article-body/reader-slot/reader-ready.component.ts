import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "../../../render";

const TEMPLATE = readFileSync(
	join(__dirname, "reader-ready.template.html"),
	"utf-8",
);

export interface ReaderReadyInput {
	content: string;
}

export function renderReaderReady(input: ReaderReadyInput): string {
	return render(TEMPLATE, { content: input.content });
}
