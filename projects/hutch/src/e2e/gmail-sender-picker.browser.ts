export function markSenderSearchTriggers(): void {
	document.addEventListener("htmx:trigger", (event) => {
		if (event.target instanceof Element && event.target.id === "gmail-sender-search-form") {
			event.target.setAttribute("data-test-gmail-search-triggered", "");
		}
	});
}

export function notificationControlStyles() {
	const probe = document.createElement("span");
	probe.style.color = "var(--color-brand)";
	document.body.append(probe);
	const brand = getComputedStyle(probe).color;
	probe.remove();
	const controls = [...document.querySelectorAll(".gmail__readlist-picker > summary, .gmail__save > button")].map((element) => {
		const styles = getComputedStyle(element);
		const bounds = element.getBoundingClientRect();
		return { border: styles.borderColor, shadow: styles.boxShadow, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
	});
	return { brand, controls };
}
