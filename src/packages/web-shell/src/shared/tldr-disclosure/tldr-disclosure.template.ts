export const TLDR_DISCLOSURE_TEMPLATE = `<details class="tldr-disclosure" data-test-tldr{{#if open}} open{{/if}}{{#if toggleUrl}} data-summary-toggle-url="{{toggleUrl}}"{{/if}}><summary class="tldr-disclosure__toggle"><span class="tldr-disclosure__heading"><span class="tldr-disclosure__icon" aria-hidden="true">{{icon "sparkles" variant="solid"}}</span>Summary</span><span class="tldr-disclosure__caret">{{icon "chevron-down"}}</span><span class="tldr-disclosure__preview" aria-hidden="true">{{preview}}</span></summary>{{{bodyHtml}}}</details>`;

export const TLDR_TEXT_BODY_TEMPLATE = `<pre class="tldr-disclosure__text">{{text}}</pre>`;

export const TLDR_HTML_BODY_TEMPLATE = `<div class="tldr-disclosure__body">{{{html}}}</div>`;
