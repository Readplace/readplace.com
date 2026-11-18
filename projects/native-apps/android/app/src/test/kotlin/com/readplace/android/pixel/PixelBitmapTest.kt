package com.readplace.android.pixel

import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class PixelBitmapTest {
	@get:Rule val folder = TemporaryFolder()

	@Test
	fun `a bitmap written as PNG reads back equal`() {
		val original = PixelBitmap(
			width = 3,
			height = 2,
			argb = intArrayOf(0xFFFF0000.toInt(), 0xFF00FF00.toInt(), 0xFF0000FF.toInt(), 0xFF123456.toInt(), 0xFFFFFFFF.toInt(), 0xFF000000.toInt()),
		)
		val file = File(folder.root, "nested/bitmap.png")

		original.encodePng(file)

		assertEquals(original, decodePng(file))
	}
}
