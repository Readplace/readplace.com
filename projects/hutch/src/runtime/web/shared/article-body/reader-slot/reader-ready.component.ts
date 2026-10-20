import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import { prepareReaderContent } from "./reader-content";
import type { ArticleBody } from "@packages/domain/article";

const TEMPLATE = readFileSync(
	join(__dirname, "reader-ready.template.html"),
	"utf-8",
);

export interface ReaderReadyInput {
	content: ArticleBody;
	oob?: boolean;
	appOrigin: string;
}

export function renderReaderReady(input: ReaderReadyInput): string {
	return render(TEMPLATE, {
		content: prepareReaderContent({ content: input.content, appOrigin: input.appOrigin }).html,
		oob: input.oob === true,
	});
}
