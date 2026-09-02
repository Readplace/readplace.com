const NON_ARTICLE_HOSTS: ReadonlySet<string> = new Set([
	"mail.google.com",
	"outlook.live.com",
	"outlook.office.com",
	"outlook.office365.com",
	"mail.yahoo.com",
	"mail.proton.me",
	"app.fastmail.com",
	"mail.zoho.com",
	"mail.aol.com",
	"mail.yandex.com",
	"mail.gmx.com",
	"mail.gmx.net",
	"app.hey.com",
	"mail.superhuman.com",
	"app.tuta.com",
	"mail.qq.com",
	"mail.163.com",
]);

export function isNonArticleHost(url: string): boolean {
	let hostname: string;
	try {
		hostname = new URL(url).hostname;
	} catch {
		return false;
	}
	let candidate = hostname.toLowerCase().replace(/\.$/, "");
	while (candidate.includes(".")) {
		if (NON_ARTICLE_HOSTS.has(candidate)) return true;
		candidate = candidate.slice(candidate.indexOf(".") + 1);
	}
	return false;
}
