import assert from "node:assert";

const LOCAL_PART_SEPARATORS = /[._+-]+/;

const NAME_SEPARATORS = /\s+/;

function initialsFromEmail(email: string): string {
	const atIndex = email.indexOf("@");
	assert(atIndex > 0, "an account email always carries a local part before its @");
	const localPart = email.slice(0, atIndex);
	const segments = localPart.split(LOCAL_PART_SEPARATORS).filter((segment) => segment.length > 0);
	const initials =
		segments.length >= 2 ? `${segments[0].charAt(0)}${segments[1].charAt(0)}` : localPart.slice(0, 2);
	return initials.toUpperCase();
}

function initialsFromName(displayName: string): string {
	const words = displayName.split(NAME_SEPARATORS).filter((word) => word.length > 0).map((word) => Array.from(word));
	assert(words.length > 0, "a display name always carries a word");
	const first = words[0];
	const last = words[words.length - 1];
	const initials = words.length >= 2 ? `${first[0]}${last[0]}` : first.slice(0, 2).join("");
	return initials.toUpperCase();
}

export function initialsFor(account: { email: string; displayName: string | undefined }): string {
	return account.displayName === undefined ? initialsFromEmail(account.email) : initialsFromName(account.displayName);
}
