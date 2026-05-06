import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PageBody } from "../../page-body.types";
import { render } from "../../render";
import { IMPORT_STYLES } from "./import.styles";
import type { ImportViewModel } from "./import.viewmodel";

const IMPORT_TEMPLATE = readFileSync(join(__dirname, "import.template.html"), "utf-8");
const IMPORT_CLIENT_SCRIPT = `<script src="/client-dist/import.client.js" defer></script>`;

export function ImportPage(vm: ImportViewModel): PageBody {
	const content = render(IMPORT_TEMPLATE, {
		...vm,
		showPagination: vm.totalPages > 1,
		hasPrev: Boolean(vm.prevUrl),
		hasNext: Boolean(vm.nextUrl),
	});

	return {
		seo: {
			title: "Review imported links — Readplace",
			description: "Review and confirm imported links.",
			canonicalUrl: `/import/${vm.sessionId}`,
			robots: "noindex, nofollow",
		},
		styles: IMPORT_STYLES,
		bodyClass: "page-import",
		content,
		scripts: IMPORT_CLIENT_SCRIPT,
	};
}
