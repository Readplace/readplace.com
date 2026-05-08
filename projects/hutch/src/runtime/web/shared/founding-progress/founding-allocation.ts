export const FOUNDING_MEMBER_LIMIT = 50;

export function isFoundingAllocationExhausted(userCount: number): boolean {
	return userCount >= FOUNDING_MEMBER_LIMIT;
}
