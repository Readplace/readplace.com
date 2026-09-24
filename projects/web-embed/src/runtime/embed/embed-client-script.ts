import { PAGE_URL_PLACEHOLDER } from "./snippet.component";

/** Copy-to-clipboard + live PAGE_URL substitution for the embed builder page.
 * Referenced with `<script src>` rather than inlined because inline scripts
 * are a CSP liability. Kept as a self-executing IIFE string because there is no
 * client-side TS bundler here. */
export const EMBED_CLIENT_JS = `(function() {
	var PLACEHOLDER = '${PAGE_URL_PLACEHOLDER}';
	var RESET_MS = 2000;

	var codes = document.querySelectorAll('[data-snippet-template]');
	var field = document.querySelector('form [name="url"]');
	if (field) {
		field.addEventListener('input', function() {
			var value = field.value.trim();
			var pageUrl = value ? encodeURIComponent(value) : PLACEHOLDER;
			for (var i = 0; i < codes.length; i++) {
				var code = codes[i];
				var text = code.getAttribute('data-snippet-template').split(PLACEHOLDER).join(pageUrl);
				code.textContent = text;
				var bytes = document.querySelector('[data-snippet-bytes="' + code.id + '"]');
				if (bytes) bytes.textContent = new Blob([text]).size.toLocaleString('en-US') + ' bytes';
			}
		});
	}

	var clipboard = navigator.clipboard;
	if (!clipboard) return;
	var buttons = document.querySelectorAll('[data-copy]');
	for (var j = 0; j < buttons.length; j++) {
		(function(btn) {
			var target = document.getElementById(btn.getAttribute('data-copy'));
			if (!target) return;
			var idleLabel = btn.textContent;
			var pendingReset;
			function flash(message) {
				clearTimeout(pendingReset);
				btn.textContent = message;
				pendingReset = setTimeout(function() { btn.textContent = idleLabel; }, RESET_MS);
			}
			btn.hidden = false;
			btn.addEventListener('click', function() {
				clipboard.writeText(target.textContent).then(
					function() { flash('Copied'); },
					function() { flash('Press Ctrl+C'); }
				);
			});
		})(buttons[j]);
	}
})();
`;
