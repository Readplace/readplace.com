import type { PutGmailImportRaw } from "@packages/provider-contracts/gmail-history";

export function initInMemoryRawEmailBucket() {
	const objects = new Map<string, Buffer>();

	const put: PutGmailImportRaw = async ({ key, raw }) => {
		objects.set(key, raw);
	};

	return {
		put,
		read: async (key: string): Promise<Buffer | undefined> => objects.get(key),
		keys: () => [...objects.keys()],
	};
}
