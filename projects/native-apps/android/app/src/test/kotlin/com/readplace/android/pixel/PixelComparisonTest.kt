package com.readplace.android.pixel

import org.junit.Assert.assertEquals
import org.junit.Test

private const val WHITE = 0xFFFFFFFF.toInt()
private const val BLACK = 0xFF000000.toInt()

private fun solid(width: Int, height: Int, argb: Int) =
	PixelBitmap(width = width, height = height, argb = IntArray(width * height) { argb })

class PixelComparisonTest {
	@Test
	fun `identical bitmaps match`() {
		val verdict = comparePixels(baseline = solid(10, 10, WHITE), capture = solid(10, 10, WHITE), tolerance = PIXEL_TOLERANCE)

		assertEquals(PixelVerdict.Match, verdict)
	}

	@Test
	fun `bitmaps of different size report both sizes whatever their pixels`() {
		val verdict = comparePixels(baseline = solid(10, 10, WHITE), capture = solid(12, 8, WHITE), tolerance = PIXEL_TOLERANCE)

		assertEquals(
			PixelVerdict.SizeMismatch(expectedWidth = 10, expectedHeight = 10, actualWidth = 12, actualHeight = 8),
			verdict,
		)
	}

	@Test
	fun `one pixel changed from white to black fails with the threshold that would have passed it`() {
		val capture = solid(10, 10, WHITE).let { white ->
			PixelBitmap(width = 10, height = 10, argb = white.argb.copyOf().also { it[42] = BLACK })
		}

		val verdict = comparePixels(baseline = solid(10, 10, WHITE), capture = capture, tolerance = PIXEL_TOLERANCE)

		assertEquals(PixelVerdict.TooManyDiffering(differing = 1, total = 100, smallestPassingThreshold = 0.966), verdict)
	}

	@Test
	fun `every pixel one grey level off matches`() {
		val verdict = comparePixels(
			baseline = solid(10, 10, 0xFF808080.toInt()),
			capture = solid(10, 10, 0xFF818181.toInt()),
			tolerance = PIXEL_TOLERANCE,
		)

		assertEquals(PixelVerdict.Match, verdict)
	}

	@Test
	fun `a white bitmap repainted black differs in every pixel`() {
		val verdict = comparePixels(baseline = solid(10, 10, WHITE), capture = solid(10, 10, BLACK), tolerance = PIXEL_TOLERANCE)

		assertEquals(PixelVerdict.TooManyDiffering(differing = 100, total = 100, smallestPassingThreshold = 0.966), verdict)
	}
}
