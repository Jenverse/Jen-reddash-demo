# Jen Reddash Demo

Public repo for the Reddash demo code extracted from the local `cloud-context-engine` workspace.

## Included demos

- `reddash-local`
  Context Retriever demo with live Redis-backed context surfaces and a simple-RAG comparison mode.

- `reddash-memory-local`
  Context Retriever + Agent Memory demo, including the memory-backed chat experience.

## What is not included

This repo is intentionally sanitized for public sharing.

- no local `.env` files
- no Vercel linkage files
- no local virtualenvs
- no generated output directories
- no local preview artifacts

## Likely starting points

- `reddash-local/README.md`
- `reddash-memory-local/README.md`
- `reddash-memory-local/MEMORY_CONTEXT_SURFACE_DEMO_SCRIPT.md`

## Agent keys

Both demos generate MCP agent keys during setup.

- Run `make setup-surface` inside `reddash-local` or `reddash-memory-local`.
- The setup script creates or reuses a Context Surface, then creates an agent key with the admin API.
- It writes `CTX_SURFACE_ID` and `MCP_AGENT_KEY` into that demo's `.env`.

If you need a new key for an existing surface, clear `MCP_AGENT_KEY` in `.env` and rerun `make setup-surface`.

## Calling tools after surface creation

Once a surface exists and `MCP_AGENT_KEY` is set, the generated MCP tools can be listed and called through the `context-surfaces` SDK.

- The backend wrappers live in `reddash-local/backend/app/context_surface_service.py` and `reddash-memory-local/backend/app/context_surface_service.py`.
- The full setup and Python calling example now live in:
  - `reddash-local/README.md`
  - `reddash-memory-local/README.md`
