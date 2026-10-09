export function hxLocationToMain(location: { path: string; source: string }): string {
	return JSON.stringify({
		path: location.path,
		source: location.source,
		target: "main",
		select: "main",
		swap: "outerHTML show:none scroll:html:top",
	});
}
