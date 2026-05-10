export type PublishStaleCheckRequested = (params: {
	url: string;
}) => Promise<void>;
