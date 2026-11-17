export function stampNode(
	node: Element,
	stamp: { name: string; value: string },
): void {
	node.setAttribute(stamp.name, stamp.value);
}

export function recordFirstSettledBannerClass(target: {
	firstOfferedBanner: string;
	settledAttribute: string;
}): void {
	document.body.addEventListener("htmx:afterSettle", () => {
		document.querySelectorAll(target.firstOfferedBanner).forEach((banner) => {
			document.body.setAttribute(target.settledAttribute, banner.className);
		});
	});
}
