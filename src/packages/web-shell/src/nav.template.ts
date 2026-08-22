import { brandMarkSvg } from "./brand-mark";

export const NAV_TEMPLATE = `  <header class="header{{#if transparent}} header--transparent{{/if}}">
		<div class="header__content">
			<a href="{{track '/' source='header' content='brand'}}" class="header__brand">${brandMarkSvg({ className: "header__brand-icon" })}<span class="header__brand-text">Read<span class="header__brand-mark">place</span></span></a>
			<a class="trial-countdown trial-countdown--{{trialEscalationClass}} trial-countdown--{{trialVisibility}}"
				href="{{track '/account' source='header' content='trial-countdown'}}"
				data-trial-ends-at-iso="{{trialEndsAtIso}}"
				data-server-now-iso="{{serverNowIso}}"
				data-trial-state="{{trialState}}"
				{{#if trialAriaLabel}}aria-label="{{trialAriaLabel}}" title="{{trialAriaLabel}}"{{/if}}
				role="timer"
				aria-live="off"
				aria-atomic="true"
				data-test-trial-countdown>{{trialDisplayText}}</a>
			<nav class="nav" aria-label="Main">
				<details class="nav__disclosure">
				<summary class="nav__toggle" aria-label="Toggle navigation">
					<span class="nav__toggle-bar"></span>
					<span class="nav__toggle-bar"></span>
					<span class="nav__toggle-bar"></span>
					<span class="nav__toggle-x">{{icon "x"}}</span>
				</summary>
				<div id="nav-menu" class="nav__menu" data-test-nav-variant="{{navVariant}}">
					{{#each navGroups}}
					<div class="nav__group" data-test-nav-group="{{key}}">
						<span class="nav__group-label">{{label}}</span>
						<ul class="nav__list">
							{{#each items}}
							<li>
								<form method="{{method}}" action="{{href}}">
									<input type="hidden" name="utm_source" value="{{trackSource}}">
									<input type="hidden" name="utm_medium" value="internal">
									<input type="hidden" name="utm_content" value="{{trackContent}}">
									<button type="submit" class="nav__link" data-test-nav-item="{{key}}"><span class="nav__icon-wrap"><span class="nav__icon">{{icon iconName}}</span></span><span class="nav__label">{{label}}</span></button>
								</form>
							</li>
							{{/each}}
						</ul>
					</div>
					{{/each}}
					{{#each navItems}}
					{{#if @first}}<ul class="nav__list">{{/if}}
					<li>
						<form method="{{method}}" action="{{href}}">
							<input type="hidden" name="utm_source" value="{{trackSource}}">
							<input type="hidden" name="utm_medium" value="internal">
							<input type="hidden" name="utm_content" value="{{trackContent}}">
							<button type="submit" class="nav__link" data-test-nav-item="{{key}}"><span class="nav__icon-wrap"><span class="nav__icon">{{icon iconName}}</span></span><span class="nav__label">{{label}}</span></button>
						</form>
					</li>
					{{#if @last}}</ul>{{/if}}
					{{/each}}
				</div>
				</details>
			</nav>
		</div>
	</header>
`;
