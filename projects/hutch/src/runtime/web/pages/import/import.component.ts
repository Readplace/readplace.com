import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PageBody } from "../../page-body.types";
import { render } from "../../render";
import { IMPORT_STYLES } from "./import.styles";
import type {
	ImportAcquireViewModel,
	ImportMode,
	ImportTabViewModel,
	ImportViewModel,
} from "./import.viewmodel";

interface RenderedTab {
	readonly key: ImportTabViewModel["key"];
	readonly label: string;
	readonly href: string;
	readonly cssClass: "import__tab import__tab--active" | "import__tab";
	readonly ariaCurrent: "page" | "false";
}

function renderTab(tab: ImportTabViewModel): RenderedTab {
	return {
		key: tab.key,
		label: tab.label,
		href: tab.href,
		cssClass: tab.isActive ? "import__tab import__tab--active" : "import__tab",
		ariaCurrent: tab.isActive ? "page" : "false",
	};
}

const IMPORT_TEMPLATE = readFileSync(join(__dirname, "import.template.html"), "utf-8");
const IMPORT_ACQUIRE_TEMPLATE = readFileSync(join(__dirname, "import.acquire.template.html"), "utf-8");
const IMPORT_TABS_TEMPLATE = readFileSync(join(__dirname, "import.tabs.template.html"), "utf-8");
const IMPORT_UPLOAD_TEMPLATE = readFileSync(join(__dirname, "import.upload.template.html"), "utf-8");
const IMPORT_FROM_URL_PANEL_TEMPLATE = readFileSync(
	join(__dirname, "import.from-url.panel.template.html"),
	"utf-8",
);
const IMPORT_CLIENT_SCRIPT = `<script src="/client-dist/import.client.js" defer></script>`;

interface PanelConfig {
	readonly template: string;
	readonly canonicalUrl: string;
	readonly scripts: string;
}

const UPLOAD_AUTO_SUBMIT_SCRIPT = `
<script>
	(function () {
		function wire() {
			var form = document.querySelector('form.import__upload-form');
			if (!form) return;
			var input = form.querySelector('input[type="file"]');
			var dropzone = form.querySelector('[data-import-dropzone]');
			var meta = form.querySelector('[data-import-dropzone-meta]');
			if (!input || !dropzone) return;
			var defaultMeta = meta ? meta.textContent : '';

			function showFilename() {
				if (!input.files || input.files.length === 0) return;
				dropzone.classList.add('import__dropzone--has-file');
				if (meta) meta.textContent = input.files[0].name;
			}

			input.addEventListener('change', function () {
				showFilename();
				if (input.files && input.files.length > 0) form.requestSubmit();
			});

			['dragenter', 'dragover'].forEach(function (event) {
				dropzone.addEventListener(event, function (e) {
					e.preventDefault();
					dropzone.classList.add('import__dropzone--dragover');
				});
			});
			['dragleave', 'dragend', 'drop'].forEach(function (event) {
				dropzone.addEventListener(event, function () {
					dropzone.classList.remove('import__dropzone--dragover');
				});
			});
			dropzone.addEventListener('drop', function (e) {
				e.preventDefault();
				if (!e.dataTransfer || !e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
				input.files = e.dataTransfer.files;
				showFilename();
				form.requestSubmit();
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

const PANEL_CONFIG: Record<ImportMode, PanelConfig> = {
	upload: {
		template: IMPORT_UPLOAD_TEMPLATE,
		canonicalUrl: "/import",
		scripts: `${IMPORT_CLIENT_SCRIPT}${UPLOAD_AUTO_SUBMIT_SCRIPT}`,
	},
	"from-url": {
		template: IMPORT_FROM_URL_PANEL_TEMPLATE,
		canonicalUrl: "/import?mode=from-url",
		scripts: IMPORT_CLIENT_SCRIPT,
	},
};

export function ImportAcquirePage(vm: ImportAcquireViewModel): PageBody {
	const panel = PANEL_CONFIG[vm.mode];
	const tabs = vm.tabs.map(renderTab);
	const data = { ...vm, tabs, errorMessage: vm.errors?.[0]?.message };
	const tabsHtml = vm.showFromUrl ? render(IMPORT_TABS_TEMPLATE, data) : "";
	const panelHtml = render(panel.template, data);
	const content = render(IMPORT_ACQUIRE_TEMPLATE, { ...data, tabsHtml, panelHtml });

	return {
		seo: {
			title: "Import Links — Readplace",
			description: "Upload an export file or paste a URL to import links into your queue.",
			canonicalUrl: panel.canonicalUrl,
			robots: "noindex, nofollow",
		},
		styles: IMPORT_STYLES,
		bodyClass: "page-import",
		content: { html: content },
		scripts: panel.scripts,
	};
}
