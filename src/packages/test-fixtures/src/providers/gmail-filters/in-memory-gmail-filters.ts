import assert from "node:assert";
import type { GmailFilter, GmailFilters } from "@packages/provider-contracts/gmail-filters";

export function initInMemoryGmailFilters(seed: GmailFilter[] = []) {
	const store = new Map(seed.map((filter) => [filter.id, filter]));
	const deleted: string[] = [];
	const created: { query: string; forwardTo: string }[] = [];
	let nextId = 100;

	const api: GmailFilters = {
		listFilters: async () => ({ ok: true, value: [...store.values()] }),
		createForwardingFilter: async ({ query, forwardTo }) => {
			created.push({ query, forwardTo });
			nextId += 1;
			const filter: GmailFilter = { id: `f-${nextId}`, query, forwardTo };
			store.set(filter.id, filter);
			return { ok: true, value: filter };
		},
		getFilter: async ({ filterId }) => {
			const found = store.get(filterId);
			assert(found, "getFilter must be called with an id Gmail knows");
			return { ok: true, value: found };
		},
		deleteFilter: async ({ filterId }) => {
			deleted.push(filterId);
			store.delete(filterId);
			return { ok: true, value: undefined };
		},
	};

	return { store, deleted, created, api };
}
