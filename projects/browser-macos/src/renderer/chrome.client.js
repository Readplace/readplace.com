/**
 * Renderer toolbar wiring. All navigation state lives in the main process,
 * which drives the embedded <webview> and pushes nav-state here; this script
 * only forwards button intents and reflects the pushed state onto the toolbar.
 */
(() => {
	const ir = window.internetReader;
	const back = document.getElementById("back");
	const forward = document.getElementById("forward");
	const reload = document.getElementById("reload");
	const toggle = document.getElementById("toggle");
	const form = document.getElementById("address-form");
	const address = document.getElementById("address");
	const progress = document.getElementById("progress");

	back.addEventListener("click", () => ir.back());
	forward.addEventListener("click", () => ir.forward());
	reload.addEventListener("click", () => ir.reload());
	toggle.addEventListener("click", () => ir.toggleReader());

	address.addEventListener("input", () => {
		address.classList.remove("toolbar__input--error");
		address.removeAttribute("title");
	});

	form.addEventListener("submit", async (event) => {
		event.preventDefault();
		const result = await ir.navigate(address.value);
		if (result && result.ok === false) {
			address.classList.add("toolbar__input--error");
			if (result.reason) address.title = result.reason;
			return;
		}
		address.blur();
	});

	ir.onNavState((state) => {
		back.disabled = !state.canGoBack;
		forward.disabled = !state.canGoForward;
		if (document.activeElement !== address) {
			address.value = state.displayUrl;
		}
		toggle.textContent = state.isReader ? "🌐" : "📄";
		toggle.title = state.isReader ? "View live page" : "View reader view";
		progress.classList.toggle("toolbar__progress--active", state.loading);
	});

	ir.onFocusAddress(() => {
		address.focus();
		address.select();
	});
})();
