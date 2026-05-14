from __future__ import annotations

import re
import time
import uuid
from dataclasses import dataclass
from typing import Any, Literal

import httpx

from backend.app.settings import Settings

MessageRole = Literal["USER", "ASSISTANT", "SYSTEM"]
MemoryType = Literal["semantic", "episodic", "message"]

_ACTOR_ID_FALLBACK = "reddash-agent"


def sanitize_actor_id(value: str | None, *, fallback: str = _ACTOR_ID_FALLBACK) -> str:
    """Normalize actor IDs to the Memory API format: alphanumeric + hyphen."""
    cleaned = re.sub(r"[^A-Za-z0-9]+", "-", (value or "").strip()).strip("-")
    return cleaned or fallback


@dataclass(frozen=True)
class MemoryConnection:
    api_base_url: str
    store_id: str
    api_key: str
    owner_id: str
    actor_id: str
    namespace: str
    similarity_threshold: float
    limit: int


class MemoryService:
    def __init__(self, settings: Settings):
        self.settings = settings

    def is_configured(self) -> bool:
        return bool(
            self.settings.memory_api_base_url
            and self.settings.memory_store_id
            and self.settings.memory_api_key
        )

    def connection(self, *, owner_id: str | None = None) -> MemoryConnection:
        return MemoryConnection(
            api_base_url=self.settings.memory_api_base_url.rstrip("/"),
            store_id=self.settings.memory_store_id,
            api_key=self.settings.memory_api_key,
            owner_id=(owner_id or self.settings.memory_owner_id).strip(),
            actor_id=sanitize_actor_id(self.settings.memory_actor_id),
            namespace=self.settings.memory_namespace.strip() or "reddash-demo",
            similarity_threshold=float(self.settings.memory_similarity_threshold),
            limit=max(int(self.settings.memory_limit), 1),
        )

    def _headers(self, connection: MemoryConnection) -> dict[str, str]:
        api_key = connection.api_key
        if not api_key.lower().startswith(("bearer ", "basic ")):
            api_key = f"Bearer {api_key}"
        return {
            "Authorization": api_key,
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    def _url(self, connection: MemoryConnection, path: str) -> str:
        return f"{connection.api_base_url}/v1/stores/{connection.store_id}{path}"

    def _raise_for_error(self, response: httpx.Response) -> None:
        if response.status_code < 400:
            return
        try:
            detail = response.json()
        except Exception:
            detail = response.text
        raise RuntimeError(f"Memory API {response.status_code}: {detail}")

    @staticmethod
    def now_ms() -> int:
        return int(time.time() * 1000)

    def search_long_term_memory(
        self,
        *,
        text: str,
        owner_id: str,
        session_id: str | None = None,
        limit: int | None = None,
        similarity_threshold: float | None = None,
    ) -> list[dict[str, Any]]:
        connection = self.connection(owner_id=owner_id)
        payload: dict[str, Any] = {
            "text": text,
            "similarityThreshold": similarity_threshold or connection.similarity_threshold,
            "filterOp": "all",
            "limit": limit or connection.limit,
            "filter": {
                "ownerId": {"eq": connection.owner_id},
                "namespace": {"eq": connection.namespace},
            },
        }
        if session_id:
            payload["filter"]["sessionId"] = {"eq": session_id}

        with httpx.Client(timeout=httpx.Timeout(30.0, connect=10.0)) as client:
            response = client.post(
                self._url(connection, "/long-term-memory/search"),
                headers=self._headers(connection),
                json=payload,
            )
        self._raise_for_error(response)
        body = response.json() if response.content else {}
        memories = body.get("memories", []) if isinstance(body, dict) else []
        if not isinstance(memories, list):
            return []
        return memories

    async def asearch_long_term_memory(
        self,
        *,
        text: str,
        owner_id: str,
        session_id: str | None = None,
        limit: int | None = None,
        similarity_threshold: float | None = None,
    ) -> list[dict[str, Any]]:
        connection = self.connection(owner_id=owner_id)
        payload: dict[str, Any] = {
            "text": text,
            "similarityThreshold": similarity_threshold or connection.similarity_threshold,
            "filterOp": "all",
            "limit": limit or connection.limit,
            "filter": {
                "ownerId": {"eq": connection.owner_id},
                "namespace": {"eq": connection.namespace},
            },
        }
        if session_id:
            payload["filter"]["sessionId"] = {"eq": session_id}
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0)) as client:
            response = await client.post(
                self._url(connection, "/long-term-memory/search"),
                headers=self._headers(connection),
                json=payload,
            )
        self._raise_for_error(response)
        body = response.json() if response.content else {}
        memories = body.get("memories", []) if isinstance(body, dict) else []
        if not isinstance(memories, list):
            return []
        return memories

    def create_long_term_memory(
        self,
        *,
        text: str,
        owner_id: str,
        memory_type: MemoryType = "semantic",
        topics: list[str] | None = None,
        session_id: str | None = None,
        memory_id: str | None = None,
    ) -> dict[str, Any]:
        connection = self.connection(owner_id=owner_id)
        payload = {
            "memories": [
                {
                    "id": memory_id or str(uuid.uuid4()),
                    "text": text,
                    "memoryType": memory_type,
                    "ownerId": connection.owner_id,
                    "sessionId": session_id,
                    "namespace": connection.namespace,
                    "topics": topics or [],
                }
            ]
        }
        with httpx.Client(timeout=httpx.Timeout(30.0, connect=10.0)) as client:
            response = client.post(
                self._url(connection, "/long-term-memory"),
                headers=self._headers(connection),
                json=payload,
            )
        self._raise_for_error(response)
        return response.json() if response.content else {"ok": True}

    async def add_session_event(
        self,
        *,
        owner_id: str,
        session_id: str | None,
        actor_id: str,
        role: MessageRole,
        text: str,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        connection = self.connection(owner_id=owner_id)
        payload: dict[str, Any] = {
            "actorId": sanitize_actor_id(actor_id, fallback=connection.actor_id),
            "role": role,
            "content": [{"text": text}],
            "createdAt": self.now_ms(),
            "metadata": metadata or {},
        }
        if session_id:
            payload["sessionId"] = session_id
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0)) as client:
            response = await client.post(
                self._url(connection, "/session-memory/events"),
                headers=self._headers(connection),
                json=payload,
            )
        self._raise_for_error(response)
        return response.json() if response.content else {}

    async def get_session(self, *, owner_id: str, session_id: str) -> dict[str, Any]:
        connection = self.connection(owner_id=owner_id)
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0)) as client:
            response = await client.get(
                self._url(connection, f"/session-memory/{session_id}"),
                headers=self._headers(connection),
            )
        self._raise_for_error(response)
        return response.json() if response.content else {}
