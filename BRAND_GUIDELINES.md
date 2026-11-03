# Readplace — Brand & Design Guidelines

> Internal reference for anyone building Readplace — developers, designers, contributors.
> Consult this before shipping UI, writing copy, or producing any public-facing asset.

---

## Brand Identity

**Tagline:** Read the Web, not the Slop.

Use this exact form on brand and user-facing surfaces — *Web* and *Slop* capitalised (the two nouns being contrasted), *the* and *not* lowercase, ending in a full stop. It is deliberate noun emphasis: not title case (*not* stays lowercase) and not sentence case (*Web* and *Slop* stay capitalised). Two intentional exceptions: the homepage SEO **keywords** meta uses the comma-free, all-lowercase `read the web not the slop` for keyword matching; and when the phrase runs **mid-sentence as prose** it follows that sentence's case (e.g. "…a place where you read the web, not the slop."). A standalone line or sign-off uses the canonical form above.

**What Readplace is:** A read-it-later app that saves articles, blog posts, and web pages for later reading. Born from a personal reading system refined over 10 years.

**What Readplace feels like:** A well-made tool shaped by daily use. A private reading nook in a home library — warm wood, good lighting, no distractions. Not a co-working space. Not a productivity dashboard. A quiet place that's yours.

### Brand Attributes

| Attribute | Means | Does NOT mean |
|---|---|---|
| Trustworthy | Reliable, transparent, proven over time | Corporate, institutional, stiff |
| Warm | Approachable, personal, human-built | Cutesy, childish, overly playful |
| Quiet confidence | Knows its value without shouting | Arrogant, flashy, "disruptive" |
| Crafted | Thoughtful attention to detail | Overdesigned, trendy, maximalist |
| Enduring | Built to last, not built to sell | Disposable, startup-y, growth-hacky |

---

## Index

Every section below is its own file. Read only the one the work needs.

- [Logo](brand-guidelines/logo.md) — the icon, its assets and usage rules, before placing or generating a logo
- [Colour Palette](brand-guidelines/colour-palette.md) — role tokens for both themes and the colour rules, before choosing or adding a colour
- [Typography](brand-guidelines/typography.md) — typefaces, the type scale and highlight words, before setting or changing type
- [Spacing & Layout](brand-guidelines/spacing-and-layout.md) — the spacing scale, form inputs, app pages and layout principles, before laying out a page or a form
- [Voice & Copy](brand-guidelines/voice-and-copy.md) — writing principles, capitalisation, punctuation, terminology and UI copy patterns, before writing any copy
- [Platform-Specific Guidance](brand-guidelines/platform-specific-guidance.md) — browser extension, web app, mobile, CLI and email notes, before working on one of those surfaces

### Iconography & UI Elements

- [Icon Style](brand-guidelines/iconography/icon-style.md) — the one line spec and how icons are drawn, before adding or changing an icon
- [Illustrations](brand-guidelines/iconography/illustrations.md) — spot illustrations, before leading an empty state, notice or confirmation with one
- [List Markers](brand-guidelines/iconography/list-markers.md) — polarity of included and excluded items, before marking up such a list
- [Buttons](brand-guidelines/iconography/buttons.md) — sizes, variants and the destructive style, before adding or restyling any button
- [Border Radius](brand-guidelines/iconography/border-radius.md) — the radius tokens, before rounding a surface
- [Shadows & Elevation](brand-guidelines/iconography/shadows-and-elevation.md) — the elevation tokens, before adding a shadow

### Components

- [Lists](brand-guidelines/components/lists.md) — the enclosed list card, before building a list of items
- [Disclosure cards](brand-guidelines/components/disclosure-cards.md) — the collapsible card, before adding one
- [Suggestion card (Next Read)](brand-guidelines/components/suggestion-card-next-read.md) — before changing the Next Read card
- [Empty States](brand-guidelines/components/empty-states.md) — before designing what an empty list shows
- [Tabs](brand-guidelines/components/tabs.md) — the shared tab strip, before adding or restyling tabs
- [Pagination](brand-guidelines/components/pagination.md) — the shared pager, before paging a list
- [Search and filters](brand-guidelines/components/search-and-filters.md) — the search row and filter drawer, before changing how a list narrows
- [Dropzone](brand-guidelines/components/dropzone.md) — the file picker, before changing an upload
- [Menus](brand-guidelines/components/menus.md) — before adding or restyling a menu
- [Dialogs](brand-guidelines/components/dialogs.md) — the shared confirm panel, before adding a dialog
- [Alerts and Status](brand-guidelines/components/alerts-and-status.md) — the in-page alert, before showing a status message
- [Chips, tags and badges](brand-guidelines/components/chips-tags-and-badges.md) — before adding a chip or badge
- [Toasts](brand-guidelines/components/toasts.md) — before showing a toast
- [Loading States](brand-guidelines/components/loading-states.md) — pending swaps and other waits, before showing that something is loading
- [Progress and Steppers](brand-guidelines/components/progress-and-steppers.md) — before adding a progress bar or stepper
- [Status Panels and Stat Tiles](brand-guidelines/components/status-panels-and-stat-tiles.md) — before building a status notice or stat tile
- [Settings pages](brand-guidelines/components/settings-pages.md) — before adding to the account page
- [Motion](brand-guidelines/components/motion.md) — transitions, before animating a state change

---

## Do's and Don'ts — Quick Reference

### Do

- Lead with warm amber (`--primary` fills, `--primary-text` ink).
- Use generous whitespace and spacing.
- Write like a human talking to another human, in sentence case.
- Design for reading comfort above everything.
- Test every UI against both light and dark modes.
- Maintain the quiet, confident, crafted tone.
- Make the product feel fast and lightweight.
- Use the CSS custom properties defined in `base.styles.ts` — never hardcode colour values.

### Don't

- Use pure black, neon colours, or heavy gradients.
- Add emojis, playful copy, or an exclamation mark outside a finished milestone or a signed greeting.
- Use "I", "we" or "our" as Readplace's voice — "I" belongs to signed correspondence, or to a button written as the reader's reply.
- Clutter the reading surface with chrome, toolbars, or feature promotions.
- Copy any competitor's visual language (especially Pocket's red or Readwise's yellow).
- Sacrifice legibility for aesthetics.
- Ship something that feels like a startup template.
- Hardcode hex values or button sizes — use the tokens, and pick a button size class.

---

*Last updated: September 2026*
