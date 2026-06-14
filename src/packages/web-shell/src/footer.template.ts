export const FOOTER_TEMPLATE = `  <footer class="footer">
    <div class="footer__content">
      <ul class="footer__links">
        <li><a href="{{track '/blog' source='footer' content='blog'}}" class="footer__link">Blog</a></li>
        <li><a href="{{track '/privacy' source='footer' content='privacy'}}" class="footer__link">Privacy</a></li>
        <li><a href="{{track '/terms' source='footer' content='terms'}}" class="footer__link">Terms</a></li>
      </ul>
      <p class="footer__copyright">&copy; {{year}} Readplace. Made in Australia.</p>
    </div>
  </footer>
`;
