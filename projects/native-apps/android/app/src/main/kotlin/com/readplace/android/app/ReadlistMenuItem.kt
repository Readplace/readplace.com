package com.readplace.android.app

import com.readplace.android.core.Readlist

/**
 * One entry in the readlist switcher menu: the server's label and opaque href,
 * whether it is the selected readlist (a checkmark), and whether it is a share
 * destination (mainline or a chosen extra — a share badge). Presentation glyphs are
 * the view's; this only decides which badges an item earns. A stale stored share
 * destination the server no longer advertises produces no item — the menu is built
 * only from advertised readlists.
 */
data class ReadlistMenuItem(
	val label: String,
	val href: String,
	val isSelected: Boolean,
	val isShareTarget: Boolean,
) {
	companion object {
		fun items(
			readlists: List<Readlist>,
			selectedHref: String?,
			mainlineHref: String?,
			shareTargetHrefs: Set<String>,
		): List<ReadlistMenuItem> =
			readlists.map { readlist ->
				ReadlistMenuItem(
					label = readlist.label,
					href = readlist.href,
					isSelected = readlist.href == selectedHref,
					isShareTarget = readlist.href == mainlineHref || shareTargetHrefs.contains(readlist.href),
				)
			}
	}
}
