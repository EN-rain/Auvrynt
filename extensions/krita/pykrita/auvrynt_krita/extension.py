import base64
import json
import os
import secrets
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from krita import Extension, InfoObject, Krita, ManagedColor
from PyQt5.QtCore import QByteArray, QBuffer, QIODevice, QObject, Qt, pyqtSignal
from PyQt5.QtGui import QColor, QImage
from PyQt5.QtWidgets import QApplication

MAX_REQUEST_BYTES = 1024 * 1024
REQUEST_TIMEOUT_SECONDS = 30.0
PORT_START = 9797
PORT_END = 9827


class _GuiRequest:
    def __init__(self, operation, args):
        self.operation = operation
        self.args = args
        self.event = threading.Event()
        self.result = None
        self.error = None


class _GuiDispatcher(QObject):
    dispatch_requested = pyqtSignal(object)

    def __init__(self, extension):
        super().__init__()
        self._extension = extension
        self.dispatch_requested.connect(self._execute, Qt.QueuedConnection)

    def submit(self, operation, args):
        request = _GuiRequest(operation, args)
        self.dispatch_requested.emit(request)
        if not request.event.wait(REQUEST_TIMEOUT_SECONDS):
            raise TimeoutError("Krita GUI-thread operation timed out.")
        if request.error is not None:
            raise request.error
        return request.result

    def _execute(self, request):
        try:
            request.result = self._extension.execute_operation(request.operation, request.args)
        except Exception as exc:
            request.error = exc
        finally:
            request.event.set()


class _BridgeServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False

    def __init__(self, address, handler, token, dispatcher):
        super().__init__(address, handler)
        self.token = token
        self.dispatcher = dispatcher


class _RequestHandler(BaseHTTPRequestHandler):
    server_version = "AuvryntKritaBridge/1.0"

    def log_message(self, _format, *_args):
        return

    def do_GET(self):
        if self.path.rstrip("/") != "/health":
            self._json(404, {"ok": False, "error": "Not found."})
            return
        if not self._authorized():
            self._json(401, {"ok": False, "error": "Unauthorized."})
            return
        try:
            result = self.server.dispatcher.submit("status", {})
            self._json(200, {"ok": True, "result": result})
        except Exception as exc:
            self._json(500, {"ok": False, "error": str(exc)})

    def do_POST(self):
        if self.path.rstrip("/") not in ("", "/command"):
            self._json(404, {"ok": False, "error": "Not found."})
            return
        if not self._authorized():
            self._json(401, {"ok": False, "error": "Unauthorized."})
            return

        try:
            payload = self._read_json()
            if self.path.rstrip("/") == "/command":
                operation = payload.get("operation")
                args = payload.get("args", {})
            else:
                operation = payload.get("action")
                args = payload.get("params", {})
            if not isinstance(operation, str) or not operation:
                raise ValueError("operation/action is required.")
            if not isinstance(args, dict):
                raise ValueError("args/params must be an object.")
            result = self.server.dispatcher.submit(operation, args)
            self._json(200, {"ok": True, "result": result})
        except ValueError as exc:
            self._json(400, {"ok": False, "error": str(exc)})
        except Exception as exc:
            self._json(500, {"ok": False, "error": str(exc)})

    def _authorized(self):
        token = self.server.token
        authorization = self.headers.get("Authorization", "")
        candidates = [
            authorization[7:] if authorization.startswith("Bearer ") else "",
            self.headers.get("X-Auvrynt-Token", ""),
            self.headers.get("X-Krita-MCP-Token", ""),
            self.headers.get("X-Auth-Token", ""),
        ]
        return any(candidate and secrets.compare_digest(candidate, token) for candidate in candidates)

    def _read_json(self):
        raw_length = self.headers.get("Content-Length", "0")
        try:
            length = int(raw_length)
        except ValueError as exc:
            raise ValueError("Invalid Content-Length.") from exc
        if length < 1 or length > MAX_REQUEST_BYTES:
            raise ValueError("Request body is empty or exceeds the 1 MiB safety limit.")
        body = self.rfile.read(length)
        try:
            payload = json.loads(body.decode("utf-8"))
        except Exception as exc:
            raise ValueError("Request body must be valid UTF-8 JSON.") from exc
        if not isinstance(payload, dict):
            raise ValueError("Request JSON must be an object.")
        return payload

    def _json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


class AuvryntKritaExtension(Extension):
    def __init__(self, parent):
        super().__init__(parent)
        self._server = None
        self._server_thread = None
        self._dispatcher = _GuiDispatcher(self)
        self._state_path = None

    def setup(self):
        self._start_bridge()
        app = QApplication.instance()
        if app is not None:
            app.aboutToQuit.connect(self._stop_bridge)

    def createActions(self, _window):
        return

    def _start_bridge(self):
        if self._server is not None:
            return
        token = secrets.token_urlsafe(32)
        requested_port = os.environ.get("AUVRYNT_KRITA_PORT") or os.environ.get("KRITA_MCP_PORT")
        ports = [int(requested_port)] if requested_port else range(PORT_START, PORT_END + 1)
        last_error = None
        for port in ports:
            try:
                server = _BridgeServer(("127.0.0.1", int(port)), _RequestHandler, token, self._dispatcher)
                self._server = server
                break
            except OSError as exc:
                last_error = exc
        if self._server is None:
            raise RuntimeError("Could not bind an Auvrynt Krita bridge loopback port: %s" % last_error)

        self._write_discovery(self._server.server_address[1], token)
        self._server_thread = threading.Thread(target=self._server.serve_forever, name="AuvryntKritaBridge", daemon=True)
        self._server_thread.start()

    def _stop_bridge(self):
        server = self._server
        self._server = None
        if server is not None:
            try:
                server.shutdown()
                server.server_close()
            except Exception:
                pass
        if self._state_path:
            try:
                Path(self._state_path).unlink(missing_ok=True)
            except Exception:
                pass

    def _write_discovery(self, port, token):
        state_dir = (
            os.environ.get("AUVRYNT_KRITA_STATE_DIR")
            or os.environ.get("KRITA_MCP_STATE_DIR")
            or (str(Path(os.environ.get("LOCALAPPDATA", tempfile.gettempdir())) / "Auvrynt"))
        )
        path = Path(state_dir)
        path.mkdir(parents=True, exist_ok=True)
        state_path = path / "auvrynt-krita-bridge.json"
        temp_path = state_path.with_suffix(".json.tmp")
        payload = {
            "url": "http://127.0.0.1:%d" % port,
            "host": "127.0.0.1",
            "port": port,
            "token": token,
            "pid": os.getpid(),
        }
        temp_path.write_text(json.dumps(payload), encoding="utf-8")
        try:
            os.chmod(temp_path, 0o600)
        except Exception:
            pass
        temp_path.replace(state_path)
        self._state_path = str(state_path)

    def execute_operation(self, operation, args):
        if operation in ("status", "krita_status"):
            return self._status()
        if operation in ("get_state", "inspect_document"):
            return self._get_state()
        if operation == "get_canvas_info":
            return self._get_canvas_info()
        if operation == "get_image":
            return self._get_image(args)
        if operation == "list_capabilities":
            return {"capabilities": self._capabilities()}
        if operation == "create_layer":
            return self._create_layer(args)
        if operation == "select_layer":
            return self._select_layer(args)
        if operation == "set_layer":
            return self._set_layer(args)
        if operation == "delete_layer":
            return self._delete_layer(args)
        if operation == "set_brush":
            return self._set_brush(args)
        if operation == "set_brush_size":
            return self._set_brush_size(args)
        if operation == "set_color":
            return self._set_color(args)
        if operation in ("undo", "redo"):
            return self._trigger_action({"action": operation})
        if operation == "save_document":
            return self._save_document(args)
        if operation == "export_document":
            return self._export_document(args)
        if operation == "list_actions":
            return self._list_actions()
        if operation == "search_actions":
            return self._search_actions(args)
        if operation == "trigger_action":
            return self._trigger_action(args)
        if operation == "fill":
            return self._fill(args)
        if operation == "select":
            return self._select(args)
        if operation == "batch":
            return self._batch(args)
        if operation in ("stroke", "transform_selection"):
            raise RuntimeError(
                "%s is not exposed by the bundled Krita plugin; use bounded desktop canvas input for organic operations or a compatible richer Krita bridge." % operation
            )
        if operation in ("run_python", "execute_python"):
            raise RuntimeError("Arbitrary Python execution is intentionally disabled by the Auvrynt Krita bridge.")
        raise RuntimeError("Unsupported Krita bridge operation: %s" % operation)

    def _app(self):
        return Krita.instance()

    def _document(self):
        document = self._app().activeDocument()
        if document is None:
            raise RuntimeError("Krita has no active document.")
        return document

    def _view(self):
        window = self._app().activeWindow()
        if window is None or window.activeView() is None:
            raise RuntimeError("Krita has no active canvas view.")
        return window.activeView()

    def _status(self):
        app = self._app()
        document = app.activeDocument()
        return {
            "online": True,
            "version": app.version(),
            "documentOpen": document is not None,
            "document": Path(document.fileName()).name if document and document.fileName() else None,
            "capabilities": self._capabilities(),
        }

    def _capabilities(self):
        return [
            "status", "get_state", "inspect_document", "get_canvas_info", "get_image", "list_capabilities",
            "create_layer", "select_layer", "set_layer", "delete_layer", "set_brush", "set_brush_size", "set_color",
            "undo", "redo", "save_document", "export_document", "list_actions", "search_actions", "trigger_action",
            "fill", "select", "batch",
        ]

    def _get_state(self):
        doc = self._document()
        node = doc.activeNode()
        view = None
        try:
            view = self._view()
        except Exception:
            pass
        state = {
            "document": {
                "name": Path(doc.fileName()).name if doc.fileName() else "Untitled",
                "path": doc.fileName() or None,
                "width": doc.width(),
                "height": doc.height(),
                "modified": bool(doc.modified()),
            },
            "canvas": {"width": doc.width(), "height": doc.height()},
            "activeLayer": self._node_info(node) if node else None,
            "modified": bool(doc.modified()),
            "capabilities": self._capabilities(),
        }
        if view is not None:
            state.update(self._view_state(view))
        return state

    def _get_canvas_info(self):
        state = self._get_state()
        document = state["document"]
        return {
            "document": document["name"],
            "documentPath": document["path"],
            "width": document["width"],
            "height": document["height"],
            "modified": document["modified"],
            "zoom": state.get("zoom"),
            "rotation": state.get("rotation"),
            "mirrored": state.get("mirrored"),
        }

    def _view_state(self, view):
        result = {}
        try:
            result["brushSize"] = float(view.brushSize())
        except Exception:
            pass
        try:
            preset = view.currentBrushPreset()
            if preset is not None:
                result["brush"] = preset.name()
        except Exception:
            pass
        try:
            result["foreground"] = view.foregroundColor().colorForCanvas(self._document().canvas()).name(QColor.HexArgb)
        except Exception:
            try:
                result["foreground"] = view.foregroundColor().colorForCanvas(None).name(QColor.HexArgb)
            except Exception:
                pass
        try:
            result["background"] = view.backgroundColor().colorForCanvas(self._document().canvas()).name(QColor.HexArgb)
        except Exception:
            pass
        try:
            result["zoom"] = float(view.canvas().zoomLevel())
        except Exception:
            pass
        try:
            result["rotation"] = float(view.canvas().rotation())
        except Exception:
            pass
        try:
            result["mirrored"] = bool(view.canvas().mirror())
        except Exception:
            pass
        return result

    def _node_info(self, node):
        return {
            "name": node.name(),
            "type": node.type(),
            "opacity": float(node.opacity()) / 255.0,
            "visible": bool(node.visible()),
            "locked": bool(node.locked()),
            "blendMode": node.blendingMode(),
            "uniqueId": str(node.uniqueId()),
        }

    def _get_image(self, args):
        doc = self._document()
        with tempfile.NamedTemporaryFile(prefix="auvrynt-krita-", suffix=".png", delete=False) as temp:
            temp_path = temp.name
        try:
            info = InfoObject()
            if not doc.exportImage(temp_path, info):
                raise RuntimeError("Krita failed to export an in-memory preview source.")
            image = QImage(temp_path)
            if image.isNull():
                raise RuntimeError("Krita preview export could not be decoded.")

            region = args.get("normalizedRegion") or args.get("normalized_region")
            if isinstance(region, dict):
                x = max(0.0, min(1.0, float(region.get("x", 0.0))))
                y = max(0.0, min(1.0, float(region.get("y", 0.0))))
                width = max(0.0, min(1.0 - x, float(region.get("width", 1.0))))
                height = max(0.0, min(1.0 - y, float(region.get("height", 1.0))))
                if width <= 0 or height <= 0:
                    raise ValueError("normalizedRegion must have positive width/height inside the canvas.")
                image = image.copy(
                    int(round(x * image.width())),
                    int(round(y * image.height())),
                    max(1, int(round(width * image.width()))),
                    max(1, int(round(height * image.height()))),
                )

            max_width = args.get("maxWidth", args.get("max_width"))
            if max_width is not None and image.width() > int(max_width):
                image = image.scaledToWidth(int(max_width), Qt.SmoothTransformation)

            bytes_out = QByteArray()
            buffer = QBuffer(bytes_out)
            buffer.open(QIODevice.WriteOnly)
            try:
                if not image.save(buffer, "PNG"):
                    raise RuntimeError("Could not encode the Krita canvas preview as PNG.")
            finally:
                buffer.close()
            return {
                "pngBase64": base64.b64encode(bytes(bytes_out)).decode("ascii"),
                "mimeType": "image/png",
                "width": image.width(),
                "height": image.height(),
                "sourceWidth": doc.width(),
                "sourceHeight": doc.height(),
                "document": Path(doc.fileName()).name if doc.fileName() else "Untitled",
            }
        finally:
            try:
                os.unlink(temp_path)
            except OSError:
                pass

    def _create_layer(self, args):
        doc = self._document()
        name = self._required_string(args, "name")
        layer_type = args.get("layerType") or args.get("layer_type") or "paintlayer"
        parent_name = args.get("parent")
        parent = self._find_node(doc.rootNode(), parent_name) if parent_name else doc.rootNode()
        if parent is None:
            raise RuntimeError("Parent layer not found: %s" % parent_name)
        node = doc.createNode(name, str(layer_type))
        parent.addChildNode(node, None)
        doc.setActiveNode(node)
        return self._node_info(node)

    def _select_layer(self, args):
        doc = self._document()
        node = self._resolve_node(doc, args)
        doc.setActiveNode(node)
        return self._node_info(node)

    def _set_layer(self, args):
        doc = self._document()
        node = self._resolve_node(doc, args, allow_active=True)
        new_name = args.get("newName") or args.get("new_name")
        if new_name:
            node.setName(str(new_name))
        if "opacity" in args and args["opacity"] is not None:
            opacity = max(0.0, min(1.0, float(args["opacity"])))
            node.setOpacity(int(round(opacity * 255)))
        if "visible" in args and args["visible"] is not None:
            node.setVisible(bool(args["visible"]))
        if "locked" in args and args["locked"] is not None:
            node.setLocked(bool(args["locked"]))
        blend_mode = args.get("blendMode") or args.get("blend_mode")
        if blend_mode:
            node.setBlendingMode(str(blend_mode))
        doc.refreshProjection()
        return self._node_info(node)

    def _delete_layer(self, args):
        doc = self._document()
        node = self._resolve_node(doc, args)
        name = node.name()
        parent = node.parentNode()
        if parent is None:
            raise RuntimeError("Cannot delete the document root node.")
        if not node.remove():
            parent.removeChildNode(node)
        doc.refreshProjection()
        return {"deleted": True, "name": name}

    def _set_brush(self, args):
        name = self._required_string(args, "name")
        presets = self._app().resources("preset")
        resource = presets.get(name)
        if resource is None:
            lowered = name.lower()
            for preset_name, candidate in presets.items():
                if preset_name.lower() == lowered:
                    resource = candidate
                    name = preset_name
                    break
        if resource is None:
            raise RuntimeError("Krita brush preset not found: %s" % name)
        self._view().setCurrentBrushPreset(resource)
        return {"brush": name}

    def _set_brush_size(self, args):
        size = float(args.get("size"))
        if size <= 0 or size > 10000:
            raise ValueError("Brush size must be greater than 0 and at most 10000.")
        self._view().setBrushSize(size)
        return {"brushSize": size}

    def _set_color(self, args):
        raw = self._required_string(args, "color")
        color = QColor(raw)
        if not color.isValid():
            raise ValueError("Invalid foreground color.")
        managed = ManagedColor.fromQColor(color, self._document().canvas())
        self._view().setForeGroundColor(managed)
        return {"foreground": color.name(QColor.HexArgb)}

    def _save_document(self, args):
        doc = self._document()
        path = args.get("path")
        ok = doc.saveAs(str(path)) if path else doc.save()
        if not ok:
            raise RuntimeError("Krita failed to save the current document.")
        return {"saved": True, "path": doc.fileName()}

    def _export_document(self, args):
        path = self._required_string(args, "path")
        info = InfoObject()
        quality = args.get("quality")
        if quality is not None:
            try:
                info.setProperty("quality", int(quality))
            except Exception:
                pass
        if not self._document().exportImage(path, info):
            raise RuntimeError("Krita failed to export the current document.")
        return {"exported": True, "path": path}

    def _list_actions(self):
        actions = []
        for action in self._app().actions():
            action_id = action.objectName()
            if not action_id:
                continue
            actions.append({"id": action_id, "text": action.text(), "enabled": bool(action.isEnabled())})
        actions.sort(key=lambda item: item["id"])
        return {"actions": actions}

    def _search_actions(self, args):
        query = self._required_string(args, "query").lower()
        limit = max(1, min(100, int(args.get("limit", 25))))
        matches = []
        for item in self._list_actions()["actions"]:
            haystack = (item["id"] + " " + (item.get("text") or "")).lower()
            if query in haystack:
                matches.append(item)
                if len(matches) >= limit:
                    break
        return {"query": query, "actions": matches}

    def _trigger_action(self, args):
        action_id = self._required_string(args, "action")
        action = self._app().action(action_id)
        if action is None:
            raise RuntimeError("Krita action not found: %s" % action_id)
        action.trigger()
        return {"triggered": True, "action": action_id}

    def _fill(self, args):
        color = args.get("color")
        if color:
            self._set_color({"color": color})
        if args.get("x") is not None or args.get("y") is not None:
            raise RuntimeError("Seed-point fill is not exposed by the bundled bridge; use bounded desktop input for a canvas click with the fill tool.")
        for action_id in ("fill_entire_selection", "fill_selection_foreground_color", "fill_selection_with_fg"):
            action = self._app().action(action_id)
            if action is not None:
                action.trigger()
                return {"filled": True, "action": action_id}
        raise RuntimeError("This Krita build does not expose a known fill-selection action ID.")

    def _select(self, args):
        selection_type = str(args.get("type", "")).lower()
        if selection_type == "deselect":
            for action_id in ("deselect", "selectopaque"):
                action = self._app().action(action_id)
                if action is not None and action_id == "deselect":
                    action.trigger()
                    return {"deselected": True}
            raise RuntimeError("Krita deselect action was not found.")
        raise RuntimeError("Geometric selection is not exposed by the bundled bridge; use bounded desktop lasso/selection input or a compatible richer bridge.")

    def _batch(self, args):
        operations = args.get("operations")
        if not isinstance(operations, list) or not operations or len(operations) > 64:
            raise ValueError("batch operations must contain 1 to 64 items.")
        stop_on_error = bool(args.get("stopOnError", args.get("stop_on_error", True)))
        results = []
        for index, item in enumerate(operations):
            if not isinstance(item, dict):
                raise ValueError("batch item %d must be an object." % index)
            operation = item.get("operation")
            if operation in ("batch", "run_python", "execute_python"):
                raise RuntimeError("Nested batch/arbitrary Python operations are not permitted.")
            try:
                result = self.execute_operation(str(operation), item.get("args") or {})
                results.append({"index": index, "ok": True, "result": result})
            except Exception as exc:
                results.append({"index": index, "ok": False, "error": str(exc)})
                if stop_on_error:
                    break
        return {"results": results}

    def _resolve_node(self, doc, args, allow_active=False):
        name = args.get("name")
        unique_id = args.get("id")
        if not name and not unique_id and allow_active:
            active = doc.activeNode()
            if active is not None:
                return active
        node = self._find_node(doc.rootNode(), name, unique_id)
        if node is None:
            raise RuntimeError("Krita layer was not found.")
        return node

    def _find_node(self, root, name=None, unique_id=None):
        if root is None:
            return None
        if name and root.name() == name:
            return root
        if unique_id and str(root.uniqueId()) == str(unique_id):
            return root
        for child in root.childNodes():
            found = self._find_node(child, name, unique_id)
            if found is not None:
                return found
        return None

    @staticmethod
    def _required_string(args, key):
        value = args.get(key)
        if not isinstance(value, str) or not value.strip():
            raise ValueError("%s is required." % key)
        return value.strip()
