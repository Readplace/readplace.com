export interface ThemeSignature {
	rootColorScheme: string;
	bodyClass: string;
	painted: { name: string; styles: string }[];
}

export function collectThemeSignature(): ThemeSignature {
	const PAINTED_PROPERTIES = [
		"backgroundColor",
		"backgroundImage",
		"color",
		"borderTopColor",
		"borderRightColor",
		"borderBottomColor",
		"borderLeftColor",
		"outlineColor",
		"boxShadow",
		"fill",
		"stroke",
		"colorScheme",
	] as const;
	const PSEUDO_ELEMENTS = [null, "::before", "::after", "::placeholder", "::backdrop"];

	function nameOf(el: Element): string {
		const testAttribute = Array.from(el.attributes).find((attribute) =>
			attribute.name.startsWith("data-test"),
		);
		if (testAttribute) return `${testAttribute.name}="${testAttribute.value}"`;
		const classes = (el.getAttribute("class") ?? "")
			.trim()
			.split(/\s+/)
			.filter((name) => name && !name.startsWith("htmx-"));
		const tag = el.tagName.toLowerCase();
		return classes.length ? `${tag}.${classes.join(".")}` : tag;
	}

	function stylesOf(el: Element, pseudo: string | null): string {
		const style = getComputedStyle(el, pseudo);
		return PAINTED_PROPERTIES.map((property) => `${property}: ${style[property]}`).join("; ");
	}

	const painted: { name: string; styles: string }[] = [];
	for (const el of [document.body, ...Array.from(document.body.querySelectorAll("*"))]) {
		for (const pseudo of PSEUDO_ELEMENTS) {
			painted.push({ name: `${nameOf(el)}${pseudo ?? ""}`, styles: stylesOf(el, pseudo) });
		}
	}

	return {
		rootColorScheme: getComputedStyle(document.documentElement).colorScheme,
		bodyClass: document.body.className,
		painted,
	};
}
