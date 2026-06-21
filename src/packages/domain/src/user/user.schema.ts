import { z } from "zod";

export const UserIdSchema = z.string().brand<"UserId">();
export type UserId = z.infer<typeof UserIdSchema>;
