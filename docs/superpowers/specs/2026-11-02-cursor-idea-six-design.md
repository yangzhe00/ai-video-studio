# Cursor inspiration: six-script design

## Intent

For one keyword, show three 5–10 second single-shot scripts initially. The user may request three more once, for a maximum of six selectable scripts. Keep all six available after refresh and on another device. Use Cursor Cloud Agents as the only provider for inspiration.

## Behavior

- The first request keeps the existing durable `clientRequestId`, account ownership, daily limit, and provider reconciliation behavior.
- A separate explicit “再生成 3 条” action creates one linked Cursor run. The first three scripts remain visible while it runs. The second prompt includes the first three scripts and asks for distinct alternatives; the API rejects duplicates across both batches.
- The server owns the six-script limit and returns one root idea snapshot with three or six variants and a separate expansion state. Second-batch variant IDs are `variant-4` through `variant-6`. Selection and editing work for any of the six.
- The second request has its own stable request ID. Repeating the request ID reads the existing job. An uncertain provider response is reconciled by querying the same Cursor agent, never automatically resubmitted. After a definite failure, the user may explicitly retry the second batch; at most one successful second batch is retained.
- Old completed idea records remain readable. Pending legacy `chat`/`agents` jobs become `unknown` during migration; no new calls are made to those providers.
- The shared Web/Desktop idea component shows the limit, pending and error states. Changing the keyword starts a new root idea group. Existing per-account daily rate limits count each attempted batch.

## Provider boundary

Remove only the inspiration `chat` and OpenAI Agents API adapters, provider switch, related configuration, and tests. Keep the separate Agent edit feature and require its dedicated `AGENT_EDIT_MODEL_*` settings; it no longer falls back to removed `IDEA_MODEL_*` settings. Keep provider credentials server-side.

## Approach

Chosen: link the second batch in PostgreSQL and aggregate it into the root API snapshot. A client-only merge would lose the six-script view across devices and could not enforce the limit. A single six-script model call would not deliver the initial three promptly or preserve the explicit second request.

## Acceptance

One keyword yields exactly three scripts; one explicit expansion can yield three more; six are visible and selectable after refresh and on another device. A second successful expansion is rejected without a Cursor call. Account isolation, input changes, duplicate output, provider failure, uncertain response, and repeated request IDs preserve correct counts and existing scripts. No new OpenAI or Chat Completions inspiration calls remain.
