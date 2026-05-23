import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "../../../render";
import { buildReaderIframeSrcdoc } from "./reader-iframe-srcdoc";

const TEMPLATE = readFileSync(
	join(__dirname, "reader-ready.template.html"),
	"utf-8",
);

export interface ReaderReadyInput {
	content: string;
	oob?: boolean;
}

export function renderReaderReady(input: ReaderReadyInput): string {
	const srcdoc = buildReaderIframeSrcdoc({ content: input.content });
	return render(TEMPLATE, { srcdoc, oob: input.oob === true });
}
