type ManifestIcon = {
	src: string;
	sizes: string;
	type: string;
	purpose: "any" | "maskable";
};

const ICON_FILES: { file: string; sizes: string; purpose: "any" | "maskable" }[] = [
	{ file: "android-chrome-48x48.png", sizes: "48x48", purpose: "any" },
	{ file: "android-chrome-72x72.png", sizes: "72x72", purpose: "any" },
	{ file: "android-chrome-96x96.png", sizes: "96x96", purpose: "any" },
	{ file: "android-chrome-144x144.png", sizes: "144x144", purpose: "any" },
	{ file: "android-chrome-192x192.png", sizes: "192x192", purpose: "any" },
	{ file: "android-chrome-512x512.png", sizes: "512x512", purpose: "any" },
	{ file: "android-chrome-maskable-192x192.png", sizes: "192x192", purpose: "maskable" },
	{ file: "android-chrome-maskable-512x512.png", sizes: "512x512", purpose: "maskable" },
];

export function buildSiteWebmanifest(staticBaseUrl: string): string {
	const icons: ManifestIcon[] = ICON_FILES.map(({ file, sizes, purpose }) => ({
		src: `${staticBaseUrl}/${file}`,
		sizes,
		type: "image/png",
		purpose,
	}));

	return JSON.stringify(
		{
			name: "Readplace",
			short_name: "Readplace",
			description: "A warm, dependable place for your reading list.",
			start_url: "/",
			display: "standalone",
			background_color: "#2B3A55",
			theme_color: "#2B3A55",
			icons,
		},
		null,
		2,
	);
}
