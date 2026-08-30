export const EXTENSION_SUGGESTION_BANNER_TEMPLATE = `<div
	id="extension-suggestion-banner"
	class="extension-suggestion-banner"
	role="status"
	aria-live="polite"
	data-show-extension-suggestion="{{show}}"
	data-test-extension-suggestion-banner{{#if oob}} hx-swap-oob="outerHTML"{{/if}}
>
	<div class="extension-suggestion-banner__inner">
		<button
			type="button"
			class="extension-suggestion-banner__close"
			data-extension-suggestion-close
			data-test-extension-suggestion-close
			aria-label="Dismiss extension suggestion"
		>
			{{icon "x"}}
		</button>
		<span class="extension-suggestion-banner__marker" aria-hidden="true"></span>
		<div class="extension-suggestion-banner__content">
			{{#if extensionInstalled}}
				<p class="extension-suggestion-banner__message" data-test-extension-suggestion-variant="installed">
					Some sites only let me save the link, not the full article. Open the page and save it again with the Readplace extension to capture the whole thing.
				</p>
			{{else}}
				<p class="extension-suggestion-banner__message" data-test-extension-suggestion-variant="not-installed">
					Some sites only let me save the link, not the full article. Save it in full with <a class="extension-suggestion-banner__inline" href="/install?utm_source=web-app&amp;utm_medium=banner&amp;utm_campaign=extension-suggestion&amp;utm_content=inline-text" data-test-extension-suggestion-inline>{{clientsPhrase}}</a>, straight from your device.
				</p>
				<a class="btn btn--on-dark btn--compact extension-suggestion-banner__cta" href="/install?utm_source=web-app&amp;utm_medium=banner&amp;utm_campaign=extension-suggestion&amp;utm_content=cta-button" data-test-extension-suggestion-cta>See the ways to save</a>
			{{/if}}
		</div>
	</div>
</div>
`;
