const popupPaintObserver = new PerformanceObserver((entries) => {
	if (!entries.getEntries().some(entry => entry.name === "first-paint")) return;
	popupPaintObserver.disconnect();
	performance.mark("popup-first-frame");
	const stylesheet = document.createElement("link");
	stylesheet.rel = "stylesheet";
	stylesheet.href = "popup.styles.css";
	stylesheet.addEventListener("load", () => {
		const script = document.createElement("script");
		script.src = "popup.browser.js";
		document.body.append(script);
	}, { once: true });
	document.head.append(stylesheet);
});
popupPaintObserver.observe({ type: "paint", buffered: true });
