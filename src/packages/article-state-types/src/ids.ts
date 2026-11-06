import { z } from "zod";

export const UserIdSchema = z.string().brand<"UserId">();
export type UserId = z.infer<typeof UserIdSchema>;

export const SaveAttemptIdSchema = z.string().min(1).brand<"SaveAttemptId">();
export type SaveAttemptId = z.infer<typeof SaveAttemptIdSchema>;

export const CandidateIdSchema = z.string().min(1).brand<"CandidateId">();
export type CandidateId = z.infer<typeof CandidateIdSchema>;
