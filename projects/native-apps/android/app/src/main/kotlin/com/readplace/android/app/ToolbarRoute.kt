package com.readplace.android.app

import com.readplace.android.core.Affordance
import com.readplace.android.core.SirenAction
import com.readplace.android.core.SirenLink

/**
 * The side effect a tapped collection-toolbar control resolves to, decided purely
 * from the affordance's advertised invocation. Keeping the decision in a pure value
 * (rather than inline in the view) lets the routing be unit-tested without a Compose
 * host.
 */
sealed interface ToolbarRoute {
	/** Follow a navigable link by opening its href in the in-app web view — the app
	 * acting as a browser over the contract. Reserved for navigable LINKS, never an
	 * action: an action is a capability the client submits, not a page it browses to. */
	data class Open(val link: SirenLink) : ToolbarRoute

	/** Invoke the action through the generic invoker, honouring its own
	 * method/type/fields/value. A bare-invokable collection action carries everything
	 * the request needs (the server fills each declared field's `value`), so it is
	 * submitted in place rather than opened as a GET web view of its href. */
	data class Invoke(val action: SirenAction) : ToolbarRoute

	/** Present the native add-link instructions sheet. The `add-links-help` link is a
	 * help affordance the client renders as its own sheet (reading the href from the
	 * view model) rather than browsing to the page, so which sheet a control presents
	 * is decided here, not by a name check in the view. */
	data object PresentAddLinksHelp : ToolbarRoute

	companion object {
		/** The link `rel` the client renders through its own in-app presentation rather
		 * than browsing to the href in the web view. The `add-links-help` link opens the
		 * native add-link instructions sheet — a help affordance the client presents
		 * itself — so the toolbar routes it to that sheet instead of opening its href as
		 * a page. Single source for the routing decision. */
		private const val ADD_LINKS_HELP_REL = "add-links-help"

		/**
		 * Routes an affordance: the `add-links-help` link presents the native help sheet;
		 * any other navigable link opens in the web view; any action is invoked through
		 * the generic invoker. An action is never opened as a GET web view of its href —
		 * that would discard its method/type/fields and silently turn a capability into
		 * navigation. The decision maps each affordance to an effect without gating which
		 * controls exist.
		 */
		fun route(affordance: Affordance): ToolbarRoute =
			when (val invocation = affordance.invocation) {
				is Affordance.Invocation.OfLink ->
					when (affordance.token) {
						ADD_LINKS_HELP_REL -> PresentAddLinksHelp
						else -> Open(invocation.link)
					}
				is Affordance.Invocation.OfAction -> Invoke(invocation.action)
			}
	}
}
