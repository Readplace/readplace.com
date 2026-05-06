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
`;
