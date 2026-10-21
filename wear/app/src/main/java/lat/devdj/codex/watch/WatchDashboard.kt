package lat.devdj.codex.watch

import android.content.ActivityNotFoundException
import android.content.Intent
import android.speech.RecognizerIntent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.runtime.*
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewModelScope
import androidx.wear.compose.material3.Text
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.util.UUID

internal data class WatchRoute(val view: String, val project: String = "", val chat: String = "main", val path: String = "", val extra: String = "")
internal data class Input(val key: String, val label: String, val initial: String = "")
internal data class Operation(val title: String, val tool: String, val action: String = "", val inputs: List<Input> = emptyList(), val values: Map<String, String> = emptyMap())
private fun encoded(value: String) = URLEncoder.encode(value, "UTF-8")
private fun query(route: WatchRoute): String = "/api/wear/view?view=${encoded(route.view)}&project=${encoded(route.project)}&chat_id=${encoded(route.chat)}&path=${encoded(route.path)}" + route.extra

/** Native, demand-loaded tools. No WebView, persistent terminal socket or background polling. */
@Composable internal fun ToolScreen(model: WatchViewModel, route: WatchRoute, active: Boolean) {
    val nav = model.nav
    val hub = model.hub
    var data by remember(route) { mutableStateOf(hub.cache[route]) }
    var loading by remember(route) { mutableStateOf(false) }
    var error by remember(route) { mutableStateOf("") }
    var revision by remember(route) { mutableIntStateOf(0) }
    val owner = LocalLifecycleOwner.current
    fun go(next: WatchRoute) = nav.push(Dest.Tool(next))
    fun view(name: String, path: String = "", extra: String = "") = go(route.copy(view = name, path = path, extra = extra))
    fun ask(op: Operation) = nav.push(Dest.Op(route, op))
    fun rows(key: String) = data?.optJSONArray(key).objects()
    suspend fun load() {
        loading = true; error = ""
        try {
            if (route.view !in setOf("compose", "tools", "select-commit")) model.dashboardCall(query(route)).also { data = it; hub.cache[route] = it }
        } catch (failure: Exception) {
            if (failure is CancellationException) throw failure
            error = failure.message ?: "No pude actualizar esta vista"
        } finally { loading = false }
    }
    // Inactive means the page is only the backdrop of a swipe: it paints from the last answer and asks for nothing.
    if (active) LaunchedEffect(route, revision) {
        owner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            load()
            // Only the open agent chat follows active work; all other tools refresh explicitly.
            if (route.view == "agent") {
                var failures = 0
                while (true) {
                    delay(6000)
                    val busy = rows("tasks").any { it.optString("status") in setOf("working", "espera") }
                    if (error.isNotBlank()) failures++ else failures = 0
                    if (!busy || failures >= 3) break
                    load()
                }
            }
        }
    }
    if (route.view == "compose") { ProjectComposer(model, route); return }
    ScrollPage(route) {
        when (route.view) {
            "projects" -> {
                Heading("Proyectos", Glyph.Folder)
                val all = rows("projects")
                var filter by remember { mutableStateOf("") }
                if (all.size > 6) Field(filter, "Buscar proyecto") { filter = it }
                val projects = all.filter { it.optString("name").contains(filter, true) || it.optString("description").contains(filter, true) }
                if (!loading && projects.isEmpty()) Note("Sin proyectos para mostrar")
                for (project in projects) {
                    val running = project.optInt("running_containers"); val queued = project.optInt("queued")
                    val detail = listOfNotNull(if (running > 0) "$running activos" else null, if (queued > 0) "$queued en cola" else null).joinToString(" · ")
                    Action(project.optString("name"), glyph = Glyph.Folder, tint = if (running > 0) Mint else Ice, detail = detail) { go(WatchRoute("project", project.optString("name"))) }
                }
                if (data != null && !data!!.isNull("next")) Action("Más proyectos", glyph = Glyph.Chevron) { view("projects", extra = "&offset=${data!!.optInt("next")}") }
                Action("Nuevo proyecto", glyph = Glyph.Plus, tint = Mint) { ask(Operation("Crear proyecto", "projects", "create", listOf(Input("name", "Nombre del proyecto"), Input("description", "Qué quieres construir"), Input("repo_url", "Repositorio Git (opcional)")))) }
                Action("Papelera", subtle = true, glyph = Glyph.Trash) { go(WatchRoute("trash")) }
            }
            "project" -> {
                Heading(route.project, Glyph.Folder)
                Note(data?.optString("description").orEmpty())
                if (data != null) Note("${data!!.optInt("running_containers")} servicios activos · ${data!!.optInt("queued")} en cola")
                Action("Agente", glyph = Glyph.Chat) { view("chats") }
                Action("Peticiones", glyph = Glyph.List) { view("tasks") }
                Action("Logs", glyph = Glyph.Lines) { view("logs", extra = "&tail=60") }
                Action("Terminal", glyph = Glyph.Terminal) { view("terminal", extra = "&kind=shell") }
                Action("Archivos", glyph = Glyph.File) { view("files") }
                Action("Versiones · Git", glyph = Glyph.Branch) { view("git") }
                Action("Despliegues", glyph = Glyph.Upload) { view("jobs") }
                Action("Contenedores", glyph = Glyph.Box) { view("containers") }
                Action("Vista previa", glyph = Glyph.Eye) { view("preview") }
                Action("Más herramientas", glyph = Glyph.More) { view("tools") }
            }
            "chats" -> {
                Heading("Agente · ${route.project}", Glyph.Chat)
                for (chat in rows("chats")) Action(chat.optString("title"), glyph = Glyph.Chat, detail = if (chat.optInt("working") > 0) "trabajando" else "") {
                    go(route.copy(view = "agent", chat = chat.optString("id")))
                }
                Action("Nuevo chat", glyph = Glyph.Plus, tint = Mint) { ask(Operation("Nuevo chat", "chats", "create", listOf(Input("title", "Nombre del chat")))) }
            }
            "agent" -> {
                Heading(route.project, Glyph.Chat)
                Note(if (route.chat == "main") "Chat principal" else "Chat del proyecto")
                for (task in rows("tasks").filter { it.optString("status") in setOf("working", "espera") }) Note(task.optString("status") + " · " + task.optString("title"))
                Action("Escribir al agente", glyph = Glyph.Keyboard, tint = Mint) { view("compose") }
                for (run in rows("runs").asReversed()) {
                    Note(run.optString("prompt", run.optString("title")))
                    val result = run.optJSONObject("result")?.optString("text").orEmpty()
                    if (result.isNotBlank()) Text(result, fontSize = 13.sp)
                    if (run.optString("error").isNotBlank()) ErrorText(run.optString("error"))
                    val events = run.optJSONArray("events").objects().takeLast(8)
                    for (event in events) Note(event.optString("name", event.optString("text", event.optString("t"))).take(600))
                    Action("Ver actividad", glyph = Glyph.Lines) { view("run", extra = "&run_id=${encoded(run.optString("id"))}") }
                }
                Action("Peticiones y detener", glyph = Glyph.List) { view("tasks") }
                Action("Aprobaciones", glyph = Glyph.Shield, tint = Amber) { go(WatchRoute("approvals")) }
                Action("Renombrar chat", route.chat != "main", glyph = Glyph.Edit) { ask(Operation("Renombrar chat", "chats", "rename", listOf(Input("title", "Nuevo nombre")))) }
                Action(if (route.chat == "main") "Vaciar chat" else "Eliminar chat", glyph = Glyph.Trash, tint = Coral) { ask(Operation("Borrar conversación", "chats", "delete")) }
                for (provider in listOf("claude", "codex")) Action("Reiniciar $provider", subtle = true, glyph = Glyph.Refresh) { ask(Operation("Reiniciar contexto $provider", "reset", values = mapOf("provider" to provider))) }
            }
            "tasks" -> {
                Heading("Peticiones", Glyph.List)
                if (!loading && rows("tasks").isEmpty()) Note("Sin peticiones")
                for (task in rows("tasks")) {
                    Text(task.optString("title"), color = Ice, fontSize = 13.sp)
                    Note(task.optString("status"))
                    val busy = task.optString("status") == "working"
                    Action(if (busy) "Detener" else "Reintentar", glyph = if (busy) Glyph.Stop else Glyph.Refresh, tint = if (busy) Coral else Ice) { ask(Operation(if (busy) "Detener petición" else "Reintentar petición", "tasks", if (busy) "stop" else "retry", values = mapOf("id" to task.optString("id")))) }
                    if (!busy) Action("Eliminar petición", subtle = true, glyph = Glyph.Trash) { ask(Operation("Eliminar petición", "tasks", "delete", values = mapOf("id" to task.optString("id")))) }
                }
            }
            "terminal" -> {
                Heading("Terminal", Glyph.Terminal)
                Note(data?.optString("session").orEmpty())
                if (data?.optBoolean("exists") == false) Note("Sesión todavía no iniciada")
                Text(data?.optString("output").orEmpty().ifBlank { "Sin salida" }, fontSize = 11.sp)
                Action("Enviar comando", glyph = Glyph.Send, tint = Mint) { ask(Operation("Enviar a terminal", "terminal", inputs = listOf(Input("command", "Comando a ejecutar")), values = mapOf("kind" to route.extra.substringAfter("kind=", "shell")))) }
                for (kind in listOf("shell", "claude", "codex")) Action("Ver $kind", subtle = true, glyph = Glyph.Terminal) { view("terminal", extra = "&kind=$kind") }
                Action("Cerrar terminal", subtle = true, glyph = Glyph.Close) { ask(Operation("Cerrar sesión", "terminal", "close", values = mapOf("kind" to route.extra.substringAfter("kind=", "shell")))) }
            }
            "files" -> {
                Heading("Archivos", Glyph.File)
                Note(route.path.ifBlank { "/" })
                for (entry in rows("entries")) {
                    val folder = entry.optString("type") == "dir"
                    Action(entry.optString("name"), glyph = if (folder) Glyph.Folder else Glyph.File, tint = if (folder) Ice else Dim) { view(if (folder) "files" else "file", entry.optString("path")) }
                }
                if (data != null && !data!!.isNull("next")) Action("Más archivos", glyph = Glyph.Chevron) { view("files", route.path, "&offset=${data!!.optInt("next")}") }
                Action("Crear archivo", glyph = Glyph.Plus, tint = Mint) { ask(Operation("Crear archivo", "files", "create", listOf(Input("path", "Ruta", route.path.trimEnd('/') + "/")))) }
                Action("Crear carpeta", glyph = Glyph.Folder, tint = Mint) { ask(Operation("Crear carpeta", "files", "mkdir", listOf(Input("path", "Ruta", route.path.trimEnd('/') + "/")))) }
                if (route.path.isNotBlank()) FileOperations(route.path, ::ask)
            }
            "file" -> {
                Heading(route.path.substringAfterLast('/'), Glyph.File)
                if (data?.optBoolean("binary") == true) Note("Archivo binario") else Text(data?.optString("content").orEmpty(), fontSize = 11.sp)
                if (data?.optBoolean("truncated") == true || data?.optString("content").orEmpty().contains("… Vista recortada")) Note("Vista recortada; edición desactivada")
                else if (data != null && !data!!.optBoolean("binary")) Action("Editar archivo", glyph = Glyph.Edit, tint = Mint) { ask(Operation("Guardar archivo", "write", inputs = listOf(Input("content", "Contenido", data!!.optString("content"))), values = mapOf("path" to route.path, "mtime" to data!!.optString("mtime")))) }
                FileOperations(route.path, ::ask)
            }
            "git" -> {
                Heading("Versiones · Git", Glyph.Branch)
                Details(data)
                Action("Historial", glyph = Glyph.Clock) { view("history") }
                Action("Cambios", glyph = Glyph.Edit) { view("diff") }
                Action("Ramas", glyph = Glyph.Branch) { view("branches") }
                Action("Guardar versión", glyph = Glyph.Check, tint = Mint) { ask(Operation("Guardar versión", "git", "commit", listOf(Input("message", "Descripción del cambio")))) }
                Action("Deshacer último cambio", glyph = Glyph.Back) { ask(Operation("Deshacer último cambio", "git", "undo")) }
                Action("Crear rama", glyph = Glyph.Plus) { ask(Operation("Crear rama", "git", "branch-create", listOf(Input("name", "Nombre de rama")))) }
                Action("Restaurar versión", glyph = Glyph.Refresh) { ask(Operation("Restaurar versión", "git", "restore", listOf(Input("rev", "Identificador de versión")))) }
                Action("Deshacer una versión", glyph = Glyph.Back) { ask(Operation("Deshacer una versión", "git", "revert", listOf(Input("rev", "Identificador de versión")))) }
            }
            "history" -> {
                Heading("Historial", Glyph.Clock)
                Details(data)
                Action("Ver versión", glyph = Glyph.Eye) { view("select-commit") }
            }
            "select-commit" -> {
                Heading("Ver versión", Glyph.Eye)
                var revisionText by remember { mutableStateOf("") }
                Field(revisionText, "Identificador de versión") { revisionText = it }
                Action("Abrir versión", revisionText.isNotBlank(), glyph = Glyph.Chevron) { view("commit", extra = "&rev=${encoded(revisionText)}") }
            }
            "branches" -> {
                Heading("Ramas", Glyph.Branch)
                Details(data)
                for ((action, label) in listOf("switch" to "Cambiar rama", "merge" to "Integrar rama", "branch-delete" to "Archivar rama")) Action(label, glyph = Glyph.Branch) { ask(Operation(label, "git", action, listOf(Input("name", "Nombre de rama")))) }
            }
            "jobs" -> {
                Heading("Despliegues", Glyph.Upload)
                for ((action, label, glyph) in listOf(Triple("deploy", "Desplegar", Glyph.Upload), Triple("restart", "Reiniciar", Glyph.Refresh), Triple("down", "Detener", Glyph.Stop), Triple("build", "Compilar", Glyph.Box), Triple("dev", "Modo desarrollo", Glyph.Code)))
                    Action(label, glyph = glyph, tint = if (action == "down") Coral else Ice) { ask(Operation("$label · ${route.project}", "jobs", action)) }
                Details(data)
            }
            "containers" -> {
                Heading("Contenedores", Glyph.Box)
                for (container in rows("container_details")) {
                    Text(container.optString("name"), color = Ice, fontSize = 14.sp)
                    Note(container.optString("status"))
                    Action("Ver logs", subtle = true, glyph = Glyph.Lines) { view("logs", extra = "&tail=60&container=${encoded(container.optString("id"))}") }
                    for (action in listOf("start", "stop", "restart")) Action(when (action) { "start" -> "Iniciar servicio"; "stop" -> "Detener servicio"; else -> "Reiniciar servicio" },
                        !container.optBoolean("protected"), glyph = when (action) { "start" -> Glyph.Chevron; "stop" -> Glyph.Stop; else -> Glyph.Refresh }, tint = if (action == "stop") Coral else Ice) {
                        ask(Operation(action + " · " + container.optString("name"), "docker", action, values = mapOf("container" to container.optString("id"))))
                    }
                }
            }
            "preview" -> {
                Heading("Vista previa", Glyph.Eye)
                Note(data?.optString("url").orEmpty())
                Note("La web del proyecto requiere un navegador. En el reloj puedes consultar servicios, logs y despliegues.")
                Action("Servicios", glyph = Glyph.Box) { view("containers") }
            }
            "tools" -> {
                Heading("Más herramientas", Glyph.More)
                Action("Destacar / quitar destacado", glyph = Glyph.Star, tint = Amber) { ask(Operation("Cambiar destacado", "projects", "toggle_featured", values = mapOf("name" to route.project))) }
                Action("Eliminar proyecto", glyph = Glyph.Trash, tint = Coral) { view("delete-preview") }
            }
            "delete-preview" -> {
                Heading("Eliminar proyecto", Glyph.Trash, Coral)
                Details(data)
                Action("Continuar", glyph = Glyph.Chevron, tint = Coral) { ask(Operation("Mover proyecto a papelera", "projects", "delete", listOf(Input("confirmation", "Escribe el nombre exacto")), mapOf("name" to route.project))) }
            }
            "trash" -> {
                Heading("Papelera", Glyph.Trash)
                Details(data)
                Action("Restaurar proyecto", glyph = Glyph.Refresh) { ask(Operation("Restaurar proyecto", "projects", "restore", listOf(Input("archive_id", "Identificador del archivo")))) }
            }
            "approvals" -> {
                Heading("Aprobaciones", Glyph.Shield, Amber)
                val approvals = rows("approvals")
                if (!loading && approvals.isEmpty()) Note("Sin aprobaciones pendientes")
                for (approval in approvals) {
                    Details(approval)
                    for ((decision, label) in listOf("allow" to "Permitir", "deny" to "Denegar")) Action(label, glyph = if (decision == "allow") Glyph.Check else Glyph.Close, tint = if (decision == "allow") Mint else Coral) {
                        ask(Operation(label + " herramienta", "approval", values = mapOf("run_id" to approval.optString("run_id"), "request_id" to approval.optString("id"), "decision" to decision)))
                    }
                }
            }
            "settings" -> {
                Heading("Ajustes", Glyph.Sliders)
                Action("Avisos", glyph = Glyph.Bell) { nav.push(Dest.Push) }
                val settings = data?.optJSONObject("settings")
                if (settings != null) {
                    for ((key, label, options) in listOf(
                        Triple("default_provider", "Agente predeterminado", listOf("claude", "codex")),
                        Triple("claude_permission", "Permisos de Claude", listOf("ask", "auto", "edits")),
                        Triple("codex_sandbox", "Acceso de Codex", listOf("read-only", "workspace", "full")),
                        Triple("auto_commit", "Versiones automáticas", listOf("on", "off")))) {
                        Note(label + ": " + settings.optString(key))
                        for (option in options) Action(option, glyph = if (settings.optString(key) == option) Glyph.Check else null, tint = Mint) { ask(Operation("$label: $option", "settings", values = mapOf(key to option))) }
                    }
                    for (provider in listOf("claude", "codex")) Action("Modelo $provider", glyph = if (provider == "claude") Glyph.Sparkle else Glyph.Code, tint = if (provider == "claude") Ember else Sky) { ask(Operation("Modelo $provider", "settings", inputs = listOf(Input(provider + "_model", "Modelo (vacío = predeterminado)", settings.optString(provider + "_model"))))) }
                }
                Action("Catálogo de modelos", glyph = Glyph.List) { go(WatchRoute("models")) }
                Note("Servidor: ${model.api.origin}")
                Action("Desvincular reloj", subtle = true, glyph = Glyph.Power, tint = Coral) { nav.push(Dest.Unlink) }
            }
            else -> {
                Heading(when (route.view) { "logs" -> "Logs"; "server" -> "Servidor"; "diff" -> "Cambios"; "commit" -> "Versión"; "models" -> "Modelos"; else -> "Detalles" },
                    when (route.view) { "logs" -> Glyph.Lines; "server" -> Glyph.Server; "diff" -> Glyph.Edit; "commit" -> Glyph.Branch; "models" -> Glyph.List; else -> null })
                Details(data)
            }
        }
        if (loading) Note("Actualizando…")
        if (hub.flash.isNotBlank()) Note(hub.flash)
        ErrorText(error)
        DisposableEffect(route) { onDispose { if (active) hub.flash = "" } }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            RoundButton(Glyph.Back, "Volver", size = 44.dp) { nav.pop() }
            RoundButton(Glyph.Home, "Inicio", size = 44.dp) { nav.home() }
            RoundButton(Glyph.Refresh, "Actualizar", size = 44.dp, enabled = !loading) { revision++ }
        }
    }
}

/** Review, then confirm: nothing reaches the server until the second tap, and the answer lands on the screen below. */
@Composable internal fun OperationScreen(model: WatchViewModel, route: WatchRoute, op: Operation) {
    val nav = model.nav
    val fields = remember(op) { op.inputs.associate { it.key to mutableStateOf(it.initial) } }
    var reviewed by remember(op) { mutableStateOf(false) }
    var executing by remember(op) { mutableStateOf(false) }
    var error by remember(op) { mutableStateOf("") }
    ScrollPage(op) {
        Heading(op.title, if (reviewed) Glyph.Shield else Glyph.Edit)
        Note(route.project.ifBlank { "Dashboard" })
        if (!reviewed) {
            for (input in op.inputs) {
                Note(input.label)
                Field(fields.getValue(input.key).value, input.label, !executing) { fields.getValue(input.key).value = it }
            }
            Action("Revisar", !executing, glyph = Glyph.Chevron) { reviewed = true; error = "" }
        } else {
            Note("Se aplicará en el servidor")
            for (input in op.inputs) Note(input.label + ": " + fields.getValue(input.key).value)
            Action(if (executing) "Aplicando…" else "Confirmar", !executing, glyph = Glyph.Check, tint = Mint) {
                executing = true; error = ""
                // The request outlives this screen: swiping back must not cancel a half-delivered action.
                model.viewModelScope.launch {
                    try {
                        val body = JSONObject().put("tool", op.tool).put("action", op.action).put("confirmed", true)
                            .put("project", route.project).put("chat_id", route.chat)
                        for ((key, value) in op.values) body.put(key, value)
                        for ((key, value) in fields) body.put(key, value.value)
                        val result = model.dashboardCall("/api/wear/action", body)
                        model.hub.flash = result.optString("message", "Listo")
                        if (nav.top == Dest.Op(route, op)) nav.pop()
                    } catch (failure: Exception) {
                        if (failure is CancellationException) throw failure
                        error = (failure.message ?: "No pude confirmar la acción") + ". Actualiza antes de repetirla."
                    } finally { executing = false }
                }
            }
            Action("Editar", !executing, subtle = true, glyph = Glyph.Edit) { reviewed = false }
        }
        ErrorText(error)
        Action("Cancelar", !executing, subtle = true, glyph = Glyph.Close) { nav.pop(); error = "" }
    }
}

@Composable private fun FileOperations(path: String, choose: (Operation) -> Unit) {
    Action("Renombrar / mover", glyph = Glyph.Edit) { choose(Operation("Mover archivo", "files", "rename", listOf(Input("to", "Ruta de destino")), mapOf("path" to path))) }
    Action("Eliminar", glyph = Glyph.Trash, tint = Coral) { choose(Operation("Eliminar $path", "files", "delete", values = mapOf("path" to path))) }
}

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

@Composable private fun ProjectComposer(model: WatchViewModel, route: WatchRoute) {
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
    ScrollPage(route) {
        Heading("Mensaje · ${route.project}", Glyph.Keyboard)
        Note(if (pending != null) "Envío por confirmar. Reintenta sin duplicarlo." else "Revisa tu petición")
        Field(text, "Mensaje del proyecto", pending == null && !busy) { text = it.take(4000) }
        if (pending == null) {
            Action("Dictar", !busy, glyph = Glyph.Mic) {
                try { dictate.launch(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "es-MX")) }
                catch (_: ActivityNotFoundException) { error = "Dictado no disponible. Puedes escribir." }
            }
            Note("Agente: ${provider.ifBlank { "Predeterminado" }}")
            for ((value, label) in listOf("" to "Predeterminado", "claude" to "Claude Code", "codex" to "Codex")) Action(label, !busy, subtle = provider != value,
                glyph = when (value) { "claude" -> Glyph.Sparkle; "codex" -> Glyph.Code; else -> Glyph.Chat }, tint = when (value) { "claude" -> Ember; "codex" -> Sky; else -> Ice }) { provider = value; chosenModel = ""; effort = "" }
            Note("Modelo opcional")
            Field(chosenModel, "Modelo", !busy) { chosenModel = it }
            Note("Esfuerzo opcional")
            Field(effort, "Esfuerzo", !busy) { effort = it }
        }
        ErrorText(error)
        Action(if (busy) "Enviando…" else if (pending != null) "Reintentar envío" else "Enviar", text.isNotBlank() && !busy, glyph = if (pending != null) Glyph.Refresh else Glyph.Send, tint = Mint) {
            val body = pending ?: JSONObject().put("request_id", UUID.randomUUID().toString()).put("text", text.trim())
                .put("project", route.project).put("chat_id", route.chat).put("provider", provider).put("model", chosenModel).put("effort", effort)
            // Durable before transport, scoped to exact project/chat/provider/model/text.
            model.store.write(key, body.toString()); pending = body; busy = true; error = ""
            scope.launch {
                try {
                    model.dashboardCall("/api/wear/send", body)
                    model.store.remove(key); model.store.remove("draft-$key"); text = ""; model.nav.pop()
                } catch (failure: Exception) {
                    if (failure is CancellationException) throw failure
                    if (failure is ApiError && failure.status in setOf(400, 403, 404, 409, 413, 429)) { model.store.remove(key); pending = null }
                    error = failure.message ?: "No pude confirmar el envío"
                } finally { busy = false }
            }
        }
        Action("Cancelar", !busy, subtle = true, glyph = Glyph.Close) { model.nav.pop() }
    }
}
