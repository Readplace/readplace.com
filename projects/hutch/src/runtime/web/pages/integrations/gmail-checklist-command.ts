import { z } from "zod";
import { ForwardableSenderSchema } from "@packages/domain/gmail";
import type { GmailChecklistCommand } from "./gmail-sender-checklist.viewmodel";

const SelectCommandSchema = z.enum(["all", "none"]);
const ListedSchema = z.coerce.number().int().nonnegative();

export function parseGmailChecklistCommand(query: Record<string, unknown>): { command: GmailChecklistCommand; listed: number | undefined } {
	const pick = ForwardableSenderSchema.safeParse(query.pick);
	const select = SelectCommandSchema.safeParse(query.select);
	const dismiss = ForwardableSenderSchema.safeParse(query.dismiss);
	const listed = ListedSchema.safeParse(query.listed);
	return {
		command: {
			pick: pick.success ? pick.data : undefined,
			select: select.success ? select.data : undefined,
			dismiss: dismiss.success ? dismiss.data : undefined,
		},
		listed: listed.success ? listed.data : undefined,
	};
}
