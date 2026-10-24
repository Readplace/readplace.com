const STORE_HOSTS: ReadonlySet<string> = new Set([
	"www.amazon.ae",
	"www.amazon.ca",
	"www.amazon.co.jp",
	"www.amazon.co.uk",
	"www.amazon.com",
	"www.amazon.com.au",
	"www.amazon.com.be",
	"www.amazon.com.br",
	"www.amazon.com.mx",
	"www.amazon.com.tr",
	"www.amazon.de",
	"www.amazon.eg",
	"www.amazon.es",
	"www.amazon.fr",
	"www.amazon.ie",
	"www.amazon.in",
	"www.amazon.it",
	"www.amazon.nl",
	"www.amazon.pl",
	"www.amazon.sa",
	"www.amazon.se",
	"www.amazon.sg",
]);
const ELIGIBLE_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);
const PRODUCT_PATH = /^(?:(?:\/[^/]+)?\/dp|\/gp\/product)\/([A-Z0-9]{10})$/;

export function toAmazonProductUrl(url: string): string {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return url;
	}
	if (!ELIGIBLE_PROTOCOLS.has(parsed.protocol)) return url;
	if (parsed.username !== "" || parsed.password !== "") return url;
	if (parsed.port !== "") return url;
	if (!STORE_HOSTS.has(parsed.hostname)) return url;
	const asin = PRODUCT_PATH.exec(parsed.pathname)?.[1];
	if (asin === undefined) return url;
	return `https://${parsed.hostname}/dp/${asin}`;
}
