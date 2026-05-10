import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PageBody } from "../../page-body.types";
import { render } from "../../render";
import { IMPORT_STYLES } from "./import.styles";
import type { ImportUploadViewModel, ImportViewModel } from "./import.viewmodel";

const IMPORT_TEMPLATE = readFileSync(join(__dirname, "import.template.html"), "utf-8");
const IMPORT_UPLOAD_TEMPLATE = readFileSync(join(__dirname, "import.upload.template.html"), "utf-8");
const IMPORT_CLIENT_SCRIPT = `<script src="/client-dist/import.client.js" defer></script>`;

const UPLOAD_AUTO_SUBMIT_SCRIPT = `
<script>
	(function () {
		function wire() {
			var form = document.querySelector('form.import__upload-form');
			if (!form) return;
			var input = form.querySelector('input[type="file"]');
			if (!input) return;
			input.addEventListener('change', function () {
				if (input.files && input.files.length > 0) form.requestSubmit();
			});
		}
		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', wire, { once: true });
		} else {
			wire();
		}
	})();
</script>
`;

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
		content: { html: content },
		scripts: IMPORT_CLIENT_SCRIPT,
	};
}

export function ImportUploadPage(vm: ImportUploadViewModel): PageBody {
	const content = render(IMPORT_UPLOAD_TEMPLATE, vm);

	return {
		seo: {
			title: "Import Links — Readplace",
			description: "Upload an export file and import the links into your queue.",
			canonicalUrl: "/import",
			robots: "noindex, nofollow",
		},
		styles: IMPORT_STYLES,
		bodyClass: "page-import",
		content: { html: content },
		scripts: UPLOAD_AUTO_SUBMIT_SCRIPT,
	};
}
