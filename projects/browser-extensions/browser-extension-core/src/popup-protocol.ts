import "./zod-config";
import { z } from "zod";
import type { GuardedResult } from "./auth/auth.types";
import type { LoginReply } from "./core";
import { ReadingListItemIdSchema } from "./domain/reading-list-item-id";
import type { CollectionPage, InvokeActionResult, LoadPageResult, SaveUrlResult } from "./reading-list/reading-list.types";

export const PopupMessageSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("save-current-tab"), url: z.string(), title: z.string(), tabId: z.number().int().optional() }),
	z.object({ type: z.literal("invoke-action"), id: ReadingListItemIdSchema, name: z.string() }),
	z.object({ type: z.literal("get-all-items") }),
	z.object({ type: z.literal("load-page"), index: z.number().int() }),
	z.object({ type: z.literal("load-sort"), index: z.number().int() }),
	z.object({ type: z.literal("login") }),
	z.object({ type: z.literal("login-prompt-shown") }),
	z.object({ type: z.literal("logout") }),
]);
export type PopupMessage = z.infer<typeof PopupMessageSchema>;

export type PopupReplies = {
	"save-current-tab": GuardedResult<SaveUrlResult>;
	"invoke-action": GuardedResult<InvokeActionResult>;
	"get-all-items": GuardedResult<CollectionPage>;
	"load-page": GuardedResult<LoadPageResult>;
	"load-sort": GuardedResult<LoadPageResult>;
	login: LoginReply;
	"login-prompt-shown": { ok: boolean };
	logout: { ok: true };
};
export type PopupReply = PopupReplies[keyof PopupReplies];
export type PopupReplyFor<M extends PopupMessage> = PopupReplies[M["type"]];
