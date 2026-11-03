### Motion

- **State changes are quick colour changes, not choreography.** Hover, selection and disclosure transition `background-color`, `color`, `border-color` or a chevron's rotation over `150ms ease`. Nothing bounces, scales or slides in on hover.
- **Only work in progress loops.** A spinning `loader`, a pulsing dot or the three in-flight dots mark a request in flight and stop when it lands. Nothing else animates on its own.
- **An in-page anchor jump is instant.** A table-of-contents row moves the page straight to its heading; nothing sets `scroll-behavior: smooth`.
- **Every animation has an off-switch.** Any `animation`, and any transition that moves an element (a drawer, a sliding header, a toast's exit), is disabled under `@media (prefers-reduced-motion: reduce)`. The static state must still read correctly.
