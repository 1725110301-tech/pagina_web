"""PilaNav — simulador de navegador web con una pila (LIFO).

El historial de cada visitante es una pila: la última página registrada
es la primera en recuperarse.
"""
import os
import re
import threading
import uuid
from collections import OrderedDict
from urllib.parse import urlparse

from flask import Flask, g, jsonify, render_template, request

app = Flask(__name__)

MAX_PAGINAS = 200      # tope de la pila por sesión
MAX_SESIONES = 1000    # sesiones en memoria antes de descartar las más viejas
MAX_URL = 2048


# --------------------------------------------------------------------------
# Estructura de datos: pila (LIFO)
# --------------------------------------------------------------------------
class Pila:
    def __init__(self, limite=MAX_PAGINAS):
        self._datos = []
        self._limite = limite

    def push(self, elemento):
        if len(self._datos) >= self._limite:
            raise OverflowError("La pila está llena.")
        self._datos.append(elemento)

    def pop(self):
        if not self._datos:
            raise IndexError("La pila está vacía.")
        return self._datos.pop()

    def peek(self):
        return self._datos[-1] if self._datos else None

    def esta_vacia(self):
        return not self._datos

    def clear(self):
        self._datos.clear()

    def __len__(self):
        return len(self._datos)

    def de_tope_a_base(self):
        """Del último elemento registrado al primero."""
        return list(reversed(self._datos))


# --------------------------------------------------------------------------
# Sesiones en memoria (una pila por visitante, identificada por cookie)
# --------------------------------------------------------------------------
_sesiones = OrderedDict()
_lock = threading.Lock()


def _pila_de_la_sesion():
    sid = request.cookies.get("sid", "")
    with _lock:
        if sid in _sesiones:
            _sesiones.move_to_end(sid)
            return _sesiones[sid]
        sid = uuid.uuid4().hex
        _sesiones[sid] = Pila()
        while len(_sesiones) > MAX_SESIONES:
            _sesiones.popitem(last=False)
        g.nuevo_sid = sid
        return _sesiones[sid]


# --------------------------------------------------------------------------
# Validación de URLs
# --------------------------------------------------------------------------
_HOST_RE = re.compile(
    r"^(localhost"
    r"|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}"
    r"|\d{1,3}(?:\.\d{1,3}){3})$",
    re.IGNORECASE,
)
_ESQUEMA_RE = re.compile(r"^[a-z][a-z0-9+.-]*://", re.IGNORECASE)


def normalizar_url(crudo):
    crudo = (crudo or "").strip()
    if not crudo:
        raise ValueError("Escribe una dirección para visitar.")
    if len(crudo) > MAX_URL:
        raise ValueError("La dirección es demasiado larga.")
    if re.search(r"\s", crudo):
        raise ValueError("La dirección no puede contener espacios.")
    if not _ESQUEMA_RE.match(crudo):
        crudo = "https://" + crudo
    try:
        p = urlparse(crudo)
        host = p.hostname
        _ = p.port
    except ValueError:
        raise ValueError("La dirección no es válida.")
    if p.scheme.lower() not in ("http", "https"):
        raise ValueError("Solo se admiten direcciones http o https.")
    if not host or not _HOST_RE.match(host):
        raise ValueError("El dominio no es válido. Ejemplo: ejemplo.com/ruta")
    return crudo


# --------------------------------------------------------------------------
# Respuestas
# --------------------------------------------------------------------------
def _estado(pila):
    return {
        "actual": pila.peek(),
        "total": len(pila),
        "vacio": pila.esta_vacia(),
        "historial": pila.de_tope_a_base(),
    }


def _resp(pila, ok, mensaje, codigo=200, **extra):
    cuerpo = {"ok": ok, "message": mensaje, "estado": _estado(pila)}
    cuerpo.update(extra)
    return jsonify(cuerpo), codigo


@app.after_request
def _cabeceras(resp):
    nuevo = g.get("nuevo_sid")
    if nuevo:
        resp.set_cookie("sid", nuevo, httponly=True, samesite="Lax", max_age=60 * 60 * 24 * 7)
    if request.path.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-store"
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Referrer-Policy"] = "same-origin"
    resp.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "style-src 'self' https://fonts.googleapis.com; "
        "font-src https://fonts.gstatic.com; "
        "img-src 'self' data:; "
        "frame-ancestors 'none'"
    )
    return resp


# --------------------------------------------------------------------------
# Rutas
# --------------------------------------------------------------------------
@app.get("/")
def index():
    return render_template("index.html")


@app.get("/healthz")
def healthz():
    return "ok", 200


@app.get("/api/estado")
def api_estado():
    pila = _pila_de_la_sesion()
    return _resp(pila, True, "Estado actual.")


# 1. Visitar una página web (push)
@app.post("/api/visitar")
def api_visitar():
    pila = _pila_de_la_sesion()
    datos = request.get_json(silent=True)
    crudo = datos.get("url") if isinstance(datos, dict) else None
    if not isinstance(crudo, str):
        return _resp(pila, False, "Escribe una dirección para visitar.", 400)
    try:
        url = normalizar_url(crudo)
        pila.push(url)
    except (ValueError, OverflowError) as e:
        return _resp(pila, False, str(e), 400)
    return _resp(pila, True, "Página registrada.", pagina=url)


# 2. Regresar a la página anterior (pop)
@app.post("/api/regresar")
def api_regresar():
    pila = _pila_de_la_sesion()
    if pila.esta_vacia():
        return _resp(pila, False, "No hay historial. Visita una página primero.", 409)
    if len(pila) == 1:
        return _resp(pila, False, "Esta es la primera página: no hay una anterior.", 409)
    salio = pila.pop()
    return _resp(pila, True, "Regresaste a la página anterior.", salio=salio)


# 3. Mostrar la página actual (peek)
@app.get("/api/actual")
def api_actual():
    pila = _pila_de_la_sesion()
    return _resp(pila, True, "Página actual.", pagina=pila.peek())


# 4. Historial (de la actual a la primera)
@app.get("/api/historial")
def api_historial():
    pila = _pila_de_la_sesion()
    return _resp(pila, True, "Historial.")


# 5. Eliminar historial
@app.post("/api/limpiar")
def api_limpiar():
    pila = _pila_de_la_sesion()
    if pila.esta_vacia():
        return _resp(pila, False, "El historial ya está vacío.", 409)
    cuantas = len(pila)
    pila.clear()
    return _resp(pila, True, "Historial eliminado.", eliminadas=cuantas)


# 6. Salir
@app.post("/api/salir")
def api_salir():
    pila = _pila_de_la_sesion()
    descartadas = len(pila)
    pila.clear()
    return _resp(pila, True, "Sesión cerrada.", descartadas=descartadas)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8000)), debug=False)
