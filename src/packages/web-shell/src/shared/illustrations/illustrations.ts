const BOOK_LIGHTBULB_ILLUSTRATION = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 96" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
	<circle cx="60" cy="26" r="18" stroke="none" fill="var(--color-highlight)" fill-opacity="0.35"/>
	<circle cx="60" cy="26" r="12"/>
	<path d="M54 32 60 18 66 32"/>
	<path d="M54 38h12"/>
	<path d="M55 41h10"/>
	<path d="M56 44h8"/>
	<path d="M56 46h8v3a4 4 0 0 1-8 0z"/>
	<path d="M60 60C48 52 30 51 16 57V83C30 77 48 78 60 86C72 78 90 77 104 83V57C90 51 72 52 60 60Z" stroke="var(--color-brand)"/>
	<path d="M60 60V86"/>
	<path d="M26 64h20"/>
	<path d="M26 70h22"/>
	<path d="M26 76h18"/>
	<path d="M74 64h20"/>
	<path d="M72 70h22"/>
	<path d="M76 76h18"/>
</svg>`;

const TRASH_CAN_ILLUSTRATION = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 80" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
	<path d="M26 14v-4a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v4" stroke="var(--color-brand)"/>
	<path d="M8 14h56" stroke="var(--color-brand)"/>
	<path d="M14 14l4 58a4 4 0 0 0 4 4h20a4 4 0 0 0 4-4l4-58"/>
	<path d="M28 24v46"/>
	<path d="M36 24v48"/>
	<path d="M44 24v46"/>
</svg>`;

const ILLUSTRATIONS = {
	"book-lightbulb": BOOK_LIGHTBULB_ILLUSTRATION,
	"trash-can": TRASH_CAN_ILLUSTRATION,
} as const;

export type IllustrationName = keyof typeof ILLUSTRATIONS;

export function renderIllustration(name: IllustrationName): string {
	return ILLUSTRATIONS[name];
}
