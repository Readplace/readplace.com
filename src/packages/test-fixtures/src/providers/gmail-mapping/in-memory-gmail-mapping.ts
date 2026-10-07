import type { ForwardableSender, GmailAccountEmail, GmailMapping, GmailMappingStore } from "@packages/domain/gmail";
import type { UserId } from "@packages/domain/user";

interface MappingRow {
	userId: UserId;
	mapping: GmailMapping;
}

function rowKey(input: { userId: UserId; accountEmail: GmailAccountEmail; senderEmail: ForwardableSender }) {
	return `${input.userId}\u0000${input.accountEmail}\u0000${input.senderEmail}`;
}

export function initInMemoryGmailMapping(deps: { now: () => Date }): GmailMappingStore {
	const rows = new Map<string, MappingRow>();

	const upsert = (
		input: { userId: UserId; accountEmail: GmailAccountEmail; senderEmail: ForwardableSender },
		patch: (existing: GmailMapping) => GmailMapping,
	) => {
		const key = rowKey(input);
		const existing: GmailMapping = rows.get(key)?.mapping ?? {
			accountEmail: input.accountEmail,
			senderEmail: input.senderEmail,
			addedToFilterAt: undefined,
			mappedAddresses: undefined,
			mappedAt: undefined,
			deliveryMode: undefined,
		};
		rows.set(key, { userId: input.userId, mapping: patch(existing) });
	};

	const listWhere = (matches: (row: MappingRow) => boolean) =>
		[...rows.values()]
			.filter(matches)
			.map((row) => row.mapping)
			.sort((left, right) => `${left.accountEmail}#${left.senderEmail}`.localeCompare(`${right.accountEmail}#${right.senderEmail}`));

	return {
		addSenderToFilter: async (input) => {
			upsert(input, (existing) => ({
				...existing,
				addedToFilterAt: existing.addedToFilterAt ?? deps.now().toISOString(),
			}));
		},
		mapSenderToAddress: async ({ mappedAddresses, deliveryMode, ...input }) => {
			upsert(input, (existing) => ({
				...existing,
				mappedAddresses,
				mappedAt: deps.now().toISOString(),
				deliveryMode,
			}));
		},
		findMapping: async (input) => rows.get(rowKey(input))?.mapping,
		listMappings: async ({ userId, accountEmail }) =>
			listWhere((row) => row.userId === userId && row.mapping.accountEmail === accountEmail),
		listMappingsByUserId: async (userId) => listWhere((row) => row.userId === userId),
		removeMapping: async (input) => {
			rows.delete(rowKey(input));
		},
		deleteAllByUserId: async (userId) => {
			for (const [key, row] of rows) {
				if (row.userId === userId) rows.delete(key);
			}
		},
	};
}
