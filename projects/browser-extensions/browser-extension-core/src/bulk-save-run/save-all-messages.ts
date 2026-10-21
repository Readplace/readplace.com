import "../zod-config";
import { z } from "zod";
import { WindowIdSchema } from "../domain/window-id";
import { BulkSaveRunIdSchema, BulkSaveRunSchema, ClientSkipSchema } from "./bulk-save-run";

const SaveableTabSchema = z.object({ url: z.string(), title: z.string(), tabId: z.number().int().optional() });

const SaveAllStartSchema = z.object({
	type: z.literal("save-all-tabs"),
	runId: BulkSaveRunIdSchema,
	windowId: WindowIdSchema,
	tabs: z.array(SaveableTabSchema),
	skipped: z.array(ClientSkipSchema),
});

export type SaveAllStart = z.infer<typeof SaveAllStartSchema>;

const FollowSaveAllSchema = z.object({ type: z.literal("follow-save-all"), runId: BulkSaveRunIdSchema });

const AcknowledgeSaveAllSchema = z.object({ type: z.literal("acknowledge-save-all"), runId: BulkSaveRunIdSchema });

export const SaveAllMessageSchema = z.discriminatedUnion("type", [
	SaveAllStartSchema,
	FollowSaveAllSchema,
	AcknowledgeSaveAllSchema,
]);

export type SaveAllMessage = z.infer<typeof SaveAllMessageSchema>;

const ErrorReplySchema = z.object({ ok: z.literal(false), reason: z.literal("error") });

export const SaveAllStartReplySchema = z.union([
	z.object({ ok: z.literal(true), run: BulkSaveRunSchema }),
	z.object({ ok: z.literal(false), reason: z.enum(["not-logged-in", "error"]) }),
]);

export type SaveAllStartReply = z.infer<typeof SaveAllStartReplySchema>;

export const FollowSaveAllReplySchema = z.union([
	z.object({ ok: z.literal(true), run: BulkSaveRunSchema.nullable() }),
	ErrorReplySchema,
]);

export type FollowSaveAllReply = z.infer<typeof FollowSaveAllReplySchema>;

export const AcknowledgeSaveAllReplySchema = z.union([z.object({ ok: z.literal(true) }), ErrorReplySchema]);

export type AcknowledgeSaveAllReply = z.infer<typeof AcknowledgeSaveAllReplySchema>;

export type SaveAllReply = SaveAllStartReply | FollowSaveAllReply | AcknowledgeSaveAllReply;
