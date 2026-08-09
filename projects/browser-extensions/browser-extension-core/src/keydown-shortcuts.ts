/// <reference lib="dom" />

export interface Shortcut {
	matches: (event: KeyboardEvent) => boolean;
	action?: () => void;
}

export function installShortcuts(
	target: Pick<Document, "addEventListener">,
	shortcuts: Shortcut[],
): void {
	target.addEventListener(
		"keydown",
		(event) => {
			const match = shortcuts.find((shortcut) => shortcut.matches(event));
			if (!match) return;
			event.preventDefault();
			event.stopPropagation();
			match.action?.();
		},
		true,
	);
}
