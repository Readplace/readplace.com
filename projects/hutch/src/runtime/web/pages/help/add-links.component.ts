import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HtmlPage, render } from "@packages/web-shell";
import type { Component } from "@packages/web-shell";

const HELP_ADD_LINKS_TEMPLATE = readFileSync(
	join(__dirname, "add-links.template.html"),
	"utf-8",
);

export function HelpAddLinksPage(): Component {
	return HtmlPage(render(HELP_ADD_LINKS_TEMPLATE, {}));
}
