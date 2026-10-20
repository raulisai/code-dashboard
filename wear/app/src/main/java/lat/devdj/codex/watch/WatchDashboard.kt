package lat.devdj.codex.watch

import android.content.ActivityNotFoundException
import android.content.Intent
import android.speech.RecognizerIntent
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import androidx.wear.compose.material3.Text
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.util.UUID

internal data class WatchRoute(val view: String, val project: String = "", val chat: String = "main", val path: String = "", val extra: String = "")
private data class Input(val key: String, val label: String, val initial: String = "")
private data class Operation(val title: String, val tool: String, val action: String = "", val inputs: List<Input> = emptyList(), val values: Map<String, String> = emptyMap())
private val Accent = Color(0xFF9DE4FF)
private val Muted = Color(0xFF8F9BA8)
private fun JSONArray?.rows(): List<JSONObject> = if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it) }
private fun encoded(value: String) = URLEncoder.encode(value, "UTF-8")
private fun query(route: WatchRoute): String = "/api/wear/view?view=${encoded(route.view)}&project=${encoded(route.project)}&chat_id=${encoded(route.chat)}&path=${encoded(route.path)}" + route.extra

/** Native, demand-loaded tools. No WebView, persistent terminal socket or background polling. */
@Composable internal fun WatchDashboard(model: WatchViewModel, start: String, onAgent: () -> Unit, onNotifications: () -> Unit, onDisconnect: () -> Unit) {
    val stack = remember { mutableStateListOf(WatchRoute(start)) }
    val route = stack.last()
    var data by remember(route) { mutableStateOf<JSONObject?>(null) }
    var quota by remember { mutableStateOf<JSONObject?>(null) }
    var loading by remember(route) { mutableStateOf(false) }
    var error by remember(route) { mutableStateOf("") }
    var message by remember(route) { mutableStateOf("") }
    var revision by remember { mutableIntStateOf(0) }
    var operation by remember(route) { mutableStateOf<Operation?>(null) }
    var executing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    fun navigate(next: WatchRoute) { stack.add(next) }
    fun view(name: String, path: String = "", extra: String = "") { navigate(route.copy(view = name, path = path, extra = extra)) }
    val owner = LocalLifecycleOwner.current
    BackHandler(stack.size > 1 || operation != null) {
        if (!executing) { if (operation != null) operation = null else stack.removeAt(stack.lastIndex) }
    }
    suspend fun load() {
        loading = true; error = ""
        try {
            val target = if (route.view == "overview") route.copy(view = "home") else route
            if (route.view !in setOf("compose", "tools", "select-commit")) data = model.dashboardCall(query(target))
        } catch (failure: Exception) {
            if (failure is CancellationException) throw failure
            error = failure.message ?: "No pude actualizar esta vista"
        } finally { loading = false }
    }
    LaunchedEffect(route, revision) {
        owner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            load()
            // Only the open agent chat follows active work; all other tools refresh explicitly.
            if (route.view in setOf("agent", "overview")) {
                var failures = 0
                while (true) {
                    delay(if (route.view == "overview") 10000 else 6000)
                    val active = if (route.view == "overview") data?.optJSONArray("working").rows().isNotEmpty() else data?.optJSONArray("tasks").rows().any { it.optString("status") in setOf("working", "espera") }
                    if (error.isNotBlank()) failures++ else failures = 0
                    if (!active || failures >= 3) break
                    load()
                }
            }
        }
    }
    // Independent quota request never holds up the work summary or navigation.
    LaunchedEffect(route.view, revision) {
        if (route.view == "overview") owner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            try { quota = model.dashboardCall("/api/wear/view?view=quota") }
            catch (failure: Exception) { if (failure is CancellationException) throw failure; quota = JSONObject().put("stale", true) }
        }
    }
    if (route.view == "compose") {
        ProjectComposer(model, route) { stack.removeAt(stack.lastIndex); revision++ }
        return
    }
    val op = operation
    if (op != null) {
        val fields = remember(op) { op.inputs.associate { it.key to mutableStateOf(it.initial) } }
        var reviewed by remember(op) { mutableStateOf(false) }
        ScrollPage(resetKey = op.title) {
            Heading(op.title)
            Note(route.project.ifBlank { "Dashboard" })
            if (!reviewed) {
                for (input in op.inputs) {
                    Note(input.label)
                    Field(fields.getValue(input.key).value, input.label, !executing) { fields.getValue(input.key).value = it }
                }
                Action("Revisar", !executing) { reviewed = true; error = "" }
            } else {
                Note("Se aplicará en el servidor")
                for (input in op.inputs) Note(input.label + ": " + fields.getValue(input.key).value)
                Action(if (executing) "Aplicando…" else "Confirmar", !executing) {
                    executing = true; error = ""
                    scope.launch {
                        try {
                            val body = JSONObject().put("tool", op.tool).put("action", op.action).put("confirmed", true)
                                .put("project", route.project).put("chat_id", route.chat)
                            for ((key, value) in op.values) body.put(key, value)
                            for ((key, value) in fields) body.put(key, value.value)
                            val result = model.dashboardCall("/api/wear/action", body)
                            message = result.optString("message", "Listo"); operation = null; revision++
                        } catch (failure: Exception) {
                            if (failure is CancellationException) throw failure
                            error = (failure.message ?: "No pude confirmar la acción") + ". Actualiza antes de repetirla."
                        } finally { executing = false }
                    }
                }
                Action("Editar", !executing, subtle = true) { reviewed = false }
            }
            ErrorText(error)
            Action("Cancelar", !executing, subtle = true) { operation = null; error = "" }
        }
        return
    }
    ScrollPage(resetKey = route.toString()) {
        when (route.view) {
            "overview" -> {
                Heading("Inicio")
                val claude = quota?.optJSONObject("claude")
                Text("Claude Code", fontSize = 15.sp, color = Accent)
                if (quota == null) Note("Consultando cuota…")
                else {
                    val windows = claude?.optJSONArray("windows").rows()
                    if (windows.isEmpty()) Note("Cuota no disponible")
                    for (window in windows) {
                        val minutes = window.optInt("minutes")
                        Note((if (minutes <= 300) "5 horas" else "Semanal") + ": " + (100 - window.optDouble("used")).toInt() + "% libre")
                        val reset = window.optDouble("resets_at", 0.0).toLong()
                        if (reset > 0) Note("Renueva " + android.text.format.DateFormat.format("dd/MM HH:mm", reset * 1000))
                    }
                    if (quota?.optBoolean("stale") == true) Note("Cuota sin actualizar")
                }
                val working = data?.optJSONArray("working").rows()
                if (working.isEmpty()) Note(if (loading) "Consultando actividad…" else "Sin tareas en ejecución")
                for (task in working) Action(task.optString("project") + " · " + task.optString("title")) {
                    if (task.optString("project") == "_general") onAgent() else navigate(WatchRoute("agent", task.optString("project"), task.optString("chat_id", "main")))
                }
                if (data != null) Note("${data!!.optInt("queued")} en cola · ${data!!.optInt("projects")} proyectos")
                Action("Agente general", onClick = onAgent)
                Action("Proyectos") { navigate(WatchRoute("projects")) }
                Action("Configuración") { navigate(WatchRoute("settings")) }
                Action("Aprobaciones") { navigate(WatchRoute("approvals")) }
                Action("Servidor") { navigate(WatchRoute("server")) }
            }
            "projects" -> {
                Heading("Proyectos")
                var filter by remember { mutableStateOf("") }
                Field(filter, "Buscar proyecto") { filter = it }
                val projects = data?.optJSONArray("projects").rows().filter { it.optString("name").contains(filter, true) || it.optString("description").contains(filter, true) }
                if (!loading && projects.isEmpty()) Note("Sin proyectos para mostrar")
                for (project in projects) Action(project.optString("name")) { navigate(WatchRoute("project", project.optString("name"))) }
                if (data != null && !data!!.isNull("next")) Action("Más proyectos") { view("projects", extra = "&offset=${data!!.optInt("next")}") }
                Action("Nuevo proyecto") { operation = Operation("Crear proyecto", "projects", "create", listOf(Input("name", "Nombre del proyecto"), Input("description", "Qué quieres construir"), Input("repo_url", "Repositorio Git (opcional)"))) }
                Action("Papelera") { navigate(WatchRoute("trash")) }
            }
            "project" -> {
                Heading(route.project)
                Note(data?.optString("description").orEmpty())
                if (data != null) Note("${data!!.optInt("running_containers")} servicios activos · ${data!!.optInt("queued")} en cola")
                Action("Agente") { view("chats") }
                Action("Peticiones") { view("tasks") }
                Action("Logs") { view("logs", extra = "&tail=60") }
                Action("Terminal") { view("terminal", extra = "&kind=shell") }
                Action("Archivos") { view("files") }
                Action("Versiones · Git") { view("git") }
                Action("Despliegues") { view("jobs") }
                Action("Contenedores") { view("containers") }
                Action("Vista previa") { view("preview") }
                Action("Más herramientas") { view("tools") }
            }
            "chats" -> {
                Heading("Agente · ${route.project}")
                for (chat in data?.optJSONArray("chats").rows()) Action(chat.optString("title") + if (chat.optInt("working") > 0) " · trabajando" else "") {
                    navigate(route.copy(view = "agent", chat = chat.optString("id")))
                }
                Action("Nuevo chat") { operation = Operation("Nuevo chat", "chats", "create", listOf(Input("title", "Nombre del chat"))) }
            }
            "agent" -> {
                Heading(route.project)
                Note(if (route.chat == "main") "Chat principal" else "Chat del proyecto")
                for (task in data?.optJSONArray("tasks").rows().filter { it.optString("status") in setOf("working", "espera") }) Note(task.optString("status") + " · " + task.optString("title"))
                Action("Escribir al agente") { view("compose") }
                for (run in data?.optJSONArray("runs").rows().asReversed()) {
                    Note(run.optString("prompt", run.optString("title")))
                    val result = run.optJSONObject("result")?.optString("text").orEmpty()
                    if (result.isNotBlank()) Text(result, fontSize = 13.sp)
                    if (run.optString("error").isNotBlank()) ErrorText(run.optString("error"))
                    val events = run.optJSONArray("events").rows().takeLast(8)
                    for (event in events) Note(event.optString("name", event.optString("text", event.optString("t"))).take(600))
                    Action("Ver actividad") { view("run", extra = "&run_id=${encoded(run.optString("id"))}") }
                }
                Action("Peticiones y detener") { view("tasks") }
                Action("Aprobaciones") { navigate(WatchRoute("approvals")) }
                Action("Renombrar chat", route.chat != "main") { operation = Operation("Renombrar chat", "chats", "rename", listOf(Input("title", "Nuevo nombre"))) }
                Action(if (route.chat == "main") "Vaciar chat" else "Eliminar chat") { operation = Operation("Borrar conversación", "chats", "delete") }
                for (provider in listOf("claude", "codex")) Action("Reiniciar $provider") { operation = Operation("Reiniciar contexto $provider", "reset", values = mapOf("provider" to provider)) }
            }
            "tasks" -> {
                Heading("Peticiones")
                for (task in data?.optJSONArray("tasks").rows()) {
                    Text(task.optString("title"), color = Accent, fontSize = 13.sp)
                    Note(task.optString("status"))
                    val active = task.optString("status") == "working"
                    Action(if (active) "Detener" else "Reintentar") { operation = Operation(if (active) "Detener petición" else "Reintentar petición", "tasks", if (active) "stop" else "retry", values = mapOf("id" to task.optString("id"))) }
                    if (!active) Action("Eliminar petición") { operation = Operation("Eliminar petición", "tasks", "delete", values = mapOf("id" to task.optString("id"))) }
                }
            }
            "terminal" -> {
                Heading("Terminal")
                Note(data?.optString("session").orEmpty())
                if (data?.optBoolean("exists") == false) Note("Sesión todavía no iniciada")
                Text(data?.optString("output").orEmpty().ifBlank { "Sin salida" }, fontSize = 11.sp)
                Action("Enviar comando") { operation = Operation("Enviar a terminal", "terminal", inputs = listOf(Input("command", "Comando a ejecutar")), values = mapOf("kind" to route.extra.substringAfter("kind=", "shell"))) }
                for (kind in listOf("shell", "claude", "codex")) Action("Ver $kind") { view("terminal", extra = "&kind=$kind") }
                Action("Cerrar terminal") { operation = Operation("Cerrar sesión", "terminal", "close", values = mapOf("kind" to route.extra.substringAfter("kind=", "shell"))) }
            }
            "files" -> {
                Heading("Archivos")
                Note(route.path.ifBlank { "/" })
                for (entry in data?.optJSONArray("entries").rows()) Action((if (entry.optString("type") == "dir") "▸ " else "") + entry.optString("name")) { view(if (entry.optString("type") == "dir") "files" else "file", entry.optString("path")) }
                if (data != null && !data!!.isNull("next")) Action("Más archivos") { view("files", route.path, "&offset=${data!!.optInt("next")}") }
                Action("Crear archivo") { operation = Operation("Crear archivo", "files", "create", listOf(Input("path", "Ruta", route.path.trimEnd('/') + "/"))) }
                Action("Crear carpeta") { operation = Operation("Crear carpeta", "files", "mkdir", listOf(Input("path", "Ruta", route.path.trimEnd('/') + "/"))) }
                if (route.path.isNotBlank()) FileOperations(route.path) { operation = it }
            }
            "file" -> {
                Heading(route.path.substringAfterLast('/'))
                if (data?.optBoolean("binary") == true) Note("Archivo binario") else Text(data?.optString("content").orEmpty(), fontSize = 11.sp)
                if (data?.optBoolean("truncated") == true || data?.optString("content").orEmpty().contains("… Vista recortada")) Note("Vista recortada; edición desactivada")
                else if (data != null && !data!!.optBoolean("binary")) Action("Editar archivo") { operation = Operation("Guardar archivo", "write", inputs = listOf(Input("content", "Contenido", data!!.optString("content"))), values = mapOf("path" to route.path, "mtime" to data!!.optString("mtime"))) }
                FileOperations(route.path) { operation = it }
            }
            "git" -> {
                Heading("Versiones · Git")
                Details(data)
                Action("Historial") { view("history") }
                Action("Cambios") { view("diff") }
                Action("Ramas") { view("branches") }
                Action("Guardar versión") { operation = Operation("Guardar versión", "git", "commit", listOf(Input("message", "Descripción del cambio"))) }
                Action("Deshacer último cambio") { operation = Operation("Deshacer último cambio", "git", "undo") }
                Action("Crear rama") { operation = Operation("Crear rama", "git", "branch-create", listOf(Input("name", "Nombre de rama"))) }
                Action("Restaurar versión") { operation = Operation("Restaurar versión", "git", "restore", listOf(Input("rev", "Identificador de versión"))) }
                Action("Deshacer una versión") { operation = Operation("Deshacer una versión", "git", "revert", listOf(Input("rev", "Identificador de versión"))) }
            }
            "history" -> {
                Heading("Historial")
                Details(data)
                Action("Ver versión") { operation = null; view("select-commit") }
            }
            "select-commit" -> {
                var revisionText by remember { mutableStateOf("") }
                Field(revisionText, "Identificador de versión") { revisionText = it }
                Action("Abrir versión", revisionText.isNotBlank()) { view("commit", extra = "&rev=${encoded(revisionText)}") }
            }
            "branches" -> {
                Heading("Ramas")
                Details(data)
                for ((action, label) in listOf("switch" to "Cambiar rama", "merge" to "Integrar rama", "branch-delete" to "Archivar rama")) Action(label) { operation = Operation(label, "git", action, listOf(Input("name", "Nombre de rama"))) }
            }
            "jobs" -> {
                Heading("Despliegues")
                for ((action, label) in listOf("deploy" to "Desplegar", "restart" to "Reiniciar", "down" to "Detener", "build" to "Compilar", "dev" to "Modo desarrollo")) Action(label) { operation = Operation("$label · ${route.project}", "jobs", action) }
                Details(data)
            }
            "containers" -> {
                Heading("Contenedores")
                for (container in data?.optJSONArray("container_details").rows()) {
                    Text(container.optString("name"), color = Accent, fontSize = 14.sp)
                    Note(container.optString("status"))
                    Action("Ver logs") { view("logs", extra = "&tail=60&container=${encoded(container.optString("id"))}") }
                    for (action in listOf("start", "stop", "restart")) Action(when(action) {"start" -> "Iniciar servicio"; "stop" -> "Detener servicio"; else -> "Reiniciar servicio"}, !container.optBoolean("protected")) { operation = Operation(action + " · " + container.optString("name"), "docker", action, values = mapOf("container" to container.optString("id"))) }
                }
            }
            "preview" -> {
                Heading("Vista previa")
                Note(data?.optString("url").orEmpty())
                Note("La web del proyecto requiere un navegador. En el reloj puedes consultar servicios, logs y despliegues.")
                Action("Servicios") { view("containers") }
            }
            "tools" -> {
                Heading("Más herramientas")
                Action("Destacar / quitar destacado") { operation = Operation("Cambiar destacado", "projects", "toggle_featured", values = mapOf("name" to route.project)) }
                Action("Eliminar proyecto") { view("delete-preview") }
            }
            "delete-preview" -> {
                Heading("Eliminar proyecto")
                Details(data)
                Action("Continuar") { operation = Operation("Mover proyecto a papelera", "projects", "delete", listOf(Input("confirmation", "Escribe el nombre exacto")), mapOf("name" to route.project)) }
            }
            "trash" -> {
                Heading("Papelera")
                Details(data)
                Action("Restaurar proyecto") { operation = Operation("Restaurar proyecto", "projects", "restore", listOf(Input("archive_id", "Identificador del archivo"))) }
            }
            "approvals" -> {
                Heading("Aprobaciones")
                val approvals = data?.optJSONArray("approvals").rows()
                if (!loading && approvals.isEmpty()) Note("Sin aprobaciones pendientes")
                for (approval in approvals) {
                    Details(approval)
                    for ((decision, label) in listOf("allow" to "Permitir", "deny" to "Denegar")) Action(label) { operation = Operation(label + " herramienta", "approval", values = mapOf("run_id" to approval.optString("run_id"), "request_id" to approval.optString("id"), "decision" to decision)) }
                }
            }
            "settings" -> {
                Heading("Configuración")
                Action("Avisos", onClick = onNotifications)
                val settings = data?.optJSONObject("settings")
                if (settings != null) {
                    for ((key, label, options) in listOf(
                        Triple("default_provider", "Agente predeterminado", listOf("claude", "codex")),
                        Triple("claude_permission", "Permisos de Claude", listOf("ask", "auto", "edits")),
                        Triple("codex_sandbox", "Acceso de Codex", listOf("read-only", "workspace", "full")),
                        Triple("auto_commit", "Versiones automáticas", listOf("on", "off")))) {
                        Note(label + ": " + settings.optString(key))
                        for (option in options) Action(option) { operation = Operation("$label: $option", "settings", values = mapOf(key to option)) }
                    }
                    for (provider in listOf("claude", "codex")) Action("Modelo $provider") { operation = Operation("Modelo $provider", "settings", inputs = listOf(Input(provider + "_model", "Modelo (vacío = predeterminado)", settings.optString(provider + "_model")))) }
                }
                Action("Catálogo de modelos") { navigate(WatchRoute("models")) }
                Note("Servidor: ${model.api.origin}")
                Action("Desvincular reloj", onClick = onDisconnect)
            }
            else -> { Heading(when(route.view) {"logs" -> "Logs"; "server" -> "Servidor"; "diff" -> "Cambios"; "commit" -> "Versión"; else -> "Detalles"}); Details(data) }
        }
        if (loading) Note("Actualizando…")
        if (message.isNotBlank()) Note(message)
        ErrorText(error)
        Action("Actualizar", !loading, subtle = true) { revision++ }
        if (stack.size > 1) Action("Volver", subtle = true) { stack.removeAt(stack.lastIndex) }
        else if (route.view != "overview") Action("Inicio", subtle = true) { stack.add(WatchRoute("overview")) }
        if (route.view != "overview") Action("Agente general", subtle = true, onClick = onAgent)
    }
}

@Composable private fun FileOperations(path: String, choose: (Operation) -> Unit) {
    Action("Renombrar / mover") { choose(Operation("Mover archivo", "files", "rename", listOf(Input("to", "Ruta de destino")), mapOf("path" to path))) }
    Action("Eliminar") { choose(Operation("Eliminar $path", "files", "delete", values = mapOf("path" to path))) }
}

@Composable private fun Heading(text: String) { Text(text, color = Accent, fontSize = 17.sp, textAlign = TextAlign.Center) }
@Composable private fun Note(text: String) { if (text.isNotBlank()) Text(text, color = Muted, fontSize = 12.sp, textAlign = TextAlign.Center) }

/** Read-only technical viewers retain full text formatting without JSON syntax. */
@Composable private fun Details(data: Any?, depth: Int = 0) {
    if (depth > 5 || data == null || data == JSONObject.NULL) return
    when (data) {
        is JSONObject -> for (key in data.keys()) {
            val value = data.opt(key)
            if (value == JSONObject.NULL || value == "" || key in setOf("settings", "env", "environment")) continue
            val label = mapOf("output" to "Salida", "entries" to "Registros", "message" to "Mensaje", "content" to "Contenido", "state" to "Estado", "status" to "Estado", "title" to "Petición", "text" to "Texto", "name" to "Nombre", "branch" to "Rama", "subject" to "Cambio", "author" to "Autor", "time" to "Fecha", "project" to "Proyecto", "tool" to "Herramienta")[key] ?: key.replace('_', ' ')
            if (value is JSONObject || value is JSONArray) { Note(label); Details(value, depth + 1) }
            else Text("$label: $value", fontSize = 12.sp)
        }
        is JSONArray -> { if (data.length() == 0) Note("Sin datos"); for (i in 0 until data.length()) Details(data.opt(i), depth + 1) }
        else -> Text(data.toString(), fontSize = 12.sp)
    }
}

@Composable private fun ProjectComposer(model: WatchViewModel, route: WatchRoute, done: () -> Unit) {
    val key = "project-outbox-${route.project}-${route.chat}"
    var pending by remember { mutableStateOf(model.store.json(key)) }
    var text by remember { mutableStateOf(pending?.optString("text") ?: model.store.read("draft-$key")) }
    var provider by remember { mutableStateOf(pending?.optString("provider") ?: "") }
    var chosenModel by remember { mutableStateOf(pending?.optString("model") ?: "") }
    var effort by remember { mutableStateOf(pending?.optString("effort") ?: "") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    DisposableEffect(text) { onDispose { if (pending == null) model.store.write("draft-$key", text) } }
    val dictate = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (pending == null) result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()?.let { text = it.take(4000) }
    }
    ScrollPage {
        Heading("Mensaje · ${route.project}")
        Note(if (pending != null) "Envío por confirmar. Reintenta sin duplicarlo." else "Revisa tu petición")
        Field(text, "Mensaje del proyecto", pending == null && !busy) { text = it.take(4000) }
        if (pending == null) {
            Action("Dictar", !busy) {
                try { dictate.launch(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "es-MX")) }
                catch (_: ActivityNotFoundException) { error = "Dictado no disponible. Puedes escribir." }
            }
            Note("Agente: ${provider.ifBlank { "Predeterminado" }}")
            for ((value, label) in listOf("" to "Predeterminado", "claude" to "Claude Code", "codex" to "Codex")) Action(label, !busy) { provider = value; chosenModel = ""; effort = "" }
            Note("Modelo opcional")
            Field(chosenModel, "Modelo", !busy) { chosenModel = it }
            Note("Esfuerzo opcional")
            Field(effort, "Esfuerzo", !busy) { effort = it }
        }
        ErrorText(error)
        Action(if (busy) "Enviando…" else if (pending != null) "Reintentar envío" else "Enviar", text.isNotBlank() && !busy) {
            val body = pending ?: JSONObject().put("request_id", UUID.randomUUID().toString()).put("text", text.trim())
                .put("project", route.project).put("chat_id", route.chat).put("provider", provider).put("model", chosenModel).put("effort", effort)
            // Durable before transport, scoped to exact project/chat/provider/model/text.
            model.store.write(key, body.toString()); pending = body; busy = true; error = ""
            scope.launch {
                try {
                    model.dashboardCall("/api/wear/send", body)
                    model.store.remove(key); model.store.remove("draft-$key"); text = ""; done()
                } catch (failure: Exception) {
                    if (failure is CancellationException) throw failure
                    if (failure is ApiError && failure.status in setOf(400, 403, 404, 409, 413, 429)) { model.store.remove(key); pending = null }
                    error = failure.message ?: "No pude confirmar el envío"
                } finally { busy = false }
            }
        }
        Action("Volver", !busy, subtle = true, onClick = done)
    }
}
