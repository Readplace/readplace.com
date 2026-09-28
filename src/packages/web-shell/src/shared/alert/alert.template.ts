export const ALERT_TEMPLATE = `<div class="alert alert--{{variant}} alert--visible" role="{{role}}" data-test-alert="{{key}}" data-test-alert-variant="{{variant}}"><span class="alert__icon" aria-hidden="true">{{icon iconName}}</span><div class="alert__content">{{{titleHtml}}}{{{messageHtml}}}</div></div>`;

export const ALERT_HIDDEN_TEMPLATE = `<div class="alert alert--hidden" data-test-alert="{{key}}"></div>`;

export const ALERT_TITLE_TEMPLATES = {
	p: `<p class="alert__title" data-test-alert-title>{{text}}</p>`,
	h1: `<h1 class="alert__title" data-test-alert-title>{{text}}</h1>`,
	h2: `<h2 class="alert__title" data-test-alert-title>{{text}}</h2>`,
} as const;

export const ALERT_TEXT_MESSAGE_TEMPLATE = `<p class="alert__message" data-test-alert-message>{{text}}</p>`;

export const ALERT_HTML_MESSAGE_TEMPLATE = `<div class="alert__message" data-test-alert-message>{{{html}}}</div>`;
