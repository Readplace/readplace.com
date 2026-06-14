import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import { buildReaderIframeSrcdoc } from "./reader-iframe-srcdoc";

const TEMPLATE = readFileSync(
	join(__dirname, "reader-ready.template.html"),
	"utf-8",
);

export interface ReaderReadyInput {
	content: string;
	oob?: boolean;
	appOrigin: string;
}

export function renderReaderReady(input: ReaderReadyInput): string {
	const srcdoc = buildReaderIframeSrcdoc({
		content: input.content,
		appOrigin: input.appOrigin,
	});
	return render(TEMPLATE, { srcdoc, oob: input.oob === true });
}
