import { DEFAULT_READLIST_SLUG, type ReadlistSlug } from "./readlist-name.schema";

export function readlistAfterDelete(input: { viewed: ReadlistSlug; deleted: ReadlistSlug }): ReadlistSlug {
	return input.viewed === input.deleted ? DEFAULT_READLIST_SLUG : input.viewed;
}
