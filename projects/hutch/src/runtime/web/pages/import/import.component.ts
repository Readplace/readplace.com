import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import type { CspNonce, PageBody } from "@packages/web-shell";

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
	readonly scripts: (cspNonce: CspNonce) => string;
}

const uploadAutoSubmitScript = (cspNonce: CspNonce) => `
<script nonce="${cspNonce}">
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

const fromUrlAutoSubmitScript = (cspNonce: CspNonce) => `
<script nonce="${cspNonce}">
	(function () {
		function wire() {
			var form = document.querySelector('form.import__from-url-form');
			if (!form) return;
			var input = form.querySelector('input[name="url"]');
			if (!input || input.value.trim() === '') return;
			form.requestSubmit();
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
		scripts: (cspNonce) => `${IMPORT_CLIENT_SCRIPT}${uploadAutoSubmitScript(cspNonce)}`,
	},
	"from-url": {
		template: IMPORT_FROM_URL_PANEL_TEMPLATE,
		scripts: (cspNonce) => `${IMPORT_CLIENT_SCRIPT}${fromUrlAutoSubmitScript(cspNonce)}`,
	},
};

const IMPORT_FAQ: readonly { readonly question: string; readonly answer: string }[] = [
	{
		question: "Do I need an account to import?",
		answer:
			"No. Paste a link or upload a file and review the results straight away — an account is only asked for when you save the selection to your queue.",
	},
	{
		question: "What file formats work?",
		answer:
			"Any text-shaped file: HTML, JSON, CSV, OPML, Markdown, or plain text. Readplace scans for http(s):// URLs, so the exact format doesn't matter.",
	},
	{
		question: "How many links can I import at once?",
		answer:
			"Up to 2,000 links per import, from files up to 4.5 MB. For anything larger, email the file to readplace+migrate@readplace.com and I import it by hand within 24 to 48 hours.",
	},
	{
		question: "Is there a Pocket import?",
		answer:
			"Yes. Upload the HTML export file Pocket produced and every saved URL comes across; tags and read state don't, because Pocket's export never contained them.",
	},
	{
		question: "Can I import links from a newsletter?",
		answer:
			"Paste the URL of the issue and Readplace lists every article it links to. The same works for blogrolls and link roundups.",
	},
];

const IMPORT_DESCRIPTION =
	"Paste a link or upload a bookmark, Pocket, or newsletter export and Readplace lists every URL for your reading queue. No account needed to start.";

export function ImportAcquirePage(vm: ImportAcquireViewModel, options: { cspNonce: CspNonce }): PageBody {
	const panel = PANEL_CONFIG[vm.mode];
	const tabs = vm.tabs.map(renderTab);
	const data = { ...vm, tabs, faq: IMPORT_FAQ, errorMessage: vm.errors?.[0]?.message };
	const tabsHtml = render(IMPORT_TABS_TEMPLATE, data);
	const panelHtml = render(panel.template, data);
	const content = render(IMPORT_ACQUIRE_TEMPLATE, { ...data, tabsHtml, panelHtml });

	return {
		seo: {
			title: "Import Links into Your Reading Queue — Readplace",
			description: IMPORT_DESCRIPTION,
			canonicalUrl: "/import",
			robots: "index, follow",
			keywords:
				"import links, import bookmarks, import links into a reading queue, import bookmarks to a read-it-later app, reading queue import, read-it-later import, bookmarks HTML import, newsletter link extractor, Pocket import, import reading list, bulk save links",
			structuredData: [
				{
					"@context": "https://schema.org",
					"@type": "WebPage",
					"@id": "https://readplace.com/import",
					name: "Import Links into Your Reading Queue",
					url: "https://readplace.com/import",
					description: IMPORT_DESCRIPTION,
					isPartOf: { "@type": "WebSite", name: "Readplace", url: "https://readplace.com" },
					about: { "@id": "https://readplace.com/#app" },
				},
				{
					"@context": "https://schema.org",
					"@type": "FAQPage",
					mainEntity: IMPORT_FAQ.map((item) => ({
						"@type": "Question",
						name: item.question,
						acceptedAnswer: { "@type": "Answer", text: item.answer },
					})),
				},
			],
		},
		styles: IMPORT_STYLES,
		bodyClass: "page-import",
		content: { html: content },
		scripts: panel.scripts(options.cspNonce),
	};
}
