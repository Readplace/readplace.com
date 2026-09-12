import assert from "node:assert";
import { addressParser } from "postal-mime";
import { parseForwardableSender } from "./build-forwarding-filter-query";
import type { ForwardableSender } from "./build-forwarding-filter-query";

export function parseGmailFrom(header: string): { email: ForwardableSender; name: string | undefined }[] {
	return addressParser(header, { flatten: true }).flatMap((sender) => {
		assert(sender.address !== undefined, "flattened address entries must be mailboxes");
		const email = parseForwardableSender(sender.address);
		if (email === undefined) return [];
		const name = sender.name.trim();
		return [{ email, name: name === "" ? undefined : name }];
	});
}
