export type PublishUpdateFetchTimestamp = (params: {
	url: string;
	contentFetchedAt: string;
	bodyHash?: string;
}) => Promise<void>;
