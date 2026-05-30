import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EMAIL_COLORS } from "./email-colors";
import { render } from "./render";

const READER_READY_EMAIL_TEMPLATE = readFileSync(
	join(__dirname, "reader-ready-email.template.html"),
	"utf-8",
);

export function buildReaderReadyEmailHtml({
	readerUrl,
	title,
	siteName,
}: {
	readerUrl: string;
	title: string;
	siteName: string;
}): string {
	return render(READER_READY_EMAIL_TEMPLATE, {
		readerUrl,
		title,
		siteName,
		colors: EMAIL_COLORS,
	});
}
