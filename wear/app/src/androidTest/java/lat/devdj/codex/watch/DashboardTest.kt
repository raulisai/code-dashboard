package lat.devdj.codex.watch

import android.app.Application
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.wear.compose.material3.MaterialTheme
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.*
import org.junit.Assert.*

class DashboardTest {
    @get:Rule val compose = createComposeRule()
    private lateinit var api: DashboardFixture
    private lateinit var store: WatchStore
    private lateinit var model: WatchViewModel
    @Before fun setup() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as Application
        store = WatchStore(app); store.clear(); store.write("token", "fixture-only")
        api = DashboardFixture(store)
        model = WatchViewModel(app, api)
        compose.setContent { MaterialTheme { WatchApp(model) } }
        runBlocking { model.loadHome(); model.loadQuota() }
    }
    @After fun cleanup() { store.clear() }
    private fun click(text: String) { compose.onNodeWithText(text).performScrollTo().performClick() }
    private fun tap(description: String) { compose.onNodeWithContentDescription(description).performScrollTo().performClick() }
    private fun openProject() { tap("Proyectos"); compose.waitUntil(10000) { api.views.contains("projects") }; click("alpha"); compose.waitUntil(10000) { api.views.contains("project") } }
    private fun screenshot(name: String) {
        compose.waitForIdle(); Thread.sleep(350)
        val instrument = InstrumentationRegistry.getInstrumentation()
        java.io.File(instrument.targetContext.getExternalFilesDir(null), "$name.png").outputStream().use {
            instrument.uiAutomation.takeScreenshot().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
        }
    }
    @Test fun homeShowsQuotaAndProjectsExposeNativeLogsAndTerminal() {
        compose.onNodeWithText("75%").assertExists()
        screenshot("dashboard-home")
        openProject(); screenshot("dashboard-project")
        click("Logs"); compose.waitUntil(10000) { api.views.contains("logs") }
        compose.onNodeWithText("Texto: Servicio iniciado").assertExists()
        screenshot("dashboard-logs")
        tap("Volver"); click("Terminal"); compose.waitUntil(10000) { api.views.contains("terminal") }
        compose.onNodeWithText("ready $ ").assertExists()
        screenshot("dashboard-terminal")
        assertEquals(0, api.actions.size)
    }
    @Test fun swipingRightWalksBackThroughEveryToolScreen() {
        openProject()
        click("Archivos"); compose.waitUntil(10000) { api.views.contains("files") }
        compose.onNodeWithText("README.md").assertExists()
        compose.onRoot().performTouchInput { swipeRight() }
        compose.waitUntil(10000) { (model.nav.top as? Dest.Tool)?.route?.view == "project" }
        compose.onRoot().performTouchInput { swipeRight() }
        compose.waitUntil(10000) { (model.nav.top as? Dest.Tool)?.route?.view == "projects" }
        compose.onRoot().performTouchInput { swipeRight() }
        compose.waitUntil(10000) { model.nav.top is Dest.Home }
        // Home remembers where it was scrolled (the dock), like any Wear screen the user comes back to.
        compose.onNodeWithText("Aquí estoy").assertExists()
    }
    @Test fun leavingAReviewScreenWithTheGestureCancelsWithoutSendingAnything() {
        openProject(); click("Terminal"); click("Enviar comando")
        compose.onNodeWithContentDescription("Comando a ejecutar").performTextInput("pwd")
        compose.onRoot().performTouchInput { swipeRight() }
        compose.waitUntil(10000) { (model.nav.top as? Dest.Tool)?.route?.view == "terminal" }
        assertTrue(api.actions.isEmpty())
    }
    @Test fun terminalCommandRequiresReviewAndConfirmation() {
        openProject(); click("Terminal"); click("Enviar comando")
        compose.onNodeWithContentDescription("Comando a ejecutar").performTextInput("pwd")
        assertTrue(api.actions.isEmpty())
        click("Revisar"); assertTrue(api.actions.isEmpty())
        screenshot("dashboard-confirm")
        click("Confirmar"); compose.waitUntil(10000) { api.actions.isNotEmpty() }
        assertEquals("pwd", api.actions.single().getString("command"))
        assertEquals("alpha", api.actions.single().getString("project"))
        assertTrue(api.actions.single().getBoolean("confirmed"))
        compose.waitUntil(10000) { model.nav.top is Dest.Tool }
        compose.onNodeWithText("Listo").assertExists()
    }
    @Test fun fileEditorCarriesVersionAndDoesNotWriteOnBrowse() {
        openProject(); click("Archivos"); compose.waitUntil(10000) { api.views.contains("files") }
        click("README.md"); compose.waitUntil(10000) { api.views.contains("file") }
        compose.onNodeWithText("# alpha").assertExists()
        click("Editar archivo")
        compose.onNodeWithContentDescription("Contenido").performTextReplacement("# Nueva versión")
        click("Revisar"); assertTrue(api.actions.isEmpty())
        click("Confirmar"); compose.waitUntil(10000) { api.actions.isNotEmpty() }
        assertEquals("version-1", api.actions.single().getString("mtime"))
        assertEquals("README.md", api.actions.single().getString("path"))
    }
    @Test fun projectChatOfflineRetryKeepsIdentityAndDestination() {
        openProject(); click("Agente"); compose.waitUntil(10000) { api.views.contains("chats") }
        click("Chat principal"); click("Escribir al agente")
        compose.onNodeWithContentDescription("Mensaje del proyecto").performTextInput("Revisa el proyecto")
        click("Codex"); api.failSend = true; click("Enviar")
        compose.waitUntil(10000) { api.sent.isNotEmpty() }
        compose.onNodeWithText("No pude confirmar el envío").assertExists()
        val id = api.sent.first().getString("request_id")
        api.failSend = false; click("Reintentar envío")
        compose.waitUntil(10000) { api.sent.size == 2 }
        assertEquals(id, api.sent.last().getString("request_id"))
        assertEquals("alpha", api.sent.last().getString("project"))
        assertEquals("main", api.sent.last().getString("chat_id"))
        assertEquals("codex", api.sent.last().getString("provider"))
        assertNull(store.json("project-outbox-alpha-main"))
    }
    @Test fun settingsRequireConfirmationAndKeepNotificationsAccessible() {
        tap("Ajustes"); compose.waitUntil(10000) { api.views.contains("settings") }
        compose.onNodeWithText("Avisos").assertExists()
        click("codex"); click("Revisar"); assertTrue(api.actions.isEmpty())
        click("Confirmar"); compose.waitUntil(10000) { api.actions.isNotEmpty() }
        assertEquals("settings", api.actions.single().getString("tool"))
        assertEquals("codex", api.actions.single().getString("default_provider"))
    }
}

private class DashboardFixture(store: WatchStore) : WatchApi(store) {
    val views = java.util.concurrent.CopyOnWriteArrayList<String>()
    val actions = java.util.concurrent.CopyOnWriteArrayList<JSONObject>()
    val sent = java.util.concurrent.CopyOnWriteArrayList<JSONObject>()
    @Volatile var failSend = false
    override suspend fun call(path: String, body: JSONObject?, authenticated: Boolean): JSONObject {
        if (path == "/api/wear/action") { actions.add(JSONObject(requireNotNull(body).toString())); return JSONObject("{\"message\":\"Listo\"}") }
        if (path == "/api/wear/send") {
            sent.add(JSONObject(requireNotNull(body).toString()))
            if (failSend) throw ApiError(503, "No pude confirmar el envío")
            return JSONObject("{\"task\":{\"id\":\"fixture\"}}")
        }
        val view = android.net.Uri.parse("https://fixture" + path).getQueryParameter("view").orEmpty()
        if (view.isNotBlank()) views.add(view)
        return JSONObject(when(view) {
            "home" -> """{"working":[],"queued":1,"projects":1,"approvals":0,"recent":[]}"""
            "quota" -> """{"claude":{"state":"ok","windows":[{"minutes":300,"used":25}]}}"""
            "projects" -> """{"projects":[{"name":"alpha","description":"Tienda"}]}"""
            "project", "containers", "preview" -> """{"name":"alpha","description":"Tienda","running_containers":1,"queued":0,"url":"https://alpha.example.com"}"""
            "logs" -> """{"entries":[{"text":"Servicio iniciado"}]}"""
            "terminal" -> """{"session":"alpha-shell","exists":true,"output":"ready $ "}"""
            "chats" -> """{"chats":[{"id":"main","title":"Chat principal"}]}"""
            "agent" -> """{"runs":[],"tasks":[]}"""
            "files" -> """{"entries":[{"name":"README.md","path":"README.md","type":"file"}],"next":null}"""
            "file" -> """{"path":"README.md","content":"# alpha","mtime":"version-1","truncated":false,"binary":false}"""
            "settings" -> """{"settings":{"default_provider":"claude","claude_permission":"auto","codex_sandbox":"full","auto_commit":"on"}}"""
            else -> "{}"
        })
    }
}
