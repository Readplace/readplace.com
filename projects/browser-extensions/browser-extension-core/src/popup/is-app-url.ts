const LOCALHOST_HOSTS = new Set(["127.0.0.1", "localhost"]);

export function isAppUrl(params: { tabUrl: string; appDomains: readonly string[] }): boolean {
	try {
		const hostname = new URL(params.tabUrl).hostname;
		if (LOCALHOST_HOSTS.has(hostname)) return true;
		return params.appDomains.includes(hostname);
	} catch {
		return false;
	}
}
