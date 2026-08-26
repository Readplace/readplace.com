package com.readplace.android.app

import com.readplace.android.core.Affordance
import com.readplace.android.core.SirenAction
import com.readplace.android.core.SirenLink

/**
 * The side effect a tapped per-item control resolves to, decided purely from the
 * affordance's advertised invocation and its presentation. The row's swipe /
 * accessibility twin of `ToolbarRoute`: keeping the decision in a pure value —
 * rather than inline in the view — lets the routing (open a link, confirm a
 * destructive action, or invoke) be unit-tested without a Compose host, so a
 * link-only item control is opened rather than silently dropped and a destructive
 * control never invokes without a confirmation.
 */
sealed interface ItemRoute {
	/** Follow a navigable link by opening its href in the in-app web view. */
	data class Open(val link: SirenLink) : ItemRoute

	/** A destructive action (no undo) awaits an explicit confirmation before it invokes. */
	data class ConfirmDestructive(val action: SirenAction) : ItemRoute

	/** Invoke a non-destructive action immediately through the generic invoker. */
	data class Invoke(val action: SirenAction) : ItemRoute

	companion object {
		/**
		 * Routes an item affordance: a navigable link opens; an action whose
		 * client-side presentation marks it destructive awaits confirmation; any other
		 * action invokes immediately. Whether an action is destructive is the single
		 * presentation mapping's call, never a per-name check in the view.
		 */
		fun route(affordance: Affordance): ItemRoute =
			when (val invocation = affordance.invocation) {
				is Affordance.Invocation.OfLink -> Open(invocation.link)
				is Affordance.Invocation.OfAction ->
					if (affordance.presentation.isDestructive) {
						ConfirmDestructive(invocation.action)
					} else {
						Invoke(invocation.action)
					}
			}
	}
}
