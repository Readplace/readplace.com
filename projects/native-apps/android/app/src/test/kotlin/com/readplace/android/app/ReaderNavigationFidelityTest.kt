package com.readplace.android.app

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The two cases where `java.net.URI` behaves unlike Foundation's `URL`, which the
 * iOS original is written against. Both were live regressions of the rule the file
 * exists to enforce: a footnote tap is a scroll, not a navigation.
 */
class ReaderNavigationFidelityTest {
	private val current = "https://readplace.com/queue/a1/view?platform=android"

	@Test
	fun `a fragment URI parses as illegal but still counts as an in-page jump`() {
		// A space, a '|' and a '^' are all legal in a browser fragment and all make
		// java.net.URI throw. Treating the parse failure as "not a fragment" sent
		// every such footnote tap to an external browser.
		for (fragment in listOf("foo bar", "foo|bar", "foo^bar")) {
			assertEquals(
				"a footnote whose id URI cannot parse is still a same-document jump",
				ReaderNavigationDecision.Allow,
				ReaderNavigation.decide(
					url = "$current#$fragment",
					isLinkActivated = true,
					currentUrl = current,
				),
			)
		}
	}

	@Test
	fun `a query that differs only by percent-encoding is a real navigation`() {
		// getQuery() decodes, so "b=%2Fqueue" and "b=/queue" compare equal through it
		// and a genuine navigation would be mistaken for an in-page jump.
		assertEquals(
			ReaderNavigationDecision.OpenExternally("https://readplace.com/v?a=1&b=/queue#f"),
			ReaderNavigation.decide(
				url = "https://readplace.com/v?a=1&b=/queue#f",
				isLinkActivated = true,
				currentUrl = "https://readplace.com/v?a=1&b=%2Fqueue",
			),
		)
	}
}
