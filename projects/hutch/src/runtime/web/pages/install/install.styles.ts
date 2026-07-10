export const INSTALL_PAGE_STYLES = `
.install-page {
  padding: 80px 20px;
}

.install-page__container {
  max-width: 720px;
  margin: 0 auto;
}

.install-page__title {
  font-size: 2rem;
  font-weight: 700;
  margin-bottom: 12px;
  color: var(--foreground);
}

.install-page__subtitle {
  font-size: 1.125rem;
  line-height: 1.6;
  color: var(--muted-foreground);
  margin-bottom: 40px;
}

/**
 * 1. Two labelled tab groups share a row and wrap as a unit when the viewport
 *    runs out of width — flex-wrap alone, no media query, so the layout is
 *    identical mobile and desktop.
 */
.install-page__groups {
  display: flex;
  flex-wrap: wrap; /* 1 */
  align-items: stretch;
  gap: 16px 28px;
  border-bottom: 1px solid var(--border);
  padding-bottom: 24px;
  margin-bottom: 40px;
}

.install-page__group {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.install-page__group-label {
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted-foreground);
}

.install-page__group-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.install-page__tab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: var(--button-padding-sm);
  font-size: 0.9375rem;
  font-weight: 500;
  text-decoration: none;
  color: var(--muted-foreground);
  background: var(--muted);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  transition: color 0.2s, background 0.2s, border-color 0.2s;
}

.install-page__tab:hover {
  color: var(--foreground);
  border-color: var(--primary);
}

.install-page__tab--active {
  color: var(--secondary-foreground);
  background: var(--secondary);
  border-color: var(--secondary-foreground);
  font-weight: 600;
}

/**
 * 1. A label, not a pill — radius-sm keeps it inside the brand's
 *    "never fully rounded" rule while the warm fill flags the beta.
 */
.install-page__tab-beta {
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-size: 0.625rem;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: var(--radius-sm); /* 1 */
  background: var(--color-warning);
  color: var(--foreground);
}

.install-page__panel {
  padding-top: 8px;
}

.install-page__panel-title {
  font-size: 1.375rem;
  font-weight: 600;
  margin-bottom: 12px;
  color: var(--foreground);
}

.install-page__lead {
  font-size: 1.0625rem;
  line-height: 1.6;
  color: var(--foreground);
  margin: 0 0 28px;
  max-width: 600px;
}

.install-page__download {
  display: inline-block;
  padding: var(--button-padding);
  border-radius: var(--radius);
  font-weight: 600;
  font-size: 1rem;
  text-decoration: none;
  cursor: pointer;
  background: var(--primary);
  color: var(--primary-foreground);
  transition: opacity 0.2s;
  margin-bottom: 36px;
}

.install-page__download:hover {
  opacity: 0.9;
}

.install-page__unavailable {
  color: var(--muted-foreground);
  font-size: 1rem;
  line-height: 1.6;
  margin-bottom: 36px;
}

.install-page__steps {
  max-width: 600px;
  margin: 0 0 28px;
  padding-left: 24px;
  list-style: decimal;
  color: var(--foreground);
}

.install-page__step {
  margin-bottom: 16px;
  padding-left: 6px;
  line-height: 1.6;
}

.install-page__step-title {
  display: block;
  font-size: 1rem;
}

.install-page__step-note {
  display: block;
  margin-top: 6px;
  font-size: 0.875rem;
  line-height: 1.5;
  color: var(--muted-foreground);
}

.install-page__steps-outro {
  max-width: 600px;
  margin: 0;
  font-size: 0.9375rem;
  line-height: 1.6;
  color: var(--muted-foreground);
}

.install-page__beta {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 16px 20px;
  background: var(--secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  margin-bottom: 32px;
}

.install-page__beta-badge {
  flex-shrink: 0;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-size: 0.75rem;
  font-weight: 700;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  background: var(--color-warning);
  color: var(--foreground);
}

.install-page__beta-copy {
  margin: 0;
  font-size: 0.9375rem;
  line-height: 1.6;
  color: var(--foreground);
}

.install-page__server-url {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--muted);
  margin-bottom: 20px;
}

.install-page__server-url-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted-foreground);
}

.install-page__server-url-value {
  flex: 1 1 auto;
  min-width: 0;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--foreground);
  word-break: break-all;
}

.install-page__prompt {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px 12px;
  margin-bottom: 16px;
}

.install-page__prompt-label {
  flex: 0 0 100%;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted-foreground);
}

.install-page__prompt-text {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 0.9375rem;
  line-height: 1.5;
  color: var(--foreground);
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--muted);
  word-break: break-word;
}

.install-page__copy-btn {
  flex: 0 0 auto;
  padding: var(--button-padding-sm);
  border: none;
  border-radius: var(--radius-sm);
  background: var(--primary);
  color: var(--primary-foreground);
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
}

.install-page__copy-btn:hover {
  opacity: 0.9;
}

.install-page__ai-req {
  font-size: 0.9375rem;
  line-height: 1.6;
  color: var(--muted-foreground);
  margin-bottom: 20px;
}

.install-page__ai-note {
  font-size: 0.9375rem;
  line-height: 1.6;
  color: var(--muted-foreground);
  margin-bottom: 24px;
}

.install-page__ai-guide {
  color: var(--primary);
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
}

.install-page__ai-guide:hover {
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
}

.install-page__foot-note {
  margin: 0;
  padding-top: 20px;
  border-top: 1px solid var(--border);
  font-size: 0.875rem;
  line-height: 1.6;
  color: var(--muted-foreground);
}

/**
 * 1. Wide (landscape) shots span the whole strip; tall (portrait phone) shots
 *    share a row via auto-fit — no media query, mirrors the tab groups above.
 * 2. Same theme-adaptive frame as the homepage demo videos: the raster inside
 *    is one light-theme asset, but the border/caption chrome follows the theme.
 */
.install-page__screenshots {
  display: grid; /* 1 */
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 24px;
  margin-top: 48px;
  padding-top: 32px;
  border-top: 1px solid var(--border);
}

.install-page__screenshot {
  margin: 0;
  min-width: 0;
}

.install-page__screenshot--wide {
  grid-column: 1 / -1;
}

.install-page__screenshot-img {
  display: block;
  width: 100%;
  height: auto;
  border: 1px solid var(--border); /* 2 */
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
}

.install-page__screenshot-caption {
  padding-top: 10px;
  font-size: 0.875rem;
  line-height: 1.6;
  color: var(--muted-foreground);
}
`;
