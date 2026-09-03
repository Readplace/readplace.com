export interface ReadlistPickerDeps {
	document: Document;
}

const PICKER = ".article-body__readlists";

export function initReadlistPicker(deps: ReadlistPickerDeps): { attach(): void } {
	function attach(): void {
		deps.document.addEventListener("click", (event) => {
			const clickedThrough = event.composedPath();
			for (const picker of deps.document.querySelectorAll(PICKER)) {
				if (!clickedThrough.includes(picker)) picker.removeAttribute("open");
			}
		});
	}

	return { attach };
}
