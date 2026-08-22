/**
 * The one home for the product's UI icons (Lucide geometry), shared by the web
 * shell, the server-rendered sites, and the browser extension popup. Zero
 * dependencies so a browser bundle can take it without a server render stack.
 *
 * Brand and product logos are deliberately absent — they keep their own
 * geometry and colour (`brandMarkSvg`, `client-icons`).
 */

const OPEN = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">`;

const PATHS = {
	"arrow-down": `<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>`,
	"arrow-left": `<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>`,
	"arrow-right": `<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>`,
	"arrow-up": `<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>`,
	check: `<path d="M20 6 9 17l-5-5"/>`,
	"check-circle": `<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>`,
	"chevron-down": `<path d="m6 9 6 6 6-6"/>`,
	download: `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>`,
	"file-input": `<path d="M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M2 15h10"/><path d="m9 18 3-3-3-3"/>`,
	inbox: `<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>`,
	"log-in": `<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>`,
	"log-out": `<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>`,
	mail: `<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>`,
	pencil: `<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>`,
	plus: `<path d="M5 12h14"/><path d="M12 5v14"/>`,
	sparkles: `<path d="m12 3 1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>`,
	upload: `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>`,
	user: `<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>`,
	x: `<path d="M18 6 6 18"/><path d="m6 6 12 12"/>`,
} as const;

export type IconName = keyof typeof PATHS;

const SVG_BY_NAME: ReadonlyMap<string, string> = new Map(
	Object.entries(PATHS).map(([name, path]) => [name, `${OPEN}${path}</svg>`]),
);

export function iconSvg(name: IconName): string {
	return `${OPEN}${PATHS[name]}</svg>`;
}

/** For callers whose name arrives from outside the type system — a template
 * helper reading its own source — so a typo can fail rather than draw nothing. */
export function findIconSvg(name: string): string | undefined {
	return SVG_BY_NAME.get(name);
}
