package com.readplace.android.app

/**
 * The star a hand-over leaves in the sky, or none until there is both a hand-over
 * and a sky panel measured to strike.
 */
fun skyVisits(handoff: SloganHandoff?, sky: WaveRect?): List<StarVisit> {
	if (handoff == null || sky == null) return emptyList()
	return listOf(handoff.visit(sky))
}

/**
 * The comet for the current moment, composed from the measured landmarks. It is
 * idle until there is a hand-over and both landmarks have been reported, because
 * its landing and its launch are derived from the moving storm inside the sky
 * panel — a comet drawn before the panel is measured could not land on the star it
 * creates. The launch point is where a star fired at the landing leaves the sky.
 */
fun loginComet(
	handoff: SloganHandoff?,
	sky: WaveRect?,
	subtitle: WaveRect?,
	seed: ULong,
	screenSize: WaveSize,
	elapsed: Double,
): SloganComet {
	if (handoff == null || sky == null || subtitle == null) return SloganComet.idle
	val field = CosmicWaveField(seed = seed, zone = CosmicZone.ABOVE_BRAND)
	return handoff.comet(
		elapsed = elapsed,
		subtitleCenter = WavePoint(x = subtitle.x + subtitle.width / 2, y = subtitle.y + subtitle.height / 2),
		sky = sky,
		launch = field.visitHead(handoff.visit(sky), zoneFrame = sky, screenSize = screenSize),
	)
}
