"""Filesystem boundary for agent-owned user/thread workspaces.

This is path validation, not a sandbox against a hostile local OS user.
Runtime authentication must supply user_id/thread_id; never trust an LLM for them.
"""
from pathlib import Path, PureWindowsPath
import re

_RESERVED = re.compile(r"^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)", re.I)


def _component(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", value) or _RESERVED.match(value):
        raise ValueError("Invalid user/thread identifier.")
    return value


def contained_path(root, relative, *, allow_empty=False):
    if not isinstance(relative, str):
        raise ValueError("A relative path is required.")
    candidate = relative.replace("\\", "/")
    if not candidate and allow_empty:
        return Path(root).resolve()
    if not candidate or candidate.startswith("/") or PureWindowsPath(candidate).drive:
        raise ValueError("Absolute and empty paths are forbidden.")
    parts = candidate.split("/")
    if any(part in {"", ".", ".."} or part.endswith((" ", ".")) or _RESERVED.match(part)
           or any(ord(char) < 32 or char in ':*?"<>|' for char in part) for part in parts):
        raise ValueError("Invalid workspace path.")
    boundary = Path(root).resolve()
    cursor = boundary
    for part in parts:
        cursor = cursor / part
        if cursor.is_symlink() or (hasattr(cursor, "is_junction") and cursor.is_junction()):
            raise ValueError("Workspace links and junctions are forbidden.")
    target = cursor.resolve()
    if not target.is_relative_to(boundary) or target == boundary:
        raise ValueError("Path leaves the authorized workspace.")
    return target


def thread_directory(base, user, thread):
    root = Path(base).resolve()
    folder = contained_path(root, _component(user) + "/" + _component(thread))
    folder.mkdir(parents=True, exist_ok=True)
    return folder
