package lat.devdj.codex.watch

import android.app.Application
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.wear.compose.material3.MaterialTheme
import org.json.JSONObject
import org.junit.*
import org.junit.Assert.*

/** An unpaired watch shows its code with a fixture transport; no server is contacted. */
class PairingTest {
    @get:Rule val compose = createComposeRule()
    private lateinit var store: WatchStore
    @Before fun setup() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as Application
        store = WatchStore(app); store.clear()
        val model = WatchViewModel(app, object : WatchApi(store) {
            override suspend fun call(path: String, body: JSONObject?, authenticated: Boolean) =
                JSONObject().put("secret", "fixture").put("code", "ABCD2345").put("expires", System.currentTimeMillis() / 1000 + 300)
        })
        compose.setContent { MaterialTheme { WatchApp(model) } }
        model.retryPair()
    }
    @After fun cleanup() { store.clear() }
    @Test fun codeAndInstructionsFitTheRoundScreen() {
        compose.waitUntil(10000) { compose.onAllNodesWithText("ABCD 2345").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Tu agente, aquí").assertIsDisplayed()
        compose.onNodeWithText("El código dura 5 minutos").assertExists()
        compose.waitForIdle(); Thread.sleep(350)
        val instrument = InstrumentationRegistry.getInstrumentation()
        java.io.File(instrument.targetContext.getExternalFilesDir(null), "pair.png").outputStream().use {
            instrument.uiAutomation.takeScreenshot().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
        }
    }
}
