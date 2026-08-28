import type { AliasName } from "../inbox/inbox-address.schema";
import { AliasNameSchema, normalizeAliasName } from "../inbox/inbox-address.schema";
import type { ForwardableSender } from "./build-forwarding-filter-query";

const UNNAMEABLE_SENDER_ALIAS: AliasName = AliasNameSchema.parse("newsletter");

export function aliasNameForSender(sender: ForwardableSender): AliasName {
	const domain = sender.slice(sender.indexOf("@") + 1);
	const labels = domain.split(".");
	return normalizeAliasName(labels[labels.length - 2]) ?? UNNAMEABLE_SENDER_ALIAS;
}
