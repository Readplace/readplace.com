/** Copy-to-clipboard + live PAGE_URL substitution for the embed builder page.
 * Referenced with `<script src>` rather than inlined because inline scripts
 * are a CSP liability. Kept as a self-executing IIFE string because there is no
 * client-side TS bundler here. */
export const EMBED_CLIENT_JS = `(function() {
	var buttons = document.querySelectorAll('[data-copy]');
	for (var i = 0; i < buttons.length; i++) {
		(function(btn) {
			btn.addEventListener('click', function() {
				var target = document.getElementById(btn.getAttribute('data-copy'));
				if (!target) return;
				navigator.clipboard.writeText(target.textContent || '').then(function() {
					var original = btn.textContent;
					btn.textContent = 'Copied';
					setTimeout(function() { btn.textContent = original; }, 1500);
				});
			});
		})(buttons[i]);
	}

	var snippetIds = ['snippet-a-code', 'snippet-b-code', 'snippet-c-code'];
	var originals = {};
	for (var i = 0; i < snippetIds.length; i++) {
		var el = document.getElementById(snippetIds[i]);
		if (el) originals[snippetIds[i]] = el.textContent;
	}

	var urlInput = document.querySelector('.embed-url-input__field');
	if (urlInput) {
		urlInput.addEventListener('input', function() {
			var url = urlInput.value.trim();
			for (var id in originals) {
				var el = document.getElementById(id);
				if (!el) continue;
				if (url) {
					el.textContent = originals[id].replace('PAGE_URL', encodeURIComponent(url));
				} else {
					el.textContent = originals[id];
				}
			}
		});
	}
})();
`;
