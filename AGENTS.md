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
npm run db:seed               # 8 demo profiles (isDemo = true)
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
| `matching` | Mutual hard filters, deterministic scoring, one-at-a-time recommendations, mutual interest |
| `learning` | Learning events → evidence → hypotheses, user corrections, soft-ranking inputs |
| `video` | Availability and timezones, scheduling, access grants, private post-video feedback |
| `contact` | Versioned contact methods, per-connection exchange consent, the exchange itself |
| `verification` | Verification start / complete and connection-pool eligibility |
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
- Hard filters are mutual and run before scoring; no score or learned preference can
  override them.
- Compatibility scores stay internal — the user sees a reason, never a percentage.
- A connection exists only after both sides said yes; "later" and silence are neutral
  evidence, never a rejection.

## Implementation status

Phases 1–4 are implemented against the mock providers: foundation, messaging agent and
memory, the connection and learning engine, and the video hand-off. Phase 5
(operations) has not started.

Implemented and tested:

- Messaging gateway: webhook ingress with body-size limit, normalization,
  deduplication, conflict rejection, group/echo/system filtering.
- Identity resolution with first-message user creation; no cross-provider merging.
- Durable `AgentJob` inbox and `OutboxMessage` outbox with leases, attempt limits,
  per-user ordering and restart recovery.
- Agent runtime: bounded context (recent turns + summary + confirmed facts), validated
  tools, reply enqueued in the same transaction as the memory write.
- Relationship signals with `PENDING → CONFIRMED / REJECTED` review; confirming an
  identity fact updates the user record and confirming a boundary creates a hard filter.
- Mock verification gating pool eligibility (one-time token, only its hash is stored).
- Matching: mutual hard filters (age, city / long distance, language, intent, status,
  blocks), deterministic scoring, one open recommendation at a time.
- Interest capture through the Agent, mutual interest creating a `Connection`, and
  `PreferenceLearningEvent` rows recorded as evidence (not conclusions).
- Preference learning: events aggregate into `LearnedPreference` hypotheses through
  `PreferenceEvidence`, one connection counts as one sample whatever happens inside it,
  a hypothesis only reaches soft ranking after enough independent evidence, and
  `PreferenceCorrection` (confirm / reject / unsure) is idempotent, expires open
  recommendations that leaned on the hypothesis, and is never overridden by later
  behaviour.
- Availability with per-user timezones, overlap detection and a single 20-minute
  `VideoSession`; each side gets its own `VideoAccessGrant` (random token, only the
  hash stored, bound to one person, expiring, revoked when the call ends).
- Private post-video feedback: each answer stays with its author, discomfort raises a
  `SafetyReport`, and only the fact that both said yes ever crosses.
- Contact exchange: contact methods are versioned, consent names the connection, method
  and version, and the exchange runs only when both consents are live at that moment.
- Website: `/`, `/how-it-works`, `/safety`, `/privacy`, `/terms`, `/meet`,
  `/video/[token]`, plus the dev-only `/dev/chat`.

Mock only (labelled as such in the product):

- `MockMessagingAdapter` — in-memory transcript, no real iMessage/SMS.
- `MockAIProvider` — deterministic pattern matching, not a language model.
- `MockVideoProvider`, `MockVerificationProvider` — no RTC, no identity verification.

Interface declared, not connected:

- `PhotonMessagingAdapter` — Photon product, API version and signature scheme are
  unverified, so every method throws.
- `OpenAIProvider` — throws; the runtime also refuses to send user content to an
  external model without `THIRD_PARTY_PROCESSING` consent.

Demo pool: `prisma/seed.ts` creates 8 `isDemo` profiles. A demo profile is never the
subject of a recommendation, its side of mutual interest is simulated deterministically
from the same score, and introductions of demo profiles are labelled in the message.
`MATCH_WITH_DEMO_USERS=false` keeps real users away from them entirely.

Not started: `/account`, `/admin`, safety block/report APIs, consent management UI,
audit and analytics (Phase 5), `/verification/[token]` as a web page.
