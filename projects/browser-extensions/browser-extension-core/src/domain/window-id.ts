import "../zod-config";
import { z } from "zod";

export const WindowIdSchema = z.number().int().brand<"WindowId">();

export type WindowId = z.infer<typeof WindowIdSchema>;
