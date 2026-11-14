package com.readplace.android.pixel

import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class PixelCheckpointTest {
	@get:Rule val folder = TemporaryFolder()

	private val checkpoint = PixelCheckpoint(suite = "Suite", name = "row", appearance = Appearance.Light)
	private val capture = PixelBitmap(width = 2, height = 1, argb = intArrayOf(0xFFFFFFFF.toInt(), 0xFF000000.toInt()))
	private val differing = PixelBitmap(width = 2, height = 1, argb = intArrayOf(0xFF000000.toInt(), 0xFFFFFFFF.toInt()))
	private lateinit var baselineDir: File
	private lateinit var failureDir: File
	private lateinit var baselineFile: File

	@Before
	fun directories() {
		baselineDir = folder.newFolder("baselines")
		failureDir = folder.newFolder("failures")
		baselineFile = File(baselineDir, "Suite/row-light.png")
	}

	private fun baselines(isRecording: Boolean) = PixelBaselines(
		baselineDir = baselineDir,
		failureDir = failureDir,
		isRecording = isRecording,
		tolerance = PIXEL_TOLERANCE,
	)

	@Test
	fun `no committed picture fails as missing`() {
		assertEquals(CheckpointOutcome.MissingBaseline(baselineFile), baselines(isRecording = false).settle(checkpoint, capture))
	}

	@Test
	fun `recording writes the picture`() {
		assertEquals(CheckpointOutcome.Recorded(baselineFile), baselines(isRecording = true).settle(checkpoint, capture))
		assertEquals(capture, decodePng(baselineFile))
	}

	@Test
	fun `recording over an identical picture still records rather than verifies`() {
		capture.encodePng(baselineFile)

		assertEquals(CheckpointOutcome.Recorded(baselineFile), baselines(isRecording = true).settle(checkpoint, capture))
	}

	@Test
	fun `a differing capture fails and is written to the failure directory`() {
		differing.encodePng(baselineFile)
		val actualFile = File(failureDir, "Suite/row-light.png")

		val outcome = baselines(isRecording = false).settle(checkpoint, capture)

		assertEquals(
			CheckpointOutcome.Mismatch(
				verdict = PixelVerdict.TooManyDiffering(differing = 2, total = 2, smallestPassingThreshold = 0.966),
				actualFile = actualFile,
			),
			outcome,
		)
		assertEquals(capture, decodePng(actualFile))
	}

	@Test
	fun `an identical capture verifies`() {
		capture.encodePng(baselineFile)

		assertEquals(CheckpointOutcome.Verified, baselines(isRecording = false).settle(checkpoint, capture))
	}

	@Test
	fun `a single-colour capture is refused whether recording or not`() {
		val flat = PixelBitmap(width = 2, height = 1, argb = intArrayOf(0, 0))

		assertEquals(CheckpointOutcome.Flat, baselines(isRecording = true).settle(checkpoint, flat))
		assertEquals(CheckpointOutcome.Flat, baselines(isRecording = false).settle(checkpoint, flat))
	}
}
