package com.readplace.android.app

import com.readplace.android.core.Affordance
import com.readplace.android.core.AppConfig
import com.readplace.android.core.Href
import com.readplace.android.core.SirenLink
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ReaderNavigationTest {
	private val current = "https://readplace.com/queue/a1/view?platform=android"

	@Test
	fun closeDeepLinkClosesViaLinkActivation() {
		assertEquals(
			ReaderNavigationDecision.Close,
			ReaderNavigation.decide(
				url = "readplace://reader/close",
				isLinkActivated = true,
				currentUrl = current,
			),
		)
	}

	@Test
	fun closeDeepLinkClosesEvenViaNonLinkNavigation() {
		assertEquals(
			ReaderNavigationDecision.Close,
			ReaderNavigation.decide(
				url = "readplace://reader/close",
				isLinkActivated = false,
				currentUrl = current,
			),
		)
	}

	@Test
	fun closeDeepLinkMatchesCaseInsensitivelyOnSchemeAndHost() {
		assertEquals(
			ReaderNavigationDecision.Close,
			ReaderNavigation.decide(
				url = "READPLACE://READER/close",
				isLinkActivated = true,
				currentUrl = current,
			),
		)
	}

	/**
	 * The account page reaches this link through htmx's `HX-Redirect`, which assigns
	 * `location.href` — a navigation the WebView reports without a gesture, not a tap
	 * — so the deep-link match has to run ahead of the link-activated branch and
	 * independently of it.
	 */
	@Test
	fun logoutDeepLinkSignsOutViaAnHtmxRedirect() {
		assertEquals(
			ReaderNavigationDecision.Logout,
			ReaderNavigation.decide(
				url = "readplace://account/logout",
				isLinkActivated = false,
				currentUrl = current,
			),
		)
	}

	@Test
	fun logoutDeepLinkSignsOutViaLinkActivation() {
		assertEquals(
			ReaderNavigationDecision.Logout,
			ReaderNavigation.decide(
				url = "readplace://account/logout",
				isLinkActivated = true,
				currentUrl = current,
			),
		)
	}

	@Test
	fun logoutDeepLinkMatchesCaseInsensitivelyOnSchemeAndHost() {
		assertEquals(
			ReaderNavigationDecision.Logout,
			ReaderNavigation.decide(
				url = "READPLACE://ACCOUNT/logout",
				isLinkActivated = false,
				currentUrl = current,
			),
		)
	}

	/**
	 * An unknown `readplace://` host is not a control this build understands, so it
	 * falls through to the ordinary rules rather than being silently swallowed.
	 */
	@Test
	fun unknownReadplaceDeepLinkFallsThroughToTheOrdinaryRules() {
		assertEquals(
			ReaderNavigationDecision.OpenExternally("readplace://account/unknown"),
			ReaderNavigation.decide(
				url = "readplace://account/unknown",
				isLinkActivated = true,
				currentUrl = current,
			),
		)
	}

	@Test
	fun hostlessReadplaceDeepLinkFallsThroughToTheOrdinaryRules() {
		assertEquals(
			ReaderNavigationDecision.OpenExternally("readplace:close"),
			ReaderNavigation.decide(
				url = "readplace:close",
				isLinkActivated = true,
				currentUrl = current,
			),
		)
	}

	@Test
	fun tappedExternalHttpsLinkOpensExternallyWithRawTarget() {
		assertEquals(
			ReaderNavigationDecision.OpenExternally("https://example.com/post"),
			ReaderNavigation.decide(
				url = "https://example.com/post",
				isLinkActivated = true,
				currentUrl = current,
			),
		)
	}

	@Test
	fun tappedReadplaceLinkAlsoOpensExternally() {
		assertEquals(
			ReaderNavigationDecision.OpenExternally("https://readplace.com/about"),
			ReaderNavigation.decide(
				url = "https://readplace.com/about",
				isLinkActivated = true,
				currentUrl = current,
			),
		)
	}

	@Test
	fun tappedNonHttpSchemeLinkOpensExternally() {
		assertEquals(
			ReaderNavigationDecision.OpenExternally("mailto:hello@readplace.com"),
			ReaderNavigation.decide(
				url = "mailto:hello@readplace.com",
				isLinkActivated = true,
				currentUrl = current,
			),
		)
	}

	@Test
	fun tappedSchemelessTargetOpensExternally() {
		assertEquals(
			ReaderNavigationDecision.OpenExternally("/queue/a1/view"),
			ReaderNavigation.decide(
				url = "/queue/a1/view",
				isLinkActivated = true,
				currentUrl = current,
			),
		)
	}

	@Test
	fun tappedUnparseableTargetStaysInTheWebView() {
		assertEquals(
			"java.net.URI rejects characters a browser accepts, so a parse failure says " +
				"nothing about the navigation — routing it out would send footnote taps to a browser",
			ReaderNavigationDecision.Allow,
			ReaderNavigation.decide(
				url = "https://example.com/a b",
				isLinkActivated = true,
				currentUrl = current,
			),
		)
	}

	@Test
	fun sameDocumentFragmentTapStaysInTheWebView() {
		assertEquals(
			ReaderNavigationDecision.Allow,
			ReaderNavigation.decide(
				url = "https://readplace.com/queue/a1/view?platform=android#footnote",
				isLinkActivated = true,
				currentUrl = current,
			),
		)
	}

	@Test
	fun fragmentOnADifferentSchemeOpensExternally() {
		val url = "http://readplace.com/queue/a1/view?platform=android#footnote"
		assertEquals(
			ReaderNavigationDecision.OpenExternally(url),
			ReaderNavigation.decide(url = url, isLinkActivated = true, currentUrl = current),
		)
	}

	@Test
	fun fragmentOnADifferentHostOpensExternally() {
		val url = "https://example.com/queue/a1/view?platform=android#footnote"
		assertEquals(
			ReaderNavigationDecision.OpenExternally(url),
			ReaderNavigation.decide(url = url, isLinkActivated = true, currentUrl = current),
		)
	}

	@Test
	fun fragmentOnADifferentPortOpensExternally() {
		val url = "https://readplace.com:8443/queue/a1/view?platform=android#footnote"
		assertEquals(
			ReaderNavigationDecision.OpenExternally(url),
			ReaderNavigation.decide(url = url, isLinkActivated = true, currentUrl = current),
		)
	}

	@Test
	fun fragmentOnADifferentPathOpensExternally() {
		val url = "https://readplace.com/queue/a2/view?platform=android#footnote"
		assertEquals(
			ReaderNavigationDecision.OpenExternally(url),
			ReaderNavigation.decide(url = url, isLinkActivated = true, currentUrl = current),
		)
	}

	@Test
	fun fragmentWithADifferentQueryOpensExternally() {
		val url = "https://readplace.com/queue/a1/view?platform=web#footnote"
		assertEquals(
			ReaderNavigationDecision.OpenExternally(url),
			ReaderNavigation.decide(url = url, isLinkActivated = true, currentUrl = current),
		)
	}

	@Test
	fun initialLoadWithoutACurrentDocumentIsAllowed() {
		assertEquals(
			ReaderNavigationDecision.Allow,
			ReaderNavigation.decide(url = current, isLinkActivated = false, currentUrl = null),
		)
	}

	@Test
	fun backForwardSwipeIsAllowed() {
		assertEquals(
			ReaderNavigationDecision.Allow,
			ReaderNavigation.decide(
				url = "https://example.com/post",
				isLinkActivated = false,
				currentUrl = current,
			),
		)
	}

	@Test
	fun `a tapped app-shell page on our host stays in the sheet`() {
		assertEquals(
			ReaderNavigationDecision.Allow,
			ReaderNavigation.decide(
				url = "${AppConfig.serverBaseUrl}/queue?platform=android&shell=app",
				isLinkActivated = true,
				currentUrl = current,
			),
		)
	}

	@Test
	fun `a tapped page on our host with an unrecognised shell value opens externally`() {
		val url = "${AppConfig.serverBaseUrl}/queue?platform=android&shell=web"
		assertEquals(
			ReaderNavigationDecision.OpenExternally(url),
			ReaderNavigation.decide(url = url, isLinkActivated = true, currentUrl = current),
		)
	}

	@Test
	fun `a tapped page on our host with no query at all opens externally`() {
		val url = "${AppConfig.serverBaseUrl}/about"
		assertEquals(
			ReaderNavigationDecision.OpenExternally(url),
			ReaderNavigation.decide(url = url, isLinkActivated = true, currentUrl = current),
		)
	}

	@Test
	fun `a tapped app-shell marker on a foreign host opens externally`() {
		val url = "https://example.com/queue?shell=app"
		assertEquals(
			ReaderNavigationDecision.OpenExternally(url),
			ReaderNavigation.decide(url = url, isLinkActivated = true, currentUrl = current),
		)
	}

	@Test
	fun `the web-app door is both a toolbar control and a target the sheet keeps`() {
		val link = SirenLink(rel = listOf("web-app"), href = "/queue?platform=android", title = null)
		val affordance = requireNotNull(Affordance.of(link))
		assertTrue(affordance.isToolbarControl)
		assertEquals("Web App", affordance.label)

		val resolved = requireNotNull(Href.resolve(requireNotNull(link.href), AppConfig.serverBaseUrl))
		val opened = Href.appending(
			resolved,
			AppConfig.APP_SHELL_QUERY_NAME,
			AppConfig.APP_SHELL_QUERY_VALUE,
		)
		assertEquals(
			ReaderNavigationDecision.Allow,
			ReaderNavigation.decide(url = opened, isLinkActivated = true, currentUrl = null),
		)
	}
}
