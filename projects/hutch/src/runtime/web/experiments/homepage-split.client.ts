/**
 * Client-side entry for the homepage A/B split. Runs only on `/` in a browser
 * (guests; authed users and every non-HTML client are 303'd server-side before
 * the script ever loads). It reads the visitor's stored assignment from
 * localStorage, assigns one 50/50 on first visit, then `location.replace`s to
 * that arm's landing page — keeping `/` itself byte-for-byte unchanged as the
 * Siren/markdown/crawler entry point.
 *
 * DI'd (config + browser globals injected by the bundle footer) so every branch
 * — inactive experiment, wrong path, fresh assignment, stored reuse, stale
 * epoch, and private-mode storage throws — is unit-testable.
 */
import {
	assignVariant,
	buildLandingUrl,
	formatStoredVariant,
	type HomepageSplitConfig,
	type HomepageSplitVariant,
	parseStoredVariant,
} from "./homepage-split";

export { HOMEPAGE_SPLIT } from "./homepage-split";

interface HomepageSplitLocation {
	pathname: string;
	replace(url: string): void;
}

interface HomepageSplitStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

interface HomepageSplitDeps {
	config: HomepageSplitConfig;
	location: HomepageSplitLocation;
	storage: HomepageSplitStorage;
	randomByte: () => number;
}

/** localStorage access throws in some private-mode configurations; a read
 * failure is treated as "not yet assigned" so the visitor still gets bucketed. */
function readStored(storage: HomepageSplitStorage, key: string): string | null {
	try {
		return storage.getItem(key);
	} catch {
		return null;
	}
}

/** A write failure is swallowed: the visitor still gets redirected this visit,
 * they just won't persist across visits (re-bucketed next time). */
function writeStored(storage: HomepageSplitStorage, key: string, value: string): void {
	try {
		storage.setItem(key, value);
	} catch {
		/* private-mode quota/security error — swallow */
	}
}

export function initHomepageSplit(deps: HomepageSplitDeps): void {
	const { config, location, storage, randomByte } = deps;
	if (!config.active) return;
	if (location.pathname !== "/") return;

	const stored = parseStoredVariant(config, readStored(storage, config.storageKey));
	let variant: HomepageSplitVariant;
	if (stored) {
		variant = stored;
	} else {
		variant = assignVariant(config, randomByte());
		writeStored(storage, config.storageKey, formatStoredVariant(config, variant));
	}

	location.replace(buildLandingUrl(config, variant));
}
