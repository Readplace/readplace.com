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

.install-page__tabs {
  display: flex;
  border-bottom: 1px solid var(--border);
  margin-bottom: 40px;
}

.install-page__tab {
  padding: 12px 24px;
  font-size: 1rem;
  font-weight: 500;
  text-decoration: none;
  color: var(--muted-foreground);
  border-bottom: 2px solid transparent;
  transition: color 0.2s, border-color 0.2s;
  margin-bottom: -1px;
}

.install-page__tab:hover {
  color: var(--foreground);
}

.install-page__tab--active {
  color: var(--primary);
  border-bottom-color: var(--primary);
  font-weight: 600;
}

.install-page__panel {
  padding-top: 8px;
}

.install-page__download {
  display: inline-block;
  padding: 16px 28px;
  border-radius: var(--radius);
  font-weight: 600;
  font-size: 1rem;
  text-decoration: none;
  cursor: pointer;
  background: var(--primary);
  color: var(--primary-foreground);
  transition: opacity 0.2s;
  margin-bottom: 48px;
}

.install-page__download:hover {
  opacity: 0.9;
}

.install-page__footnote {
  font-size: 0.875rem;
  line-height: 1.6;
  color: var(--muted-foreground);
  margin-top: 16px;
}

.install-page__unavailable {
  color: var(--muted-foreground);
  font-size: 1rem;
  line-height: 1.6;
}

.install-page__lead {
  font-size: 1.0625rem;
  line-height: 1.6;
  color: var(--foreground);
  margin: 0 0 28px;
  max-width: 600px;
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

.install-page__steps {
  max-width: 600px;
  margin: 0 0 28px;
  padding-left: 24px;
  list-style: decimal;
  color: var(--foreground);
}

.install-page__step {
  margin-bottom: 20px;
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
`;
