export const EXTENSION_SUGGESTION_BANNER_TEMPLATE = `<div
	id="extension-suggestion-banner"
	class="banner-bar extension-suggestion-banner"
	role="status"
	aria-live="polite"
	data-show-extension-suggestion="{{show}}"
	data-test-extension-suggestion-banner{{#if oob}} hx-swap-oob="outerHTML"{{/if}}
>
	<button
		type="button"
		class="banner-bar__close"
		data-extension-suggestion-close
		data-test-extension-suggestion-close
		aria-label="Dismiss extension suggestion"
	>
		{{icon "x"}}
	</button>
	<div class="extension-suggestion-banner__content">
		{{#if extensionInstalled}}
			<p class="extension-suggestion-banner__message" data-test-extension-suggestion-variant="installed">
				Some sites don&rsquo;t allow Readplace to save the full article. Open the page and save it again with the Readplace extension to capture the whole page.
			</p>
		{{else}}
			<p class="extension-suggestion-banner__message" data-test-extension-suggestion-variant="not-installed">
				Some sites don&rsquo;t allow Readplace to save the full article. Use {{clientsPhrase}} to save the complete page.
			</p>
			<a class="btn btn--secondary btn--s extension-suggestion-banner__cta" href="/install?utm_source=reader-failed&amp;utm_medium=banner&amp;utm_campaign=extension-suggestion&amp;utm_content=cta-button" data-test-extension-suggestion-cta>See ways to save</a>
		{{/if}}
	</div>
</div>
`;
