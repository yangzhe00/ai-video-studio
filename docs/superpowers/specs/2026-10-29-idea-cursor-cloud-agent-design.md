# Cursor Cloud Agent inspiration adapter

## Intent

Let the existing keyword-to-three-single-shot-scripts flow use Cursor Cloud Agents API from the API server, then discover which models the account can use after a server-side Cursor key is configured. Keep web and desktop clients and the idea draft contract unchanged.

## Approaches

- **Chosen:** add a `cursor` provider beside the existing Chat Completions and OpenAI Agents providers. This matches Cursor's own agent/run protocol and preserves the product flow.
- Reuse Chat Completions with a Cursor key: rejected because Cursor's Cloud Agents API has different endpoints and response shapes.
- Replace the idea flow with Cursor UI/CLI automation: rejected because it would couple visitor requests to an interactive developer session.

## Contract

- `IDEA_PROVIDER=cursor`, `CURSOR_API_KEY=<server secret>`, optional `IDEA_CURSOR_MODEL=<id returned by GET /v1/models>`.
- Create one no-repository Cursor agent per idea request with a deterministic `agentId` derived from the persisted idea ID, so a lost create response can be reconciled without submitting again.
- Persist the Cursor agent ID and run ID separately. Poll the run, treat only `FINISHED` as successful, parse its `result` with the shared exactly-three-distinct-variants validator, and keep failed/unknown states visible.
- Never send a Cursor credential to clients or log it. Avoid retrying a create call after an uncertain outcome. Existing per-account/platform limits and selection remain in force.
- Use Cursor's default model when `IDEA_CURSOR_MODEL` is empty. Discover exact model IDs through Cursor's authenticated `GET /v1/models` after the key is configured.

## Deployment

The production API currently runs a release without this adapter. Build and test first, deploy as a new release, back up SQLite before schema migration, switch service only when the new release is ready. A keyless deployment may expose the usual `not_configured` response until the operator writes `CURSOR_API_KEY` in `/etc/ai-video-studio/api.env`.

## Source

[Cursor Cloud Agents API](https://cursor.com/docs/cloud-agent/api/endpoints): create agent, get agent, get run, list models.
