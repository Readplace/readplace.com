import { getDomain } from "tldts";

export function siteOfHost(hostname: string): string {
	const host = hostname.toLowerCase().replace(/\.$/, "");
	return getDomain(host, { allowPrivateDomains: true }) ?? host;
}
