import { z } from "zod";
import { ForwardableSenderSchema } from "@packages/domain/gmail";
import { type GmailPickerState, GmailPickerStateSchema } from "./gmail.url";

const IntentStateSchema: z.ZodType<GmailPickerState> = GmailPickerStateSchema;

export const ConnectIntentSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("connect") }),
	z.object({ kind: z.literal("import"), sender: ForwardableSenderSchema, state: IntentStateSchema }),
	z.object({ kind: z.literal("mark"), senders: z.array(ForwardableSenderSchema).min(1).readonly(), state: IntentStateSchema }),
]);
export type ConnectIntent = z.infer<typeof ConnectIntentSchema>;

export const StatePayloadSchema = z.object({ nonce: z.string(), createdAt: z.number(), intent: ConnectIntentSchema });
export type StatePayload = z.infer<typeof StatePayloadSchema>;

export const ImportIntentBodySchema = z.object({ intent: z.literal("import"), sender: ForwardableSenderSchema });
export const MarkIntentBodySchema = z.object({ intent: z.literal("mark"), sender: ForwardableSenderSchema });
