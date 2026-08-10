import { HtmxLoaded } from "./htmx-script";

export const CHROMELESS_TEMPLATE = `<!DOCTYPE html>
<html lang="en-AU">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title id="document-title">{{title}}</title>
	<meta name="description" content="{{description}}">
	<meta name="robots" content="{{robots}}">
	${HtmxLoaded.configMeta}

	<link rel="preconnect" href="https://fonts.googleapis.com">
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
	<link rel="preload" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" as="style" onload="this.onload=null;this.rel='stylesheet'">
	<noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"></noscript>

	<link rel="icon" type="image/svg+xml" href="{{staticBaseUrl}}/favicon.svg">

	<style nonce="{{cspNonce}}">
		{{{baseStyles}}}
		{{{resetStyles}}}
		{{{utilityStyles}}}
		{{{bannerAreaStyles}}}
		{{{changelogBannerStyles}}}
	</style>
</head>
<body{{#if bodyClass}} class="{{bodyClass}}"{{/if}}>
	{{{changelogBanner}}}
	{{{content}}}
	{{{scripts}}}
</body>
</html>
`;
