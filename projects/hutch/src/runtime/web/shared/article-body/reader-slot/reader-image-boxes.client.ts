export const READER_IMAGE_SIZE_ATTRIBUTE = "data-reader-image-size";
export const READER_IMAGE_BOXES_ATTRIBUTE = "data-reader-image-boxes";

export function initReaderImageBoxes(deps: {
	document: Document;
	isImage: (target: EventTarget | null) => target is HTMLImageElement;
}): void {
	const release = (image: HTMLImageElement): void => {
		image.removeAttribute(READER_IMAGE_SIZE_ATTRIBUTE);
		image.removeAttribute("style");
	};
	const releaseSettled = (event: Event): void => {
		if (deps.isImage(event.target) && event.target.hasAttribute(READER_IMAGE_SIZE_ATTRIBUTE)) release(event.target);
	};
	deps.document.addEventListener("load", releaseSettled, true);
	deps.document.addEventListener("error", releaseSettled, true);
	deps.document.querySelectorAll<HTMLImageElement>(`img[${READER_IMAGE_SIZE_ATTRIBUTE}]`).forEach((image) => {
		if (image.complete) release(image);
	});
	deps.document.documentElement.setAttribute(READER_IMAGE_BOXES_ATTRIBUTE, "");
}
