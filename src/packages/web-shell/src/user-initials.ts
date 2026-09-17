import assert from "node:assert";

const LOCAL_PART_SEPARATORS = /[._+-]+/;

export function initialsFromEmail(email: string): string {
	const atIndex = email.indexOf("@");
	assert(atIndex > 0, "an account email always carries a local part before its @");
	const localPart = email.slice(0, atIndex);
	const segments = localPart.split(LOCAL_PART_SEPARATORS).filter((segment) => segment.length > 0);
	const initials =
		segments.length >= 2 ? `${segments[0].charAt(0)}${segments[1].charAt(0)}` : localPart.slice(0, 2);
	return initials.toUpperCase();
}
