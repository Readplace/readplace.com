import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PageBody } from "../../page-body.types";
import { render } from "../../render";
import { switchHelpers } from "../../handlebars-switch";
import { INSTALL_PAGE_STYLES } from "./install.styles";
import { firefoxS3Config } from "browser-extension-core/s3-config";

const INSTALL_TEMPLATE = readFileSync(join(__dirname, "install.template.html"), "utf-8");
const FIREFOX_LATEST_POINTER_URL = firefoxS3Config.getLatestPointerUrl("prod");
const CHROME_WEB_STORE_URL = "https://chromewebstore.google.com/detail/hutch/klblengmhlfnmjoagchagfcdbpbocgbf";

async function fetchDownloadUrl(latestPointerUrl: string, buildDownloadUrl: (filename: string) => string): Promise<string | null> {
	const response = await fetch(latestPointerUrl);
	if (!response.ok) return null;
	const filename = (await response.text()).trim();
	if (!filename) return null;
	return buildDownloadUrl(filename);
}

export async function fetchFirefoxDownloadUrl(): Promise<string | null> {
	return fetchDownloadUrl(FIREFOX_LATEST_POINTER_URL, (filename) =>
		firefoxS3Config.getExtensionDownloadUrl({ stage: "prod", filename }),
	);
}

export async function fetchChromeDownloadUrl(): Promise<string | null> {
	return CHROME_WEB_STORE_URL;
}

export function InstallPage(params: { firefox: string | null; chrome: string | null; browser: "firefox" | "chrome" }): PageBody {
	return {
		seo: {
			title: "Install Readplace Browser Extension",
			description:
				"Where reading still matters. Download the Readplace browser extension for Firefox or Chrome and save articles with one click.",
			canonicalUrl: "https://readplace.com/install",
			structuredData: [
				{
					"@context": "https://schema.org",
					"@type": "SoftwareApplication",
					name: "Readplace Browser Extension",
					description:
						"Save any article to your Readplace reading list with one click from Firefox or Chrome.",
					applicationCategory: "BrowserApplication",
					operatingSystem: "Windows, macOS, Linux, ChromeOS",
					url: "https://readplace.com/install",
					downloadUrl: "https://readplace.com/install",
					offers: {
						"@type": "Offer",
						price: "0",
						priceCurrency: "USD",
					},
					publisher: {
						"@type": "Organization",
						name: "Readplace",
						url: "https://readplace.com",
					},
				},
				{
					"@context": "https://schema.org",
					"@type": "BreadcrumbList",
					itemListElement: [
						{
							"@type": "ListItem",
							position: 1,
							name: "Home",
							item: "https://readplace.com/",
						},
						{
							"@type": "ListItem",
							position: 2,
							name: "Install",
							item: "https://readplace.com/install",
						},
					],
				},
			],
		},
		styles: INSTALL_PAGE_STYLES,
		bodyClass: "page-install",
		content: render(INSTALL_TEMPLATE, {
			browser: params.browser,
			firefoxDownloadUrl: params.firefox,
			chromeDownloadUrl: params.chrome,
		}, { helpers: switchHelpers }),
	};
}
