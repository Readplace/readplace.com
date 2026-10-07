import { createHash } from "node:crypto";
import type { UserId } from "../user";

/**
 * Rehosted email images are keyed under an opaque hash prefix. The hash is
 * one-way (image URL → body key requires a preimage) yet recomputable from the
 * `inbox_emails` row keys, so account deletion and backfill can re-derive the
 * prefix without storing it.
 */
export function emailImageS3KeyPrefix(input: {
	userId: UserId;
	receivedAtMessageId: string;
}): string {
	// Both segments are percent-encoded so the newline delimiter can never
	// appear inside either input: two distinct (userId, receivedAtMessageId)
	// pairs can't collide by shifting characters across the boundary.
	const hash = createHash("sha256")
		.update(
			`${encodeURIComponent(input.userId)}\n${encodeURIComponent(input.receivedAtMessageId)}`,
		)
		.digest("hex")
		.slice(0, 32);
	return `content/email-images/${hash}`;
}

export function emailImageCdnUrl(input: {
	baseUrl: string;
	userId: UserId;
	receivedAtMessageId: string;
	filename: string;
}): string {
	const prefix = emailImageS3KeyPrefix({
		userId: input.userId,
		receivedAtMessageId: input.receivedAtMessageId,
	});
	return `${input.baseUrl}/${prefix}/${input.filename}`;
}
