import type { UserId } from "@packages/domain/user";

/** Anonymous sessions (no owner) are reachable by capability — anyone holding the
 * unguessable id, including a just-signed-up user adopting their pre-auth review.
 * An owned session stays isolated to its owner; an anonymous caller, or a different
 * user, is denied. The DynamoDB {@link ownershipCondition} enforces the same rule at
 * the write-condition layer. */
export function isAccessibleBy({
	ownerId,
	callerId,
}: {
	ownerId: UserId | undefined;
	callerId: UserId | undefined;
}): boolean {
	return ownerId === undefined || ownerId === callerId;
}

/** DynamoDB ConditionExpression form of {@link isAccessibleBy} for guarded writes.
 * The `:uid` value is bound separately, only when authenticated, so DynamoDB never
 * sees an empty ExpressionAttributeValues map for the anonymous case. */
export function ownershipCondition(callerId: UserId | undefined): string {
	return callerId === undefined
		? "attribute_not_exists(userId)"
		: "attribute_not_exists(userId) OR userId = :uid";
}
