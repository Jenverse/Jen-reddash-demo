from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Sequence

from backend.app.memory_service import MemoryService
from backend.app.request_context import get_thread_id
from backend.app.core.domain_contract import (
    BrandingConfig,
    DomainManifest,
    GeneratedDataset,
    IdentityConfig,
    InternalToolDefinition,
    NamespaceConfig,
    PromptCard,
    RagConfig,
    ThemeConfig,
)
from backend.app.core.domain_schema import EntitySpec
from backend.app.redis_connection import create_redis_client
from domains.reddash.data_generator import generate_demo_data
from domains.reddash.prompt import build_system_prompt
from domains.reddash.schema import ENTITY_SPECS

ROOT = Path(__file__).resolve().parents[2]


class ReddashDomain:
    manifest = DomainManifest(
        id="reddash",
        description="Food-delivery support demo comparing Context Surfaces vs simple RAG.",
        generated_models_module="domains.reddash.generated_models",
        generated_models_path="domains/reddash/generated_models.py",
        output_dir="output/reddash",
        branding=BrandingConfig(
            app_name="Reddash",
            subtitle="Delivery Support",
            hero_title="How can we help?",
            placeholder_text="Ask about your order, delivery status, or policies...",
            logo_path="domains/reddash/assets/logo.svg",
            demo_steps=[
                "Why is my order running late?",
                "Please remember that I prefer contactless delivery and spicy food for future orders.",
                "Click Memory",
                "Given what you know about me, look at my recent orders and tell me what I should reorder tonight and how it should be delivered.",
            ],
            starter_prompts=[
                PromptCard(eyebrow="Order Status", title="Why is my order running late?", prompt="Why is my order running late?"),
                PromptCard(eyebrow="Order History", title="Show me my recent orders", prompt="Show me my order history"),
                PromptCard(eyebrow="Policy", title="What's your refund policy for late deliveries?", prompt="What is your refund policy for late deliveries?"),
                PromptCard(eyebrow="Search", title="Find me a good sushi restaurant", prompt="Can you find me a good sushi restaurant?"),
                PromptCard(eyebrow="Memory", title="Remember my delivery preferences", prompt="Please remember that I prefer contactless delivery and spicy food."),
                PromptCard(eyebrow="Memory", title="Use what you know about me", prompt="Given what you know about me, what should I order tonight and how should it be delivered?"),
                PromptCard(eyebrow="Combined", title="Use memory and order history", prompt="Given what you know about me, look at my recent orders and tell me what I should reorder tonight and how it should be delivered."),
                PromptCard(eyebrow="Driver", title="Who's handling my order?", prompt="Which driver is handling my active order right now?"),
                PromptCard(eyebrow="Payment", title="Was I charged correctly?", prompt="Did I get charged correctly for my latest order?"),
                PromptCard(eyebrow="Refund", title="What refund should I expect?", prompt="If my order arrives very late, what refund should I expect?"),
            ],
            theme=ThemeConfig(
                bg="#0d0f14",
                bg_accent_a="rgba(255, 68, 56, 0.12)",
                bg_accent_b="rgba(255, 140, 66, 0.1)",
                panel="rgba(20, 23, 32, 0.88)",
                panel_strong="rgba(24, 28, 40, 0.96)",
                panel_elevated="rgba(30, 35, 50, 0.92)",
                line="rgba(255, 120, 90, 0.1)",
                line_strong="rgba(255, 120, 90, 0.18)",
                text="#f2f0ed",
                muted="#9a9490",
                soft="#d4cfc8",
                accent="#ff4438",
                user="#2a2420",
            ),
        ),
        namespace=NamespaceConfig(
            redis_prefix="reddash",
            dataset_meta_key="reddash:meta:dataset",
            checkpoint_prefix="reddash:checkpoint",
            checkpoint_write_prefix="reddash:checkpoint_write",
            redis_instance_name="Reddash Redis Cloud",
            surface_name="Reddash Delivery Surface",
            agent_name="Reddash Delivery Agent",
        ),
        rag=RagConfig(
            tool_name="vector_search_policies",
            status_text="Searching policies via vector similarity…",
            generating_text="Generating answer…",
            index_name_contains="policy",
            vector_field="content_embedding",
            return_fields=["title", "category", "content", "policy_id"],
            num_results=3,
            answer_system_prompt=(
                "You are the Reddash delivery-support assistant. "
                "Answer using only the policy documents below. If the policies do not cover the "
                "question, say so. Be concise and helpful."
            ),
        ),
        identity=IdentityConfig(
            default_id="CUST_DEMO_001",
            default_name="Alex Rivera",
            default_email="alex.rivera@example.com",
            description=(
                "Returns the signed-in customer's ID, name, and email. "
                "Call this whenever the user asks about their orders, account, or history."
            ),
        ),
    )

    def get_entity_specs(self) -> tuple[EntitySpec, ...]:
        return ENTITY_SPECS

    def get_runtime_config(self, settings: Any) -> dict[str, Any]:
        memory_service = MemoryService(settings)
        return {
            "memory_enabled": memory_service.is_configured(),
        }

    def build_system_prompt(
        self,
        *,
        mcp_tools: Sequence[dict[str, Any]],
        runtime_config: dict[str, Any] | None = None,
    ) -> str:
        return build_system_prompt(
            mcp_tools=mcp_tools,
            memory_enabled=bool((runtime_config or {}).get("memory_enabled")),
        )

    def build_answer_verifier_prompt(self, *, runtime_config: dict[str, Any] | None = None) -> str:
        del runtime_config
        return (
            "When the user refers to 'that order', 'that charge', or similar follow-ups, resolve the reference to the exact "
            "order, payment, or ticket from the prior turn. Do not mention refunds, credits, or policy outcomes unless the "
            "tool results or cited policy support them."
        )

    def describe_tool_trace_step(
        self,
        *,
        tool_name: str,
        payload: Any,
        runtime_config: dict[str, Any] | None = None,
    ) -> str | None:
        del runtime_config
        detail = ""
        if isinstance(payload, dict):
            for key in ("query", "text", "order_id", "customer_id", "payment_id", "ticket_id"):
                value = payload.get(key)
                if value:
                    detail = str(value)
                    break

        if tool_name == self.manifest.identity.tool_name:
            return "Identify the signed-in customer before checking account or order data."
        if tool_name == "get_current_time":
            return "Compare the current time against order and delivery timestamps."
        if tool_name.startswith("search_policy_by_text"):
            return f"Search delivery policy guidance: {detail or 'policy search'}."
        if tool_name.startswith("filter_driver_by_"):
            return "Check the live driver assignment and status for the relevant order."
        if tool_name.startswith("filter_payment_by_"):
            return "Inspect the payment record before answering charges, credits, or refunds."
        if tool_name == "search_customer_memory":
            return "Search durable customer memory for preferences, past issues, or stored context."
        if tool_name == "remember_customer_detail":
            return "Store a durable customer fact or preference for future conversations."
        return None

    def get_internal_tool_definitions(
        self,
        *,
        runtime_config: dict[str, Any] | None = None,
    ) -> Sequence[InternalToolDefinition]:
        tools: list[InternalToolDefinition] = [
            InternalToolDefinition(
                name=self.manifest.identity.tool_name,
                description=self.manifest.identity.description,
            ),
            InternalToolDefinition(
                name="get_current_time",
                description=(
                    "Returns the current date and time in UTC (ISO 8601). "
                    "Use this to compare against order timestamps and determine if a delivery is late."
                ),
            ),
            InternalToolDefinition(
                name="dataset_overview",
                description="Returns a summary of the current Reddash dataset: counts of customers, restaurants, orders, and policies.",
            ),
        ]
        if (runtime_config or {}).get("memory_enabled"):
            tools.extend(
                [
                    InternalToolDefinition(
                        name="search_customer_memory",
                        description=(
                            "Search durable customer memory for preferences, prior incidents, or facts from previous sessions. "
                            "Use this when the user asks what you remember, refers to preferences, or wants continuity across conversations."
                        ),
                        input_schema={
                            "type": "object",
                            "properties": {
                                "query": {"type": "string", "description": "What to look up in customer memory."},
                                "limit": {"type": "integer", "description": "Optional max number of memories to return.", "default": 5},
                            },
                            "required": ["query"],
                        },
                    ),
                    InternalToolDefinition(
                        name="remember_customer_detail",
                        description=(
                            "Save a durable customer preference or fact into long-term memory. "
                            "Only use this when the user explicitly asks you to remember something or states a lasting preference."
                        ),
                        input_schema={
                            "type": "object",
                            "properties": {
                                "text": {"type": "string", "description": "The exact customer preference or durable fact to remember."},
                                "memory_type": {
                                    "type": "string",
                                    "description": "Memory type: semantic for preferences/facts, episodic for a notable event, message for a verbatim note.",
                                    "default": "semantic",
                                },
                                "topics": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "description": "Optional topic tags like delivery, food, preferences, refund.",
                                },
                            },
                            "required": ["text"],
                        },
                    ),
                ]
            )
        return tuple(tools)

    def execute_internal_tool(self, tool_name: str, arguments: dict[str, Any], settings: Any) -> dict[str, Any]:
        from datetime import datetime, timezone

        if tool_name == self.manifest.identity.tool_name:
            identity = self.manifest.identity
            return {
                identity.id_field: os.getenv(identity.id_env_var, identity.default_id),
                "name": os.getenv(identity.name_env_var, identity.default_name),
                "email": os.getenv(identity.email_env_var, identity.default_email),
            }
        if tool_name == "get_current_time":
            now = datetime.now(timezone.utc)
            return {"current_time": now.isoformat(), "timezone": "UTC"}
        if tool_name == "dataset_overview":
            client = create_redis_client(settings)
            raw = client.execute_command("JSON.GET", self.manifest.namespace.dataset_meta_key, "$")
            if raw:
                data = json.loads(raw)
                return data[0] if isinstance(data, list) else data
            return {"error": "Dataset metadata not found. Run the data loader first."}
        return {"error": f"Unknown tool: {tool_name}"}

    async def aexecute_internal_tool(self, tool_name: str, arguments: dict[str, Any], settings: Any) -> dict[str, Any]:
        if tool_name not in {"search_customer_memory", "remember_customer_detail"}:
            return self.execute_internal_tool(tool_name, arguments, settings)

        identity = self.manifest.identity
        owner_id = os.getenv(identity.id_env_var, identity.default_id)
        memory_service = MemoryService(settings)
        if not memory_service.is_configured():
            return {"error": "Memory service is not configured for this demo."}

        if tool_name == "search_customer_memory":
            query = str(arguments.get("query", "")).strip()
            if not query:
                return {"error": "query is required"}
            limit = arguments.get("limit")
            memories = memory_service.search_long_term_memory(
                text=query,
                owner_id=owner_id,
                limit=int(limit) if limit is not None else None,
            )
            return {
                "owner_id": owner_id,
                "query": query,
                "memory_count": len(memories),
                "memories": [
                    {
                        "id": memory.get("id"),
                        "text": memory.get("text"),
                        "memory_type": memory.get("memoryType"),
                        "topics": memory.get("topics", []),
                        "session_id": memory.get("sessionId"),
                        "created_at": memory.get("createdAt"),
                    }
                    for memory in memories
                ],
            }

        text = str(arguments.get("text", "")).strip()
        if not text:
            return {"error": "text is required"}
        memory_type = str(arguments.get("memory_type", "semantic")).strip() or "semantic"
        if memory_type not in {"semantic", "episodic", "message"}:
            memory_type = "semantic"
        topics = arguments.get("topics") or []
        if not isinstance(topics, list):
            topics = []
        created = memory_service.create_long_term_memory(
            text=text,
            owner_id=owner_id,
            memory_type=memory_type,
            topics=[str(topic).strip() for topic in topics if str(topic).strip()],
            session_id=get_thread_id(),
        )
        return {
            "owner_id": owner_id,
            "saved_text": text,
            "memory_type": memory_type,
            "topics": topics,
            "response": created,
        }

    def write_dataset_meta(self, *, settings: Any, records: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
        summary = {
            "customers": len(records.get("Customer", [])),
            "restaurants": len(records.get("Restaurant", [])),
            "drivers": len(records.get("Driver", [])),
            "orders": len(records.get("Order", [])),
            "order_items": len(records.get("OrderItem", [])),
            "delivery_events": len(records.get("DeliveryEvent", [])),
            "payments": len(records.get("Payment", [])),
            "support_tickets": len(records.get("SupportTicket", [])),
            "policies": len(records.get("Policy", [])),
        }
        client = create_redis_client(settings)
        client.execute_command(
            "JSON.SET",
            self.manifest.namespace.dataset_meta_key,
            "$",
            json.dumps(summary, ensure_ascii=False),
        )
        return summary

    def generate_demo_data(
        self,
        *,
        output_dir: Path,
        seed: int | None = None,
        update_env_file: bool = True,
    ) -> GeneratedDataset:
        return generate_demo_data(output_dir=output_dir, seed=seed, update_env_file=update_env_file)

    def validate(self) -> list[str]:
        errors: list[str] = []
        seen_classes: set[str] = set()
        seen_files: set[str] = set()
        for spec in self.get_entity_specs():
            if spec.class_name in seen_classes:
                errors.append(f"Duplicate entity class name: {spec.class_name}")
            if spec.file_name in seen_files:
                errors.append(f"Duplicate entity file name: {spec.file_name}")
            seen_classes.add(spec.class_name)
            seen_files.add(spec.file_name)
        if not (ROOT / self.manifest.branding.logo_path).exists():
            errors.append(f"Logo file not found: {self.manifest.branding.logo_path}")
        if not self.manifest.branding.starter_prompts:
            errors.append("Branding must define at least one starter prompt")
        return errors


DOMAIN = ReddashDomain()
