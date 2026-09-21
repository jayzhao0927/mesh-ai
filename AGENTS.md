# MESH — engineering notes

Messaging-first AI connection platform. Website → Message → Meet.

## Stack

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind 4 · PostgreSQL · Prisma 6 · Vitest.
Modular monolith: `src/modules/<module>`, no microservices.

## Run locally

```bash
cp .env.example .env          # all providers default to mock
npm install
npm run db:migrate            # applies prisma/migrations to DATABASE_URL
npm run dev                   # http://localhost:3000
npm run worker                # separate shell: drains AgentJob + Outbox
```

Local development must boot with no Photon, OpenAI or other real credentials.

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

Tests need an empty database at `TEST_DATABASE_URL`; `pretest` migrates it and the
setup file truncates between tests.

## Module boundaries

| Module | Responsibility |
| --- | --- |
| `config` | Validated environment, dev-surface gating |
| `providers/messaging` | Provider interface + Mock / Photon / WebFallback adapters, deep-link rules |
| `providers/ai` | Agent turn interface + Mock (deterministic) / OpenAI (declared only) |
| `providers/video`, `providers/verification` | Mock implementations, clearly labelled as mock |
| `messaging` | Ingress → identity resolution → conversation → durable inbox/outbox → worker |
| `agent` | Runtime and validated tools; the only path from model output to domain state |
| `relationship` | Relationship signals and the confirm / reject lifecycle |
| `shared` | Prisma client, crypto, domain errors |

Rules that must not be broken:

- The Agent never touches the database directly; it goes Agent → validated tool →
  domain service → repository.
- `userId` is bound server-side from the resolved messaging identity. A tool never
  accepts a user id from the model.
- Nothing the model proposes is matchable until the user confirms it, and a rejected
  signal is not recreated by the same phrase.
- Provider capabilities that are not verified against official docs are not
  implemented; they throw `NotImplementedByProvider` instead of faking success.
- An undetermined send goes to `NEEDS_RECONCILIATION`, never a blind retry.

## Implementation status

Phase 1 (foundation) is complete and parts of Phase 2 (messaging agent and memory)
are working against the mock providers.

Implemented and tested:

- Messaging gateway: webhook ingress with body-size limit, normalization,
  deduplication, conflict rejection, group/echo/system filtering.
- Identity resolution with first-message user creation; no cross-provider merging.
- Durable `AgentJob` inbox and `OutboxMessage` outbox with leases, attempt limits,
  per-user ordering and restart recovery.
- Agent runtime: bounded context (recent turns + summary + confirmed facts), validated
  tools, reply enqueued in the same transaction as the memory write.
- Relationship signals with `PENDING → CONFIRMED / REJECTED` review.
- Website: `/`, `/how-it-works`, `/safety`, `/privacy`, `/terms`, `/meet`, plus the
  dev-only `/dev/chat`.

Mock only (labelled as such in the product):

- `MockMessagingAdapter` — in-memory transcript, no real iMessage/SMS.
- `MockAIProvider` — deterministic pattern matching, not a language model.
- `MockVideoProvider`, `MockVerificationProvider` — no RTC, no identity verification.

Interface declared, not connected:

- `PhotonMessagingAdapter` — Photon product, API version and signature scheme are
  unverified, so every method throws.
- `OpenAIProvider` — throws; the runtime also refuses to send user content to an
  external model without `THIRD_PARTY_PROCESSING` consent.

Not started: preference learning engine (models exist, no aggregation), matching
engine, recommendations, interest, connections, scheduling, video rooms and grants,
private feedback, contact exchange, `/account`, `/admin`, seeded demo users.
