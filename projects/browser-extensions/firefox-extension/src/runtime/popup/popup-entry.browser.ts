window.addEventListener(
	"load",
	() => {
		const loadApplication = () => {
			window.requestAnimationFrame(() => {
				window.requestAnimationFrame(() => {
					window.setTimeout(() => {
						performance.mark("popup-first-frame");
						const stylesheet = document.createElement("link");
						stylesheet.rel = "stylesheet";
						stylesheet.href = "popup.styles.css";
						stylesheet.addEventListener(
							"load",
							() => {
								const script = document.createElement("script");
								script.src = "popup.browser.js";
								performance.mark("popup-runtime-load-started");
								document.body.append(script);
							},
							{ once: true },
						);
						document.head.append(stylesheet);
					}, 0);
				});
			});
		};
		if (document.hasFocus()) loadApplication();
		else window.addEventListener("focus", loadApplication, { once: true });
	},
	{ once: true },
);
