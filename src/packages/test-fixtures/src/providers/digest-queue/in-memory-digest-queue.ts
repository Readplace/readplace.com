import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { UserId } from "@packages/domain/user";
import type {
	DeleteDigestItem,
	DigestQueueItem,
	EnqueueDigestItem,
	ListDigestItemsByUser,
	ScanPendingDigestUsers,
} from "@packages/provider-contracts/digest-queue";

export function initInMemoryDigestQueue(): {
	enqueueDigestItem: EnqueueDigestItem;
	listDigestItemsByUser: ListDigestItemsByUser;
	deleteDigestItem: DeleteDigestItem;
	scanPendingDigestUsers: ScanPendingDigestUsers;
} {
	const rows = new Map<string, DigestQueueItem>();
	const keyOf = (userId: UserId, url: string) => `${userId}::${url}`;

	const enqueueDigestItem: EnqueueDigestItem = async ({ userId, url, enqueuedAt }) => {
		const canonical = ArticleResourceUniqueId.parse(url).value;
		rows.set(keyOf(userId, canonical), { userId, url: canonical, originalUrl: url, enqueuedAt });
	};

	const listDigestItemsByUser: ListDigestItemsByUser = async (userId) =>
		[...rows.values()].filter((row) => row.userId === userId);

	const deleteDigestItem: DeleteDigestItem = async ({ userId, url }) => {
		rows.delete(keyOf(userId, url));
	};

	const scanPendingDigestUsers: ScanPendingDigestUsers = async () => [
		...new Set([...rows.values()].map((row) => row.userId)),
	];

	return { enqueueDigestItem, listDigestItemsByUser, deleteDigestItem, scanPendingDigestUsers };
}
