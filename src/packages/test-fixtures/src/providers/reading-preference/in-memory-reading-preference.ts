import type { UserId } from "@packages/domain/user";
import type {
	DeleteReadingPreference,
	GetReadingPreference,
	SaveReadingPreference,
} from "@packages/provider-contracts/reading-preference";

export function initInMemoryReadingPreference(): {
	saveReadingPreference: SaveReadingPreference;
	getReadingPreference: GetReadingPreference;
	deleteReadingPreference: DeleteReadingPreference;
} {
	const preferences = new Map<UserId, { text: string }>();

	const saveReadingPreference: SaveReadingPreference = async ({ userId, text }) => {
		preferences.set(userId, { text });
	};

	const getReadingPreference: GetReadingPreference = async ({ userId }) =>
		preferences.get(userId);

	const deleteReadingPreference: DeleteReadingPreference = async ({ userId }) => {
		preferences.delete(userId);
	};

	return { saveReadingPreference, getReadingPreference, deleteReadingPreference };
}
