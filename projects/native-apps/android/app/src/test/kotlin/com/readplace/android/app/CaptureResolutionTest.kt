package com.readplace.android.app

import com.readplace.android.core.CapturedPage
import org.junit.Assert.assertEquals
import org.junit.Test

class CaptureResolutionTest {
	@Test
	fun `a page a navigation callback already resolved is handed back untouched`() {
		assertEquals(
			CaptureResolution.Settled(CapturedPage.PdfDetected),
			CaptureResolution.of(
				settledPage = CapturedPage.PdfDetected,
				navigationStarted = true,
				loadFinished = true,
			),
		)
	}

	@Test
	fun `a callback that failed the load before navigation still settles that page`() {
		// The failure callbacks can fire before the layout wait ever yields, so a
		// settled page wins even when navigation is not marked started.
		assertEquals(
			CaptureResolution.Settled(CapturedPage.Empty),
			CaptureResolution.of(
				settledPage = CapturedPage.Empty,
				navigationStarted = false,
				loadFinished = false,
			),
		)
	}

	@Test
	fun `a timeout before navigation started loads and extracts nothing`() {
		assertEquals(
			CaptureResolution.NothingLoaded,
			CaptureResolution.of(
				settledPage = null,
				navigationStarted = false,
				loadFinished = false,
			),
		)
	}

	@Test
	fun `a load that finished within budget extracts after the settle delay`() {
		assertEquals(
			CaptureResolution.ExtractAfterSettle,
			CaptureResolution.of(
				settledPage = null,
				navigationStarted = true,
				loadFinished = true,
			),
		)
	}

	@Test
	fun `a timeout after navigation started extracts the partial dom`() {
		assertEquals(
			CaptureResolution.ExtractPartial,
			CaptureResolution.of(
				settledPage = null,
				navigationStarted = true,
				loadFinished = false,
			),
		)
	}
}
