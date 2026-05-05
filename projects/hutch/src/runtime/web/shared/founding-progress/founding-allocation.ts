export const FOUNDING_MEMBER_LIMIT = 100;

export function isFoundingAllocationExhausted(userCount: number): boolean {
	return userCount >= FOUNDING_MEMBER_LIMIT;
}
