import { brandMarkSvg } from "./brand-mark";

export const NAV_TEMPLATE = `  <header class="header{{#if transparent}} header--transparent{{/if}}">
		<div class="header__content">
			<div class="header__start">
				<a href="{{track '/' source='header' content='brand' term=clickSurface}}" class="header__brand">${brandMarkSvg({ className: "header__brand-icon" })}<span class="header__brand-text">Read<span class="header__brand-mark">place</span></span></a>
				<a class="trial-countdown trial-countdown--{{trialEscalationClass}} trial-countdown--{{trialVisibility}}"
					href="{{track '/account' source='header' content='trial-countdown' term=clickSurface}}"
					data-trial-ends-at-iso="{{trialEndsAtIso}}"
					data-server-now-iso="{{serverNowIso}}"
					data-trial-state="{{trialState}}"
					{{#if trialAriaLabel}}aria-label="{{trialAriaLabel}}" title="{{trialAriaLabel}}"{{/if}}
					role="timer"
					aria-live="off"
					aria-atomic="true"
					data-test-trial-countdown>{{trialDisplayText}}</a>
			</div>
			<nav class="nav" aria-label="Main">
				<details class="nav__disclosure">
				<summary class="nav__toggle" aria-label="Toggle navigation">
					<span class="nav__toggle-bar"></span>
					<span class="nav__toggle-bar"></span>
					<span class="nav__toggle-bar"></span>
					<span class="nav__toggle-x">{{icon "x"}}</span>
				</summary>
				<div id="nav-menu" class="nav__menu" data-test-nav-variant="{{navVariant}}">
					{{#*inline "navItems"}}
					{{#each items}}
					<li>
						<form method="{{method}}" action="{{href}}">
							<input type="hidden" name="utm_source" value="{{trackSource}}">
							<input type="hidden" name="utm_medium" value="internal">
							<input type="hidden" name="utm_content" value="{{trackContent}}">
							{{#if trackTerm}}<input type="hidden" name="utm_term" value="{{trackTerm}}">{{/if}}
							<button type="submit" class="nav__link" data-test-nav-item="{{key}}"><span class="nav__icon-wrap"><span class="nav__icon">{{icon iconName}}</span></span><span class="nav__label">{{label}}</span></button>
						</form>
					</li>
					{{/each}}
					{{/inline}}
					{{#*inline "identity"}}
					<span class="nav__avatar" aria-hidden="true">{{userMenu.initials}}</span>
					<span class="nav__user-name" data-test-nav-user-email>{{userMenu.email}}</span>
					{{/inline}}
					{{#each navGroups}}
					<div class="nav__group nav__group--{{key}}" data-test-nav-group="{{key}}">
						{{#if userMenu}}
						<details class="nav__user" data-test-nav-user>
							<summary class="nav__user-summary" aria-label="Account menu for {{userMenu.email}}">
								{{> identity}}
								<span class="nav__user-chevron" aria-hidden="true">{{icon "chevron-down"}}</span>
							</summary>
							<ul class="nav__list nav__user-menu">
								<li class="nav__user-identity" data-test-nav-user-identity>
									{{> identity}}
								</li>
								{{> navItems items=items}}
							</ul>
						</details>
						{{else}}
						<span class="nav__group-label">{{label}}</span>
						<ul class="nav__list">
							{{> navItems items=items}}
						</ul>
						{{/if}}
					</div>
					{{/each}}
					{{#if navItems}}
					<ul class="nav__list nav__list--guest">
						{{> navItems items=navItems}}
					</ul>
					{{/if}}
				</div>
				</details>
			</nav>
		</div>
	</header>
`;
