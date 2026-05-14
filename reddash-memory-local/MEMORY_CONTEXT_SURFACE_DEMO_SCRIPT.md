# Reddash + Context Surface + Memory Demo Script

This demo shows three things in one flow:

1. `Context Surface` retrieves live operational data from Redis.
2. `Short-term memory` keeps session context across turns.
3. `Long-term memory` stores durable user preferences and reuses them later.

## What to run

Backend:

```bash
cd /Users/jen.agarwal/Downloads/context-engine/reddash-memory-local
.venv/bin/uvicorn backend.app.main:app --host 127.0.0.1 --port 8040
```

Frontend:

```bash
cd /Users/jen.agarwal/Downloads/context-engine/reddash-memory-local/frontend
npm run dev
```

Default local URLs:

- Frontend: `http://127.0.0.1:3040`
- Backend health: `http://127.0.0.1:8040/api/health`

## Demo narrative

Use one thread for the full flow. Do not refresh between steps.

### Step 1: Show Context Surface retrieval on real customer data

Ask:

```text
Why is my order running late?
```

What to point out:

- The trace should show `Context Retriever` tool calls.
- The agent should identify the signed-in user, pull order data, and inspect delivery events or driver status.
- This establishes that the answer comes from live business records, not only from the model.

### Step 2: Store a durable preference in long-term memory

Ask:

```text
Please remember that I prefer contactless delivery and spicy food for future orders.
```

What to point out:

- The trace should show:
  - `Short-term memory · GET`
  - `Long-term memory · SEARCH`
  - `Long-term memory · CREATE`
- The agent should explicitly save the preference.
- Click the `Memory` button after the turn finishes.

What to show in the Memory dashboard:

- `Short-term memory` should contain the recent user and assistant turns from this thread.
- `Long-term memory` should contain durable facts such as:
  - `Prefers contactless delivery for future orders.`
  - `Prefers spicy food for future orders.`

### Step 3: Show memory retrieval without forcing the user to ask "what do you remember?"

Ask:

```text
Given what you know about me, what should I order tonight and how should it be delivered?
```

What to point out:

- The trace should show:
  - `Short-term memory · GET`
  - `Long-term memory · SEARCH`
- The answer should reflect the stored preferences:
  - spicy food
  - contactless delivery

This proves the system is using memory automatically during normal conversation.

### Step 4: Show Context Surface + Memory together in one answer

Ask:

```text
Given what you know about me, look at my recent orders and tell me what I should reorder tonight and how it should be delivered.
```

What to point out:

- The trace should show both:
  - `Memory` retrieval
  - `Context Retriever` calls such as `filter_order_by_customer_id`
- The answer should combine:
  - real order history from Redis
  - durable user preference from memory

This is the strongest step in the demo. It shows that memory does not replace retrieval. It enriches retrieval.

## Suggested talk track

Use this framing:

```text
Context Surfaces answers questions from live operational data.
Memory adds continuity across sessions and lets the agent personalize answers.
Together, they let the agent answer from both facts and user-specific preferences.
```

More concrete version:

```text
The Context Surface gives the agent structured business tools over Redis.
Memory keeps durable user preferences and short-term conversation state.
In the combined flow, the agent first retrieves what it knows about the user, then retrieves what is true in the business system, and then answers using both.
```

## What good trace looks like

For the combined turn, the ideal trace sequence is:

1. `Short-term memory · GET`
2. `Long-term memory · SEARCH`
3. `Current user profile`
4. `Context Retriever` call on orders or deliveries
5. final answer

## Failure modes to avoid during the demo

- Do not start a new thread between steps 2, 3, and 4.
- Do not clear memory before the personalization steps.
- If the `Memory` button is empty, confirm the backend has memory env vars and restart the backend.
- If the trace shows memory but the answer ignores preferences, rerun step 3 before step 4 so the recent thread context is visible too.

## Optional backup prompts

If the primary prompts are too narrow, use these backups:

```text
Show me my order history.
```

```text
Please remember that I usually want contactless delivery.
```

```text
Use my preferences and my recent orders to recommend what I should get tonight.
```

## Demo goal

The goal is not to show memory as a separate chatbot feature.

The goal is to show:

- `Context Surface` = structured access to live business data
- `Memory` = continuity and personalization
- `Combined` = better agent behavior than either one alone
