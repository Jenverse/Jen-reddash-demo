# Redis Memory Chatbot

Standalone light-theme chatbot UI for Redis Cloud memory demos.

## What it does

- Writes user and assistant turns into session memory
- Loads prior session events before each answer
- Searches long-term memory before generating a reply
- Shows Redis memory and OpenAI operations live in a right-hand trace panel
- Lets you search, create, update, and delete long-term memories

## Run it

From [`reddash-local`](/Users/jen.agarwal/Downloads/context-engine/reddash-local):

```bash
uv run uvicorn memory_chatbot.backend.app:app --reload --host 127.0.0.1 --port 8055
```

Then open [http://127.0.0.1:8055](http://127.0.0.1:8055).

## Environment

These can live in [`reddash-local/.env`](/Users/jen.agarwal/Downloads/context-engine/reddash-local/.env):

```env
OPENAI_API_KEY=
OPENAI_CHAT_MODEL=gpt-4o
REDIS_MEMORY_API_BASE_URL=
REDIS_MEMORY_STORE_ID=
REDIS_MEMORY_API_KEY=
REDIS_MEMORY_OWNER_ID=demo-user
REDIS_MEMORY_ACTOR_ID=web-chat
REDIS_MEMORY_NAMESPACE=memory-chatbot
REDIS_MEMORY_SIMILARITY_THRESHOLD=0.7
REDIS_MEMORY_LIMIT=8
```
