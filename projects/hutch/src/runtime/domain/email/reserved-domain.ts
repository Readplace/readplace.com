const RESERVED_DOMAINS: ReadonlySet<string> = new Set([
	"example.com",
	"example.net",
	"example.org",
]);

const RESERVED_TLDS: ReadonlySet<string> = new Set([
	"test",
	"example",
	"invalid",
	"localhost",
]);

export function reservedDomainOf(address: string): string | undefined {
	const domain = address.slice(address.lastIndexOf("@") + 1).toLowerCase();
	const tld = domain.slice(domain.lastIndexOf(".") + 1);
	if (RESERVED_DOMAINS.has(domain) || RESERVED_TLDS.has(tld)) return domain;
	return undefined;
}
