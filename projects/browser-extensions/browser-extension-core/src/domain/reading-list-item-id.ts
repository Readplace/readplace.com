import "../zod-config";
import { z } from "zod";

export const ReadingListItemIdSchema = z.string().brand<"ReadingListItemId">();

export type ReadingListItemId = z.infer<typeof ReadingListItemIdSchema>;
