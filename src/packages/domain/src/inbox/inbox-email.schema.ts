import { z } from "zod";

/** The RFC-5322 Message-ID of a received email, or a deterministic hash
 * synthesized from the raw bytes when the sender omits one. Branded so a raw
 * string can't stand in without passing through the parser. Doubles as the
 * idempotency key: the receive path's conditional put is guarded on the sort
 * key that embeds this id, so an at-least-once redelivery never stores twice. */
export const MessageIdSchema = z.string().min(1).brand<"MessageId">();
export type MessageId = z.infer<typeof MessageIdSchema>;

/** The terminal state of a received email. Data-state words (never "pending"
 * /"staging"): every row is already at rest in one of these states.
 *  - `received`  — fully parsed, body sanitized and stored in S3 (happy path).
 *  - `unparsed`  — no renderable body: postal-mime could not decode the raw
 *                  bytes, or it decoded but the sanitizer stripped the body to
 *                  nothing. The immutable `.eml` is kept and the View tab shows a
 *                  "couldn't render" state. No body pointer.
 *  - `rejected`  — oversize (over the byte cap) or an unknown/disabled
 *                  recipient; recorded as an audit row. No body pointer. */
export const InboxEmailStatusSchema = z.enum(["received", "unparsed", "rejected"]);
export type InboxEmailStatus = z.infer<typeof InboxEmailStatusSchema>;
