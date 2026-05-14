from __future__ import annotations

from contextvars import ContextVar

_thread_id: ContextVar[str | None] = ContextVar("reddash_thread_id", default=None)


def set_thread_id(value: str | None) -> object:
    return _thread_id.set(value)


def reset_thread_id(token: object) -> None:
    _thread_id.reset(token)


def get_thread_id() -> str | None:
    return _thread_id.get()
