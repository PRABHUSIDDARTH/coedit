"""Canvas scene validation and sanitising. Pure functions: no database, no I/O.

A stored scene is `{"elements": [...], "appState": {"viewBackgroundColor", "gridSize", "gridModeEnabled"}}`.
Everything else Excalidraw puts in its app state (collaborators, selection, scroll, zoom, tool, ...) is
dropped; images, embeddables and iframes are rejected; element links keep only http, https and mailto.
Error messages never echo the input.
"""

import math
import re
from typing import Any
from urllib.parse import urlsplit

MAX_SCENE_BYTES = 5 * 1024 * 1024
MAX_ELEMENTS = 20_000
MAX_POINTS = 50_000
MAX_TEXT = 20_000
MAX_LINK = 2048
MAX_ID = 128

# Images need file storage (out of scope for v1); embeddable/iframe load third-party pages;
# magicframe needs a hosted AI service.
ALLOWED_TYPES = frozenset(
    {"rectangle", "diamond", "ellipse", "arrow", "line", "freedraw", "text", "frame"}
)
ALLOWED_LINK_SCHEMES = frozenset({"http", "https", "mailto"})
_COLOR = re.compile(r"^(#[0-9a-fA-F]{3,8}|transparent)$")
_CONTROL = re.compile(r"[\x00-\x20\x7f-\x9f]")  # incl. spaces: browsers strip them inside schemes
DEFAULT_BACKGROUND = "#ffffff"


class SceneError(ValueError):
    """The scene is not acceptable. The message says where and why, never what was sent."""


def sanitize_link(link: Any) -> str | None:
    """Return the link if it is a short http/https/mailto URL, else None.

    Control characters and whitespace are rejected rather than stripped: browsers ignore tabs and
    newlines inside a scheme, so `java\\tscript:` must not slip through a naive prefix check.
    """
    if not isinstance(link, str) or not link or len(link) > MAX_LINK:
        return None
    if _CONTROL.search(link):
        return None
    try:
        parts = urlsplit(link)
    except ValueError:
        return None
    if parts.scheme.lower() not in ALLOWED_LINK_SCHEMES:
        return None
    if parts.scheme.lower() in {"http", "https"} and not parts.netloc:
        return None
    if parts.scheme.lower() == "mailto" and not parts.path:
        return None
    return link


def _number(value: Any, where: str) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise SceneError(f"{where}: must be a number")
    if not math.isfinite(value) or abs(value) > 1e9:
        raise SceneError(f"{where}: out of range")
    return float(value)


def _element(raw: Any, index: int) -> dict[str, Any] | None:
    """Validate one element. Returns it sanitised, or None for a deleted tombstone."""
    where = f"elements[{index}]"
    if not isinstance(raw, dict):
        raise SceneError(f"{where}: must be an object")
    kind = raw.get("type")
    if not isinstance(kind, str) or kind not in ALLOWED_TYPES:
        raise SceneError(f"{where}: unsupported element type (images are not supported)")
    eid = raw.get("id")
    if not isinstance(eid, str) or not 0 < len(eid) <= MAX_ID or _CONTROL.search(eid):
        raise SceneError(f"{where}: bad id")
    if raw.get("isDeleted") is True:
        return None  # tombstones are not stored in v1
    for key in ("x", "y"):
        _number(raw.get(key), f"{where}.{key}")
    for key in ("width", "height"):
        if key in raw:
            _number(raw[key], f"{where}.{key}")
    text = raw.get("text")
    if text is not None and (not isinstance(text, str) or len(text) > MAX_TEXT):
        raise SceneError(f"{where}.text: too long or not a string")
    points = raw.get("points")
    if points is not None:
        if not isinstance(points, list) or len(points) > MAX_POINTS:
            raise SceneError(f"{where}.points: too many points")
        for p in points:
            if not (isinstance(p, list | tuple) and len(p) >= 2):
                raise SceneError(f"{where}.points: bad point")
            _number(p[0], f"{where}.points")
            _number(p[1], f"{where}.points")
    out = dict(raw)
    if "link" in out:
        out["link"] = sanitize_link(out["link"])
    return out


def _app_state(raw: Any) -> dict[str, Any]:
    if raw is None:
        return {
            "viewBackgroundColor": DEFAULT_BACKGROUND,
            "gridSize": None,
            "gridModeEnabled": False,
        }
    if not isinstance(raw, dict):
        raise SceneError("appState: must be an object")
    color = raw.get("viewBackgroundColor", DEFAULT_BACKGROUND)
    if not isinstance(color, str) or not _COLOR.match(color):
        raise SceneError("appState.viewBackgroundColor: must be a hex colour or 'transparent'")
    grid = raw.get("gridSize")
    if grid is not None and (
        isinstance(grid, bool) or not isinstance(grid, int) or not 1 <= grid <= 1000
    ):
        raise SceneError("appState.gridSize: must be null or an integer from 1 to 1000")
    mode = raw.get("gridModeEnabled", False)
    if not isinstance(mode, bool):
        raise SceneError("appState.gridModeEnabled: must be a boolean")
    return {"viewBackgroundColor": color, "gridSize": grid, "gridModeEnabled": mode}


def validate_scene(raw: Any) -> tuple[dict[str, Any], int]:
    """Return (clean scene, number of links removed). Raises SceneError."""
    if not isinstance(raw, dict):
        raise SceneError("scene: must be an object")
    elements = raw.get("elements")
    if not isinstance(elements, list):
        raise SceneError("scene.elements: must be a list")
    if len(elements) > MAX_ELEMENTS:
        raise SceneError("scene.elements: too many elements")
    clean: list[dict[str, Any]] = []
    removed = 0
    seen: set[str] = set()
    for i, raw_el in enumerate(elements):
        el = _element(raw_el, i)
        if el is None:
            continue
        if el["id"] in seen:
            raise SceneError(f"elements[{i}]: duplicate id")
        seen.add(el["id"])
        if isinstance(raw_el.get("link"), str) and raw_el["link"] and el.get("link") is None:
            removed += 1
        clean.append(el)
    return {"elements": clean, "appState": _app_state(raw.get("appState"))}, removed
