type PublishableEvent = {
	readonly detailType: string;
	readonly detailSchema: { parse: (input: unknown) => unknown };
};

export function initRecordingPublishEvent(): {
	publishEvent: <E extends PublishableEvent>(event: E, detail: unknown) => Promise<void>;
	published: ReadonlyArray<{ detailType: string; detail: unknown }>;
} {
	const published: Array<{ detailType: string; detail: unknown }> = [];
	const publishEvent = async <E extends PublishableEvent>(event: E, detail: unknown): Promise<void> => {
		const validated = event.detailSchema.parse(detail);
		published.push({ detailType: event.detailType, detail: validated });
	};
	return { publishEvent, published };
}
