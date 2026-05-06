import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EmbedBase } from "./embed-base.component";
import type { Component } from "../../component.types";
import { EMBED_PAGE_STYLES } from "./embed.styles";
import { render } from "../../render";
import { byteLength, renderCanonicalSnippet, renderSnippet } from "./snippet.component";

const EMBED_TEMPLATE = readFileSync(join(__dirname, "embed.template.html"), "utf-8");

const COPY_SCRIPT = `<script>
(function() {
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
</script>`;

const CANONICAL_EMBED_ORIGIN = "https://readplace.com/embed";

export interface EmbedPageInput {
	appOrigin: string;
	embedOrigin: string;
}

export function EmbedPage(input: EmbedPageInput): Component {
	const origins = { appOrigin: input.appOrigin, embedOrigin: input.embedOrigin, pageUrl: `${input.embedOrigin}/` };
	const previewA = renderSnippet("a", origins);
	const previewB = renderSnippet("b", origins);
	const previewC = renderSnippet("c", origins);
	const sourceA = renderCanonicalSnippet("a");
	const sourceB = renderCanonicalSnippet("b");
	const sourceC = renderCanonicalSnippet("c");

	const content = render(EMBED_TEMPLATE, {
		heroDemo: previewB,
		previewA,
		previewB,
		previewC,
		snippetA: sourceA,
		snippetB: sourceB,
		snippetC: sourceC,
		bytesA: byteLength(sourceA),
		bytesB: byteLength(sourceB),
		bytesC: byteLength(sourceC),
		appOrigin: input.appOrigin,
	});

	return EmbedBase({
		seo: {
			title: "Readplace embed kit — a save button for your readers",
			description:
				"A copy-paste save button for bloggers and newsletter operators. Under 1 KB, no JavaScript, no tracking.",
			canonicalUrl: `${CANONICAL_EMBED_ORIGIN}/`,
		},
		pageStyles: EMBED_PAGE_STYLES,
		bodyClass: "page-embed",
		content,
		scripts: COPY_SCRIPT,
		appOrigin: input.appOrigin,
	});
}
