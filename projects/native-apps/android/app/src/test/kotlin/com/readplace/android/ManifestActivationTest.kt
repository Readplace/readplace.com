package com.readplace.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.w3c.dom.Element

/**
 * The Android analogue of the iOS `ActivationRuleTests`, which evaluates the share
 * extension's `NSExtensionActivationRule` from its own Info.plist. Here the same
 * contract lives in the manifest: which intents put Readplace in the system share
 * sheet, and which URL the OAuth redirect comes back on.
 *
 * It also pins the thing that has no compiler behind it at all — a manifest names
 * its activities by string, and AGP only *warns* when one names a class that does
 * not exist, so a share sheet can advertise Readplace with nothing behind it and
 * crash on `ClassNotFoundException` at launch. The build stays green either way.
 */
class ManifestActivationTest {
	private val namespace = "com.readplace.android"
	private val android = "http://schemas.android.com/apk/res/android"

	private val manifest: Element by lazy {
		val file = File("src/main/AndroidManifest.xml")
		assertTrue("manifest must exist at ${file.absolutePath}", file.isFile)
		DocumentBuilderFactory.newInstance()
			.apply { isNamespaceAware = true }
			.newDocumentBuilder()
			.parse(file)
			.documentElement
	}

	private fun activities(): List<Element> {
		val nodes = manifest.getElementsByTagName("activity")
		return (0 until nodes.length).mapNotNull { nodes.item(it) as? Element }
	}

	private fun Element.androidAttr(name: String): String? =
		getAttributeNS(android, name).takeIf { it.isNotEmpty() }

	/** `.share.ShareActivity` → `com.readplace.android.share.ShareActivity`. */
	private fun qualified(name: String): String =
		if (name.startsWith(".")) "$namespace$name" else name

	private fun sourceFileFor(qualifiedName: String): File =
		File("src/main/kotlin/${qualifiedName.replace('.', '/')}.kt")

	@Test
	fun `every activity the manifest declares has a class behind it`() {
		val missing = activities()
			.mapNotNull { it.androidAttr("name") }
			.map { qualified(it) }
			.filterNot { sourceFileFor(it).isFile }

		assertEquals(
			"the manifest names these activities but no Kotlin file defines them; Android " +
				"resolves an activity class at launch, so each one is a crash waiting for the " +
				"intent that starts it",
			emptyList<String>(),
			missing,
		)
	}

	@Test
	fun `the launcher activity is the one the emulator recipe starts`() {
		val launcher = activities().single { activity ->
			activity.getElementsByTagName("category").let { categories ->
				(0 until categories.length).any {
					(categories.item(it) as? Element)?.androidAttr("name") ==
						"android.intent.category.LAUNCHER"
				}
			}
		}

		assertEquals("com.readplace.android.app.MainActivity", qualified(launcher.androidAttr("name").orEmpty()))
	}

	@Test
	fun `the OAuth redirect comes back on this app's own callback URL`() {
		// The server matches redirect_uri by exact string per client, so these three
		// parts ARE the registration: a drift here breaks sign-in with no compile error,
		// and reusing the iPhone app's path would let either app redeem the other's code.
		val data = manifest.getElementsByTagName("data").let { nodes ->
			(0 until nodes.length)
				.mapNotNull { nodes.item(it) as? Element }
				.single { it.androidAttr("scheme") == "readplace" }
		}

		assertEquals("readplace", data.androidAttr("scheme"))
		assertEquals("oauth-callback", data.androidAttr("host"))
		assertEquals("/android", data.androidAttr("path"))
	}

	@Test
	fun `the callback intent filter is browsable, or the browser cannot hand the code back`() {
		val filter = manifest.getElementsByTagName("intent-filter").let { nodes ->
			(0 until nodes.length)
				.mapNotNull { nodes.item(it) as? Element }
				.single { element ->
					element.getElementsByTagName("data").let { data ->
						(0 until data.length).any {
							(data.item(it) as? Element)?.androidAttr("scheme") == "readplace"
						}
					}
				}
		}

		val categories = filter.getElementsByTagName("category").let { nodes ->
			(0 until nodes.length).mapNotNull { (nodes.item(it) as? Element)?.androidAttr("name") }
		}
		assertTrue(
			"a redirect arriving from the browser needs BROWSABLE",
			categories.contains("android.intent.category.BROWSABLE"),
		)
		assertTrue(categories.contains("android.intent.category.DEFAULT"))
	}
}
