# @packages/translations

Every user-facing string Readplace shows, one module per surface and locale. The en-US tree of a surface defines its shape; every other locale in `SUPPORTED_LOCALES` must carry the same keys and the same `{name}` placeholders, or the package does not compile.

- Web templates: `{{t "page.component.element" name=value}}` (registered by `@packages/web-shell`).
- TypeScript: `const { t, tPlural } = translator(surface, DEFAULT_LOCALE)`.
- Plurals are `{ one, other }` sub-keys chosen with `Intl.PluralRules`; values never contain HTML.
- `@packages/translations/copy-checker` reports literal copy left in a template; each web deployable's `copy.test.ts` runs it over the directories listed in its `MIGRATED_DIRECTORIES`.

| Surface | Purpose |
|---|---|
| common | Words and patterns every web surface shares: Close, Cancel and the page-title pattern |
| shell | The web shell every Readplace site renders around its pages: navigation, footer, banners, toast, confirm popover, offline indicator, pagination, pricing and local-time words |
| hutch-auth | Readplace sign-in: login, signup, password reset and change, OAuth consent, onboarding and the messages the auth middleware shows |
| hutch-readlist | The reading list: the queue, readlists, filters, article cards, their actions and alerts |
| hutch-reader | Reading an article: the view and reader pages, save page, article-body slots, the offline reader and EPUB front matter |
| hutch-account | The account pages: profile, plans, billing, sessions and account deletion |
| hutch-integrations | Getting links in and out: the import review, export, install pages, Gmail newsletters and the MCP connect page |
| hutch-emails | Every email Readplace sends: subjects, paragraphs and calls to action for transactional, digest, export and notice emails |
| hutch-api | The Siren API clients render: action and link titles, message bodies and API error messages; a client skips an action with no title, so none may be empty |
| hutch-stored | Sentences written to storage at the storage locale and read back later: Gmail discovery failure messages, article host stubs and the starter readlist label |
| inbox | The inbox site's pages and components |
| blog-site | The blog site's chrome around its posts: index, post layout and navigation (posts themselves are not translated) |
| web-embed | The embeddable save widget other sites place on their pages |
| browser-extension | The Chrome and Firefox extension: popup, notifications, context menus and save-all-tabs |
| ios-catalog | Every user-facing string of the iOS app and its share extension, in the one String Catalog both targets bundle |
| android-strings | Every user-facing string of the Android app, as Android string and plural resources |
