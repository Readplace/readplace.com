import { z } from "zod";
import type { EmailLinkOrdinal, InboxReadlistOutcome } from "../inbox/inbox-email-link.schema";
import type { UserId } from "../user/user.types";
import type { ReadlistSlug } from "./readlist-name.schema";

export const READLIST_FIT_OVERRIDES_KEPT = 20;

export const ReadlistFitOverrideIdSchema = z
	.string()
	.regex(/^\d{16}-.+-\d{4}$/)
	.brand<"ReadlistFitOverrideId">();
export type ReadlistFitOverrideId = z.infer<typeof ReadlistFitOverrideIdSchema>;

export function readlistFitOverrideId(params: {
	createdAt: Date;
	receivedAtMessageId: string;
	ordinal: EmailLinkOrdinal;
}): ReadlistFitOverrideId {
	const invertedMs = Number.MAX_SAFE_INTEGER - params.createdAt.getTime();
	return ReadlistFitOverrideIdSchema.parse(
		`${String(invertedMs).padStart(16, "0")}-${params.receivedAtMessageId}-${params.ordinal}`,
	);
}

export type ReadlistFitEngineVerdict = InboxReadlistOutcome["fit"][number]["verdict"];
export type ReadlistFitReaderVerdict = "keep" | "drop";

export function readlistFitOverrideHost(url: string): string {
	return new URL(url).hostname.replace(/^www\./i, "");
}

export function readlistFitChoiceLabel(params: {
	readerVerdict: ReadlistFitReaderVerdict;
	label: string;
}): string {
	return params.readerVerdict === "keep" ? `Kept in ${params.label}` : `Not in ${params.label}`;
}

export type ReadlistFitOverriddenLogLine = {
	level: "INFO";
	event: "readlist-fit-overridden";
	userId: UserId;
	readlist: ReadlistSlug;
	receivedAtMessageId: string;
	ordinal: EmailLinkOrdinal;
	engineVerdict?: ReadlistFitEngineVerdict;
	readerVerdict: ReadlistFitReaderVerdict | "undo";
};
