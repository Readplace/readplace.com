export const NEEDS_UPGRADE_STYLES = `
	.needs-upgrade {
		cursor: pointer;
	}

	.needs-upgrade:not(.btn--primary) {
		color: var(--muted-foreground);
	}

	.nav__group--library .needs-upgrade {
		color: var(--muted-foreground);
	}

	.nav__link.needs-upgrade > svg {
		width: 24px;
		height: 24px;
	}

	.menu__item.needs-upgrade svg {
		color: var(--muted-foreground);
	}

	.needs-upgrade__chip {
		margin-inline-start: auto;
	}

	.needs-upgrade__trigger {
		display: none;
	}

	@supports selector(:popover-open) {
		.needs-upgrade__trigger {
			display: inline-flex;
		}

		.needs-upgrade__fallback {
			display: none;
		}
	}
`;
