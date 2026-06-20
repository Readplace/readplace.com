import { readFileSync } from "node:fs";
import { join } from "node:path";

export const DISPOSABLE_EMAIL_MESSAGE =
	"This is a disposable email address. I value your privacy but to avoid abuse I need a real person to register.";

const DOMAIN_LIST_FILES = [
	"disposable-email-domains.txt",
	"disposable-email-domains.custom.txt",
];

function loadDisposableDomains(): Set<string> {
	const domains = new Set<string>();
	for (const fileName of DOMAIN_LIST_FILES) {
		const raw = readFileSync(join(__dirname, fileName), "utf-8");
		for (const line of raw.split("\n")) {
			const trimmed = line.trim();
			if (trimmed && !trimmed.startsWith("#")) {
				domains.add(trimmed.toLowerCase());
			}
		}
	}
	return domains;
}

const disposableDomains = loadDisposableDomains();

export function isDisposableEmailDomain(email: string): boolean {
	let domain = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
	for (;;) {
		if (disposableDomains.has(domain)) {
			return true;
		}
		const dotIndex = domain.indexOf(".");
		if (dotIndex === -1) {
			return false;
		}
		domain = domain.slice(dotIndex + 1);
	}
}
