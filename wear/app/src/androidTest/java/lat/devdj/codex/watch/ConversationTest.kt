package lat.devdj.codex.watch

import android.app.Application
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.wear.compose.material3.MaterialTheme
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.*
import org.junit.Assert.*

/** Isolated transport fixture: never connects to a production model or changes real tasks. */
class ConversationTest {
    @get:Rule val compose = createComposeRule()
    private lateinit var model: WatchViewModel
    private lateinit var fake: FixtureApi
    private lateinit var store: WatchStore
    @Before fun setup() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as Application
        store = WatchStore(app); store.clear(); store.write("token", "fixture-only")
        fake = FixtureApi(store)
        model = WatchViewModel(app, fake)
        compose.setContent { MaterialTheme { WatchApp(model) } }
    }
    @After fun cleanup() { store.clear() }
    private fun capture(name: String) {
        compose.waitForIdle()
        // Let the test host's launch animation finish before capturing the compositor.
        Thread.sleep(350)
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val target = java.io.File(instrumentation.targetContext.getExternalFilesDir(null), "$name.png")
        target.outputStream().use {instrumentation.uiAutomation.takeScreenshot().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)}
    }
    private fun below(text: String) = compose.onNodeWithText(text).performScrollTo()
    private fun tap(description: String) = compose.onNodeWithContentDescription(description).performScrollTo().performClick()
    @Test fun homeStartsWithTheAgentAndKeepsEverythingElseBelowTheFold() {
        compose.onNodeWithText("Aquí estoy").assertIsDisplayed()
        compose.onNodeWithContentDescription("Hablar con el agente general").assertIsDisplayed()
        compose.onNodeWithText("Última tarea").assertIsNotDisplayed()
        capture("agent-home")
        below("¿Qué proyectos tenemos?").performClick()
        compose.waitUntil(10000) { fake.requests.isNotEmpty() && !model.ui.value.busy }
        assertEquals(1, fake.accepted.size)
        assertTrue(fake.requests.first().getString("text").contains("proyectos"))
        // Back up to the agent to see and hear the answer.
        compose.waitUntil(10000) { compose.onAllNodesWithContentDescription("Hablar con el agente general").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithContentDescription("Hablar con el agente general").assertIsDisplayed()
        below("Escribir").performClick()
        compose.onNodeWithContentDescription("Mensaje al agente").performTextInput("Revisa alpha")
        capture("agent-review")
        tap("Enviar")
        compose.waitUntil(10000) { fake.requests.size == 2 && !model.ui.value.busy }
    }
    @Test fun homeShowsWhatEachCodingAgentHasLeftAndTheNewestNotice() {
        runBlocking { model.loadHome(); model.loadQuota() }
        compose.onNodeWithText("72%").assertIsDisplayed()
        compose.onNodeWithText("90%").assertIsDisplayed()
        compose.onNodeWithText("alpha · Actualizar tienda").assertIsDisplayed()
        capture("agent-status")
        compose.onNodeWithContentDescription("Cuota de tus agentes", substring = true).performClick()
        compose.onNodeWithText("5 horas · 72% libre").assertExists()
        compose.onNodeWithText("Semanal · 40% libre").assertExists()
        compose.onNodeWithText("Ahora conviene Codex").assertExists()
        capture("agent-quota")
    }
    @Test fun swipingRightGoesBackJustLikeAnyOtherWearApp() {
        runBlocking { model.loadHome(); model.loadQuota() }
        compose.onNodeWithContentDescription("Cuota de tus agentes", substring = true).performClick()
        compose.onNodeWithText("Cuota").assertIsDisplayed()
        compose.onRoot().performTouchInput { swipeRight() }
        compose.waitUntil(10000) { model.nav.stack.size == 1 }
        compose.onNodeWithText("Aquí estoy").assertIsDisplayed()
        // The first screen leaves the gesture to the system, so the stack never goes empty.
        compose.onRoot().performTouchInput { swipeRight() }
        compose.waitForIdle()
        assertEquals(1, model.nav.stack.size)
    }
    @Test fun theDraggedScreenRevealsTheOneItCameFrom() {
        runBlocking { model.loadHome(); model.loadQuota() }
        compose.onNodeWithContentDescription("Cuota de tus agentes", substring = true).performClick()
        compose.onNodeWithText("Cuota").assertIsDisplayed()
        compose.onRoot().performTouchInput { down(Offset(8f, centerY)); moveBy(Offset(width * 0.45f, 0f)) }
        capture("agent-swipe")
        compose.onNodeWithText("Aquí estoy").assertExists()
        compose.onRoot().performTouchInput { moveBy(Offset(width * 0.4f, 0f)); up() }
        compose.waitUntil(10000) { model.nav.stack.size == 1 }
    }
    @Test fun aVoiceTurnLeavesAtOnceAnswersInstantlyAndCanBeStopped() {
        runBlocking { model.refresh() }
        compose.runOnIdle { model.ask("¿Cómo va la tienda?") }
        compose.waitUntil(10000) { fake.accepted.isNotEmpty() && !model.ui.value.busy }
        assertEquals("¿Cómo va la tienda?", fake.requests.single().getString("text"))
        compose.onNodeWithText("Ok, buscando.").assertIsDisplayed()
        fake.state = "working"; fake.speech = "Va, reviso la tienda. Está en línea"
        runBlocking { model.refresh() }
        // Live caption: the newest words, even before their sentence ends.
        compose.onNodeWithText("Está en línea").assertIsDisplayed()
        capture("agent-working")
        compose.onNodeWithContentDescription("Detener").performClick()
        compose.waitUntil(10000) { fake.actions.isNotEmpty() }
        val stop = fake.actions.single()
        assertEquals(listOf("tasks", "stop", "fixture", "true"), listOf(stop.getString("tool"), stop.getString("action"), stop.getString("id"), stop.get("confirmed").toString()))
        compose.waitUntil(10000) { !model.ui.value.working }
    }
    @Test fun noticesOpenTheirAgentAndTheFullList() {
        runBlocking { model.loadHome() }
        below("Actualizar tienda").performClick()
        compose.waitUntil(10000) { model.nav.top is Dest.Tool }
        assertEquals(WatchRoute("agent", "alpha"), (model.nav.top as Dest.Tool).route)
        compose.onRoot().performTouchInput { swipeRight() }
        compose.waitUntil(10000) { model.nav.top is Dest.Home }
        below("Ver todos").performClick()
        compose.onNodeWithText("Avisos").assertIsDisplayed()
        capture("agent-alerts")
    }
    @Test fun offlineRetryPreservesDraftAndReusesRequestIdentity() {
        fake.fail = true
        below("Escribir").performClick()
        compose.onNodeWithContentDescription("Mensaje al agente").performTextInput("Trabaja en alpha")
        tap("Enviar")
        compose.waitUntil(10000) { model.ui.value.pending && !model.ui.value.busy }
        assertEquals("Trabaja en alpha", store.read("draft"))
        assertEquals("No pude confirmar el envío", model.ui.value.error)
        capture("agent-offline")
        val id = fake.requests.first().getString("request_id")
        fake.fail = false
        below("Reintentar envío").performClick()
        below("Reintentar envío").performClick()
        compose.waitUntil(10000) { !model.ui.value.pending && !model.ui.value.busy }
        assertEquals(id, fake.requests.last().getString("request_id"))
        assertEquals(1, fake.accepted.size)
        assertEquals("", store.read("draft"))
    }
    @Test fun latestTaskQuestionGoesThroughTheSameGeneralAgent() {
        below("Última tarea").performClick()
        compose.waitUntil(10000) { fake.requests.isNotEmpty() && !model.ui.value.busy }
        assertTrue(fake.requests.single().getString("text").contains("proyecto y su estado"))
    }
    @Test fun realStateAndResponseReplaceActivityAndSurviveRecreation() {
        runBlocking { model.refresh() }
        compose.onNodeWithText("Aquí estoy").assertIsDisplayed()
        fake.state = "working"; fake.reply = ""
        runBlocking {model.refresh()}
        compose.onNodeWithText("Leyendo").assertIsDisplayed()
        fake.state = "idle"; fake.reply = "La tienda alpha ya está lista."
        runBlocking {model.refresh()}
        compose.onNodeWithText(fake.reply).assertIsDisplayed().performClick()
        compose.onNodeWithText("Tu respuesta").assertIsDisplayed()
        capture("agent-reply")
        val restored = WatchViewModel(InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as Application, fake)
        assertEquals(fake.reply, restored.ui.value.reply)
        assertTrue(restored.ui.value.linked)
    }
    @Test fun revokedCredentialClearsLocalDataAndRequiresPairing() {
        runBlocking {model.refresh()}
        fake.revoked = true
        runBlocking {model.refresh()}
        compose.onNodeWithText("Tu agente, aquí").assertIsDisplayed()
        assertFalse(model.ui.value.linked)
        assertEquals("", store.read("token"))
        assertNull(store.json("snapshot"))
    }
}

private class FixtureApi(store: WatchStore) : WatchApi(store) {
    @Volatile var state = "idle"
    @Volatile var reply = "La última tarea es actualizar alpha."
    @Volatile var fail = false
    @Volatile var revoked = false
    @Volatile var speech = ""
    val requests = java.util.concurrent.CopyOnWriteArrayList<JSONObject>()
    val actions = java.util.concurrent.CopyOnWriteArrayList<JSONObject>()
    val accepted = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()
    override suspend fun call(path: String, body: JSONObject?, authenticated: Boolean): JSONObject {
        if (revoked) throw ApiError(401, "Vuelve a vincular el reloj")
        val now = System.currentTimeMillis() / 1000
        return when {
            path == "/api/wear/send" -> {
                val data = requireNotNull(body); requests.add(JSONObject(data.toString()))
                if (fail) throw ApiError(503, "No pude confirmar el envío")
                accepted.add(data.getString("request_id")); state = "queued"
                JSONObject().put("task", JSONObject().put("id", "fixture"))
            }
            path == "/api/wear/action" -> { actions.add(JSONObject(requireNotNull(body).toString())); state = "idle"; JSONObject().put("message", "Petición detenida") }
            path.startsWith("/api/wear/state") -> JSONObject().put("state", state).put("activity", "Leyendo").put("reply", reply)
                .put("speech", speech).put("run_id", "run-fixture").put("version", (state + speech + reply).hashCode().toString())
                .put("updated_at", now).put("notifications", "attention")
                .put("task", JSONObject().put("id", "fixture").put("status", if (state == "queued") "espera" else if (state == "working") "working" else "terminado")
                    .put("title", "¿Cómo va la última tarea?"))
                .put("last_task", JSONObject().put("project", "alpha").put("title", "Actualizar tienda").put("status", "working"))
            path == "/api/wear/view?view=home" -> JSONObject("""{"working":[],"queued":0,"projects":1,"approvals":0,"recent":[
                {"kind":"terminado","project":"alpha","title":"Actualizar tienda","provider":"claude","at":${now - 300}}]}""")
            path.startsWith("/api/wear/view?view=quota") -> JSONObject("""{"claude":{"state":"ok","windows":[{"minutes":300,"used":28,"resets_at":${now + 3600}},{"minutes":10080,"used":60,"resets_at":${now + 90000}}]},
                "codex":{"state":"ok","windows":[{"minutes":300,"used":10,"resets_at":${now + 7200}}]},"stale":false}""")
            else -> JSONObject().put("ok", true)
        }
    }
}
