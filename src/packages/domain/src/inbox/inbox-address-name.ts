import { isCappedAddress, isLiveAddress } from "./inbox-address.live";
import { type AliasName, normalizeAliasName } from "./inbox-address.schema";
import type { InboxAddressEntry } from "./inbox-address.types";

export type AliasNameDecision =
	| { ok: true; name: AliasName }
	| { ok: false; reason: "invalid-name" }
	| { ok: false; reason: "name-taken"; name: AliasName };

export function decideAliasName(params: {
	requested: string;
	owned: readonly InboxAddressEntry[];
}): AliasNameDecision {
	const name = normalizeAliasName(params.requested);
	if (name === undefined) return { ok: false, reason: "invalid-name" };
	const taken = params.owned.some(
		(entry) => isCappedAddress(entry) && isLiveAddress(entry) && entry.name === name,
	);
	return taken ? { ok: false, reason: "name-taken", name } : { ok: true, name };
}
