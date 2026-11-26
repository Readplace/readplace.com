import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";

const HIGHLIGHT_COPY_STATUS_TEMPLATE = readFileSync(join(__dirname, "highlight-copy-status.template.html"), "utf-8");

export function renderHighlightCopyStatus(input: { copiedUrl: string }): string {
	return render(HIGHLIGHT_COPY_STATUS_TEMPLATE, { copiedUrl: input.copiedUrl }).trim();
}
