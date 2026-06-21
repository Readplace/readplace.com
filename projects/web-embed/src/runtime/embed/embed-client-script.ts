/** Copy-to-clipboard + live PAGE_URL substitution for the embed builder page.
 * Served same-origin at `/embed/embed.client.js` (see embed.page.ts) and
 * referenced with `<script src>` rather than inlined, per the web skill's
 * "Browser JS Is Bundled and Served Same-Origin" rule (inline scripts are a
 * CSP liability). Kept as a self-executing IIFE string because web-embed has
 * no client-TS bundler. */
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
