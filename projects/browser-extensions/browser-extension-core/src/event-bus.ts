type EventCallback = (...args: unknown[]) => void;

interface EventBus {
	on: (event: string, handler: EventCallback) => void;
	once: (event: string, handler: EventCallback) => void;
	emit: (event: string, ...args: unknown[]) => void;
}

export function createEventBus(): EventBus {
	const listeners = new Map<string, EventCallback[]>();

	return {
		on(event, handler) {
			const existing = listeners.get(event) ?? [];
			existing.push(handler);
			listeners.set(event, existing);
		},
		once(event, handler) {
			const existing = listeners.get(event) ?? [];
			const wrapper: EventCallback = (...args) => {
				const index = existing.indexOf(wrapper);
				if (index !== -1) {
					existing.splice(index, 1);
				}
				handler(...args);
			};
			existing.push(wrapper);
			listeners.set(event, existing);
		},
		emit(event, ...args) {
			const handlers = [...(listeners.get(event) ?? [])];
			for (const handler of handlers) {
				handler(...args);
			}
		},
	};
}
