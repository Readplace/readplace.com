import { z } from "zod";

/** A full forwarding address, `<alias>-<token>@<domain>`. Branded so a raw
 * string can't stand in for one without passing through the parser. The trailing
 * `-<token>` is the six-char random suffix by construction, so an address is a
 * strict generalization of the legacy `in-<token>` form (alias = `in`). */
export const InboxAddressSchema = z
	.string()
	.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-z]{6}@[a-z0-9.-]+$/)
	.brand<"InboxAddress">();

export type InboxAddress = z.infer<typeof InboxAddressSchema>;
