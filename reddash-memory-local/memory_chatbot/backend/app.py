from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter
from typing import Any, AsyncIterator, Literal

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from openai import AsyncOpenAI
from pydantic import AliasChoices, BaseModel, ConfigDict, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_DIR = Path(__file__).resolve().parents[2]
STATIC_DIR = ROOT_DIR / "memory_chatbot" / "static"
ENV_PATH = ROOT_DIR / ".env"
if ENV_PATH.exists():
    load_dotenv(ENV_PATH)


def to_camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part.capitalize() for part in tail)


class CamelModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ENV_PATH),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    openai_api_key: str = Field(default="")
    openai_chat_model: str = Field(default="gpt-4o")
    cors_origin: str = Field(default="http://127.0.0.1:8055,http://localhost:8055")
    memory_api_base_url: str = Field(
        default="",
        validation_alias=AliasChoices("MEMORY_API_BASE_URL", "REDIS_MEMORY_API_BASE_URL"),
    )
    memory_store_id: str = Field(
        default="",
        validation_alias=AliasChoices("MEMORY_STORE_ID", "REDIS_MEMORY_STORE_ID"),
    )
    memory_api_key: str = Field(
        default="",
        validation_alias=AliasChoices("MEMORY_API_KEY", "REDIS_MEMORY_API_KEY"),
    )
    memory_owner_id: str = Field(
        default="demo-user",
        validation_alias=AliasChoices("MEMORY_OWNER_ID", "REDIS_MEMORY_OWNER_ID"),
    )
    memory_actor_id: str = Field(
        default="web-chat",
        validation_alias=AliasChoices("MEMORY_ACTOR_ID", "REDIS_MEMORY_ACTOR_ID"),
    )
    memory_namespace: str = Field(
        default="memory-chatbot",
        validation_alias=AliasChoices("MEMORY_NAMESPACE", "REDIS_MEMORY_NAMESPACE"),
    )
    memory_similarity_threshold: float = Field(
        default=0.7,
        validation_alias=AliasChoices("MEMORY_SIMILARITY_THRESHOLD", "REDIS_MEMORY_SIMILARITY_THRESHOLD"),
    )
    memory_limit: int = Field(
        default=8,
        validation_alias=AliasChoices("MEMORY_LIMIT", "REDIS_MEMORY_LIMIT"),
    )


settings = Settings()
openai_client = AsyncOpenAI(api_key=settings.openai_api_key) if settings.openai_api_key else None


def _cors_origins() -> list[str]:
    raw = (settings.cors_origin or "").strip()
    if not raw:
        return ["http://127.0.0.1:8055", "http://localhost:8055"]
    return [value.strip() for value in raw.split(",") if value.strip()]


app = FastAPI(title="Redis Memory Chatbot")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ConnectionConfig(CamelModel):
    api_base_url: str | None = None
    store_id: str | None = None
    api_key: str | None = None
    owner_id: str | None = None
    actor_id: str | None = None
    namespace: str | None = None
    similarity_threshold: float | None = None
    limit: int | None = None


class ConfiguredRequest(CamelModel):
    config: ConnectionConfig = Field(default_factory=ConnectionConfig)


class SessionRequest(ConfiguredRequest):
    session_id: str


class SessionEventRequest(SessionRequest):
    event_id: str


class MemoryRecord(CamelModel):
    id: str | None = None
    text: str
    memory_type: Literal["semantic", "episodic", "message"] = "semantic"
    owner_id: str | None = None
    session_id: str | None = None
    namespace: str | None = None
    topics: list[str] = Field(default_factory=list)


class MemorySearchRequest(ConfiguredRequest):
    text: str
    similarity_threshold: float | None = None
    limit: int | None = None


class MemoryCreateRequest(ConfiguredRequest):
    memories: list[MemoryRecord]


class MemoryGetRequest(ConfiguredRequest):
    memory_id: str


class MemoryUpdateRequest(ConfiguredRequest):
    memory_id: str
    text: str | None = None
    topics: list[str] | None = None
    namespace: str | None = None


class MemoryDeleteRequest(ConfiguredRequest):
    memory_ids: list[str]


class ChatStreamRequest(ConfiguredRequest):
    session_id: str | None = None
    message: str
    metadata: dict[str, Any] = Field(default_factory=dict)


@dataclass
class ResolvedConnection:
    api_base_url: str
    store_id: str
    api_key: str
    owner_id: str
    actor_id: str
    namespace: str
    similarity_threshold: float
    limit: int


class Timer:
    def __init__(self) -> None:
        self.started_at = perf_counter()

    def elapsed_ms(self) -> int:
        return max(round((perf_counter() - self.started_at) * 1000), 1)


def now_utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def extract_memory_items(payload: Any) -> list[dict[str, Any]]:
    if not isinstance(payload, dict):
        return []
    items = payload.get("items")
    if isinstance(items, list):
        return items
    memories = payload.get("memories")
    if isinstance(memories, list):
        return memories
    return []


def sse(event_type: str, **fields: Any) -> str:
    return f"data: {json.dumps({'type': event_type, **fields})}\n\n"


def _authorization_value(api_key: str) -> str:
    lowered = api_key.lower()
    if lowered.startswith("bearer ") or lowered.startswith("basic "):
        return api_key
    return f"Bearer {api_key}"


def _clean_body(payload: Any) -> Any:
    if payload is None:
        return None
    if isinstance(payload, dict):
        cleaned = {}
        for key, value in payload.items():
            if key.lower() in {"api_key", "apikey", "authorization"}:
                cleaned[key] = "***"
            else:
                cleaned[key] = _clean_body(value)
        return cleaned
    if isinstance(payload, list):
        return [_clean_body(item) for item in payload]
    return payload


def _parse_json(response: httpx.Response) -> Any:
    if response.status_code == 204 or not response.content:
        return None
    try:
        return response.json()
    except json.JSONDecodeError:
        return {"raw": response.text}


def _extract_error_message(detail: Any) -> str:
    if isinstance(detail, dict):
        if "detail" in detail:
            return _extract_error_message(detail["detail"])
        if "error" in detail:
            return str(detail["error"])
        return json.dumps(detail)
    if isinstance(detail, list):
        return ", ".join(_extract_error_message(item) for item in detail)
    return str(detail)


def resolve_connection(config: ConnectionConfig) -> ResolvedConnection:
    api_base_url = (config.api_base_url or settings.memory_api_base_url or "").strip().rstrip("/")
    store_id = (config.store_id or settings.memory_store_id or "").strip()
    api_key = (config.api_key or settings.memory_api_key or "").strip()
    owner_id = (config.owner_id or settings.memory_owner_id or "demo-user").strip()
    actor_id = (config.actor_id or settings.memory_actor_id or "web-chat").strip()
    namespace = (config.namespace or settings.memory_namespace or "memory-chatbot").strip()
    similarity_threshold = config.similarity_threshold or settings.memory_similarity_threshold
    limit = config.limit or settings.memory_limit

    missing = []
    if not api_base_url:
        missing.append("apiBaseUrl")
    if not store_id:
        missing.append("storeId")
    if not api_key:
        missing.append("apiKey")
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Missing required Redis memory configuration: {', '.join(missing)}",
        )

    return ResolvedConnection(
        api_base_url=api_base_url,
        store_id=store_id,
        api_key=api_key,
        owner_id=owner_id,
        actor_id=actor_id,
        namespace=namespace,
        similarity_threshold=float(similarity_threshold),
        limit=max(int(limit), 1),
    )


def memory_headers(connection: ResolvedConnection) -> dict[str, str]:
    return {
        "Authorization": _authorization_value(connection.api_key),
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


def memory_url(connection: ResolvedConnection, path: str) -> str:
    return f"{connection.api_base_url}/v1/stores/{connection.store_id}{path}"


async def perform_memory_request(
    connection: ResolvedConnection,
    *,
    method: str,
    path: str,
    payload: Any = None,
) -> tuple[Any, int]:
    url = memory_url(connection, path)
    timeout = httpx.Timeout(30.0, connect=10.0)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.request(
                method,
                url,
                headers=memory_headers(connection),
                json=payload,
            )
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Redis memory request failed: {exc}") from exc

    body = _parse_json(response)
    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail=body)
    return body, response.status_code


def long_term_search_payload(connection: ResolvedConnection, text: str) -> dict[str, Any]:
    filters: dict[str, Any] = {}
    if connection.namespace:
        filters["namespace"] = {"eq": connection.namespace}
    if connection.owner_id:
        filters["ownerId"] = {"eq": connection.owner_id}

    payload: dict[str, Any] = {
        "text": text,
        "similarityThreshold": connection.similarity_threshold,
        "filterOp": "all",
        "limit": connection.limit,
    }
    if filters:
        payload["filter"] = filters
    return payload


def make_memory_record(connection: ResolvedConnection, memory: MemoryRecord) -> dict[str, Any]:
    return {
        "id": memory.id or str(uuid.uuid4()),
        "text": memory.text,
        "memoryType": memory.memory_type,
        "ownerId": memory.owner_id or connection.owner_id,
        "sessionId": memory.session_id,
        "namespace": memory.namespace or connection.namespace,
        "topics": memory.topics,
    }


def session_lines(events: list[dict[str, Any]]) -> str:
    recent_events = events[-12:]
    if not recent_events:
        return "No previous events."
    lines = []
    for event in recent_events:
        role = str(event.get("role", "UNKNOWN")).upper()
        text = str(event.get("text", "")).strip()
        if not text:
            continue
        lines.append(f"{role}: {text}")
    return "\n".join(lines) if lines else "No previous events."


def memory_lines(memories: list[dict[str, Any]]) -> str:
    if not memories:
        return "No relevant long-term memories found."
    lines = []
    for memory in memories[:8]:
        memory_type = memory.get("memoryType", "memory")
        topics = ", ".join(memory.get("topics", []))
        topic_suffix = f" | topics: {topics}" if topics else ""
        lines.append(f"- [{memory_type}] {memory.get('text', '')}{topic_suffix}")
    return "\n".join(lines)


def build_chat_messages(
    *,
    latest_message: str,
    events: list[dict[str, Any]],
    memories: list[dict[str, Any]],
) -> list[dict[str, str]]:
    system_prompt = (
        "You are a helpful assistant inside a Redis Cloud memory demo. "
        "Use session memory as the conversational timeline and long-term memory as durable user facts. "
        "If long-term memory is relevant, use it naturally. If it is absent, do not invent remembered facts. "
        "Answer clearly and keep the tone practical."
    )
    user_prompt = (
        "Current user message:\n"
        f"{latest_message}\n\n"
        "Session memory:\n"
        f"{session_lines(events)}\n\n"
        "Long-term memories:\n"
        f"{memory_lines(memories)}"
    )
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]


async def emit_memory_request(
    *,
    timer: Timer,
    connection: ResolvedConnection,
    method: str,
    path: str,
    label: str,
    request_body: Any = None,
) -> AsyncIterator[str]:
    op_id = f"op-{uuid.uuid4().hex}"
    url = memory_url(connection, path)
    started = perf_counter()
    yield sse(
        "operation-start",
        operation={
            "id": op_id,
            "label": label,
            "service": "Redis Memory",
            "method": method,
            "url": url,
            "requestBody": _clean_body(request_body),
            "startedAtMs": timer.elapsed_ms(),
            "status": "running",
        },
    )
    try:
        payload, status_code = await perform_memory_request(
            connection,
            method=method,
            path=path,
            payload=request_body,
        )
    except HTTPException as exc:
        duration_ms = max(round((perf_counter() - started) * 1000), 1)
        yield sse(
            "operation-complete",
            operation={
                "id": op_id,
                "label": label,
                "service": "Redis Memory",
                "method": method,
                "url": url,
                "requestBody": _clean_body(request_body),
                "responseBody": _clean_body(exc.detail),
                "statusCode": exc.status_code,
                "durationMs": duration_ms,
                "finishedAtMs": timer.elapsed_ms(),
                "status": "error",
            },
        )
        raise

    duration_ms = max(round((perf_counter() - started) * 1000), 1)
    yield sse(
        "operation-complete",
        operation={
            "id": op_id,
            "label": label,
            "service": "Redis Memory",
            "method": method,
            "url": url,
            "requestBody": _clean_body(request_body),
            "responseBody": _clean_body(payload),
            "statusCode": status_code,
            "durationMs": duration_ms,
            "finishedAtMs": timer.elapsed_ms(),
            "status": "success",
        },
    )
    yield sse("operation-result", operation_id=op_id, payload=payload)


async def redis_request_with_events(
    *,
    timer: Timer,
    connection: ResolvedConnection,
    method: str,
    path: str,
    label: str,
    request_body: Any = None,
) -> tuple[Any, list[str]]:
    payload: Any = None
    events: list[str] = []
    async for event in emit_memory_request(
        timer=timer,
        connection=connection,
        method=method,
        path=path,
        label=label,
        request_body=request_body,
    ):
        events.append(event)
        if event.startswith("data: "):
            parsed = json.loads(event[6:])
            if parsed["type"] == "operation-result":
                payload = parsed.get("payload")
    return payload, [event for event in events if '"operation-result"' not in event]


async def openai_stream(
    *,
    timer: Timer,
    label: str,
    messages: list[dict[str, str]],
) -> AsyncIterator[str]:
    if openai_client is None:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY is not configured.")

    op_id = f"op-{uuid.uuid4().hex}"
    started = perf_counter()
    request_body = {
        "model": settings.openai_chat_model,
        "temperature": 0.4,
        "messages": messages,
        "stream": True,
    }
    yield sse(
        "operation-start",
        operation={
            "id": op_id,
            "label": label,
            "service": "OpenAI",
            "method": "POST",
            "url": "https://api.openai.com/v1/chat/completions",
            "requestBody": _clean_body(request_body),
            "startedAtMs": timer.elapsed_ms(),
            "status": "running",
        },
    )

    full_text = ""
    try:
        stream = await openai_client.chat.completions.create(
            model=settings.openai_chat_model,
            temperature=0.4,
            stream=True,
            messages=messages,
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta.content or ""
            if not delta:
                continue
            full_text += delta
            yield sse("text-delta", delta=delta)
    except Exception as exc:  # pragma: no cover - network/provider failures
        duration_ms = max(round((perf_counter() - started) * 1000), 1)
        yield sse(
            "operation-complete",
            operation={
                "id": op_id,
                "label": label,
                "service": "OpenAI",
                "method": "POST",
                "url": "https://api.openai.com/v1/chat/completions",
                "requestBody": _clean_body(request_body),
                "responseBody": {"error": str(exc)},
                "durationMs": duration_ms,
                "finishedAtMs": timer.elapsed_ms(),
                "statusCode": 500,
                "status": "error",
            },
        )
        raise HTTPException(status_code=500, detail=f"OpenAI request failed: {exc}") from exc

    duration_ms = max(round((perf_counter() - started) * 1000), 1)
    yield sse(
        "operation-complete",
        operation={
            "id": op_id,
            "label": label,
            "service": "OpenAI",
            "method": "POST",
            "url": "https://api.openai.com/v1/chat/completions",
            "requestBody": _clean_body(request_body),
            "responseBody": {"text": full_text},
            "durationMs": duration_ms,
            "finishedAtMs": timer.elapsed_ms(),
            "statusCode": 200,
            "status": "success",
        },
    )
    yield sse("final-text", text=full_text)


@app.get("/api/config")
async def get_config() -> JSONResponse:
    defaults = ConnectionConfig(
        api_base_url=settings.memory_api_base_url or None,
        store_id=settings.memory_store_id or None,
        owner_id=settings.memory_owner_id or None,
        actor_id=settings.memory_actor_id or None,
        namespace=settings.memory_namespace or None,
        similarity_threshold=settings.memory_similarity_threshold,
        limit=settings.memory_limit,
    )
    return JSONResponse(
        {
            "defaults": defaults.model_dump(by_alias=True, exclude_none=True),
            "status": {
                "memoryApiConfigured": bool(
                    settings.memory_api_base_url and settings.memory_store_id and settings.memory_api_key
                ),
                "openAiConfigured": bool(settings.openai_api_key),
                "model": settings.openai_chat_model,
            },
        }
    )


@app.post("/api/sessions/list")
async def list_sessions(request: ConfiguredRequest) -> JSONResponse:
    connection = resolve_connection(request.config)
    payload, _ = await perform_memory_request(connection, method="GET", path="/session-memory")
    return JSONResponse(payload)


@app.post("/api/sessions/get")
async def get_session(request: SessionRequest) -> JSONResponse:
    connection = resolve_connection(request.config)
    payload, _ = await perform_memory_request(
        connection,
        method="GET",
        path=f"/session-memory/{request.session_id}",
    )
    return JSONResponse(payload)


@app.post("/api/sessions/delete")
async def delete_session(request: SessionRequest) -> JSONResponse:
    connection = resolve_connection(request.config)
    await perform_memory_request(
        connection,
        method="DELETE",
        path=f"/session-memory/{request.session_id}",
    )
    return JSONResponse({"deleted": request.session_id})


@app.post("/api/sessions/events/get")
async def get_session_event(request: SessionEventRequest) -> JSONResponse:
    connection = resolve_connection(request.config)
    payload, _ = await perform_memory_request(
        connection,
        method="GET",
        path=f"/session-memory/{request.session_id}/events/{request.event_id}",
    )
    return JSONResponse(payload)


@app.post("/api/sessions/events/delete")
async def delete_session_event(request: SessionEventRequest) -> JSONResponse:
    connection = resolve_connection(request.config)
    await perform_memory_request(
        connection,
        method="DELETE",
        path=f"/session-memory/{request.session_id}/events/{request.event_id}",
    )
    return JSONResponse({"deleted": request.event_id})


@app.post("/api/memories/search")
async def search_memories(request: MemorySearchRequest) -> JSONResponse:
    connection = resolve_connection(request.config)
    search_connection = ResolvedConnection(
        api_base_url=connection.api_base_url,
        store_id=connection.store_id,
        api_key=connection.api_key,
        owner_id=connection.owner_id,
        actor_id=connection.actor_id,
        namespace=connection.namespace,
        similarity_threshold=request.similarity_threshold or connection.similarity_threshold,
        limit=request.limit or connection.limit,
    )
    payload, _ = await perform_memory_request(
        search_connection,
        method="POST",
        path="/long-term-memory/search",
        payload=long_term_search_payload(search_connection, request.text),
    )
    return JSONResponse(payload)


@app.post("/api/memories/create")
async def create_memories(request: MemoryCreateRequest) -> JSONResponse:
    connection = resolve_connection(request.config)
    payload, _ = await perform_memory_request(
        connection,
        method="POST",
        path="/long-term-memory",
        payload={"memories": [make_memory_record(connection, memory) for memory in request.memories]},
    )
    return JSONResponse(payload)


@app.post("/api/memories/get")
async def get_memory(request: MemoryGetRequest) -> JSONResponse:
    connection = resolve_connection(request.config)
    payload, _ = await perform_memory_request(
        connection,
        method="GET",
        path=f"/long-term-memory/{request.memory_id}",
    )
    return JSONResponse(payload)


@app.post("/api/memories/update")
async def update_memory(request: MemoryUpdateRequest) -> JSONResponse:
    connection = resolve_connection(request.config)
    patch_body: dict[str, Any] = {}
    if request.text is not None:
        patch_body["text"] = request.text
    if request.topics is not None:
        patch_body["topics"] = request.topics
    patch_body["namespace"] = request.namespace or connection.namespace
    payload, _ = await perform_memory_request(
        connection,
        method="PATCH",
        path=f"/long-term-memory/{request.memory_id}",
        payload=patch_body,
    )
    return JSONResponse(payload)


@app.post("/api/memories/delete")
async def delete_memories(request: MemoryDeleteRequest) -> JSONResponse:
    connection = resolve_connection(request.config)
    payload, _ = await perform_memory_request(
        connection,
        method="DELETE",
        path="/long-term-memory",
        payload={"memoryIds": request.memory_ids},
    )
    return JSONResponse(payload)


@app.post("/api/chat/stream")
async def chat_stream(request: ChatStreamRequest) -> StreamingResponse:
    async def event_stream() -> AsyncIterator[str]:
        timer = Timer()
        session_id = request.session_id or str(uuid.uuid4())
        message = request.message.strip()
        if not message:
            yield sse("error", message="Message cannot be empty.")
            yield sse("done", sessionId=session_id, totalElapsedMs=timer.elapsed_ms())
            return

        try:
            connection = resolve_connection(request.config)
        except HTTPException as exc:
            yield sse("error", message=_extract_error_message(exc.detail))
            yield sse("done", sessionId=session_id, totalElapsedMs=timer.elapsed_ms())
            return

        user_event_payload = {
            "sessionId": session_id,
            "actorId": connection.actor_id,
            "role": "USER",
            "text": message,
            "createdAt": now_utc_iso(),
            "metadata": {
                "source": "memory-chatbot-ui",
                **request.metadata,
            },
        }
        try:
            session_data, events = await redis_request_with_events(
                timer=timer,
                connection=connection,
                method="POST",
                path="/session-memory/events",
                label="Add user event",
                request_body=user_event_payload,
            )
            for event in events:
                yield event
            if session_data:
                yield sse("session-event-saved", sessionId=session_id, role="USER")

            session_payload, events = await redis_request_with_events(
                timer=timer,
                connection=connection,
                method="GET",
                path=f"/session-memory/{session_id}",
                label="Load session memory",
            )
            for event in events:
                yield event
            session_events = session_payload.get("events", []) if isinstance(session_payload, dict) else []
            yield sse("session-loaded", sessionId=session_id, eventCount=len(session_events))

            memory_search_payload = long_term_search_payload(connection, message)
            memory_payload, events = await redis_request_with_events(
                timer=timer,
                connection=connection,
                method="POST",
                path="/long-term-memory/search",
                label="Search long-term memory",
                request_body=memory_search_payload,
            )
            for event in events:
                yield event
            memories = extract_memory_items(memory_payload)
            yield sse("memory-search-finished", sessionId=session_id, matchCount=len(memories))

            final_text = ""
            async for event in openai_stream(
                timer=timer,
                label="Generate assistant reply",
                messages=build_chat_messages(
                    latest_message=message,
                    events=session_events,
                    memories=memories,
                ),
            ):
                yield event
                if event.startswith("data: "):
                    parsed = json.loads(event[6:])
                    if parsed["type"] == "final-text":
                        final_text = parsed.get("text", "")

            assistant_event_payload = {
                "sessionId": session_id,
                "actorId": "assistant",
                "role": "ASSISTANT",
                "text": final_text,
                "createdAt": now_utc_iso(),
                "metadata": {
                    "source": "memory-chatbot-ui",
                    "model": settings.openai_chat_model,
                    "memoryMatches": len(memories),
                },
            }
            _, events = await redis_request_with_events(
                timer=timer,
                connection=connection,
                method="POST",
                path="/session-memory/events",
                label="Save assistant reply",
                request_body=assistant_event_payload,
            )
            for event in events:
                yield event
        except HTTPException as exc:
            yield sse("error", message=_extract_error_message(exc.detail))

        yield sse("done", sessionId=session_id, totalElapsedMs=timer.elapsed_ms())

    return StreamingResponse(event_stream(), media_type="text/event-stream")


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="memory-chatbot-ui")
