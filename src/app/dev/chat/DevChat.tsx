"use client";

import { useCallback, useEffect, useState } from "react";

interface TranscriptMessage {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  text: string | null;
  at: string;
}

interface PendingSignal {
  id: string;
  category: string;
  key: string;
  value: string;
  confidence: number;
  source: string;
}

interface AccountStatus {
  state: string;
  verified: boolean;
  poolEligible: boolean;
  city: string | null;
  ageYears: number | null;
  intent: string | null;
}

interface ConnectionRow {
  id: string;
  status: string;
  withName: string;
}

interface Transcript {
  userId: string | null;
  messages: TranscriptMessage[];
  pending: PendingSignal[];
  status?: AccountStatus | null;
  connections?: ConnectionRow[];
}

const EMPTY: Transcript = { userId: null, messages: [], pending: [], status: null, connections: [] };

export default function DevChat() {
  const [externalId, setExternalId] = useState("dev-user-1");
  const [text, setText] = useState("");
  const [state, setState] = useState<Transcript>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    const res = await fetch(`/api/dev/chat?externalId=${encodeURIComponent(id)}`);
    if (res.ok) setState(await res.json());
  }, []);

  useEffect(() => {
    void load(externalId);
  }, [externalId, load]);

  async function send(messageText: string, messageId: string) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/dev/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ externalId, text: messageText, externalMessageId: messageId }),
    });
    const body = await res.json();
    if (!res.ok) setError(body.error ?? "Request failed");
    else setState(body);
    setBusy(false);
  }

  async function verify() {
    if (!state.userId) return;
    setBusy(true);
    const res = await fetch("/api/dev/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: state.userId }),
    });
    if (!res.ok) setError((await res.json()).error ?? "Verification failed");
    await load(externalId);
    setBusy(false);
  }

  async function review(signalId: string, action: "confirm" | "reject") {
    if (!state.userId) return;
    await fetch("/api/dev/signals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: state.userId, signalId, action }),
    });
    await load(externalId);
  }

  const lastId = state.messages.filter((m) => m.direction === "INBOUND").length + 1;

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="editorial text-3xl">/dev/chat</h1>
        <p className="text-sm text-muted">
          Development-only simulation of the messaging channel. It posts through the same
          gateway, worker and outbox as a real provider webhook. Not a product entry point.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="text-muted" htmlFor="externalId">
          Sender external id
        </label>
        <input
          id="externalId"
          value={externalId}
          onChange={(e) => setExternalId(e.target.value)}
          className="rounded-lg border border-line bg-white px-3 py-2"
        />
        <button
          type="button"
          onClick={() => void send("Hi MESH", `${externalId}-m${lastId}`)}
          className="rounded-full border border-line px-4 py-2"
          disabled={busy}
        >
          Send &quot;Hi MESH&quot;
        </button>
        <button
          type="button"
          onClick={() =>
            void send("Hi MESH", `${externalId}-m${Math.max(lastId - 1, 1)}`)
          }
          className="rounded-full border border-line px-4 py-2"
          disabled={busy}
          title="Replays the previous external message id to show duplicate suppression"
        >
          Replay last webhook
        </button>
        <button
          type="button"
          onClick={() => void verify()}
          className="rounded-full border border-line px-4 py-2"
          disabled={busy || !state.userId || state.status?.poolEligible}
          title="Mock verification only — this is not identity verification"
        >
          {state.status?.poolEligible ? "Verified (mock)" : "Complete mock verification"}
        </button>
      </div>

      {state.status && (
        <div className="flex flex-wrap gap-4 rounded-xl border border-line bg-white px-4 py-3 text-xs text-muted">
          <span>status: {state.status.state}</span>
          <span>pool eligible: {state.status.poolEligible ? "yes" : "no"}</span>
          <span>intent: {state.status.intent ?? "—"}</span>
          <span>city: {state.status.city ?? "—"}</span>
          <span>age: {state.status.ageYears ?? "—"}</span>
          <span>
            connections:{" "}
            {state.connections?.length
              ? state.connections.map((c) => `${c.withName} (${c.status})`).join(", ")
              : "—"}
          </span>
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <div className="min-h-64 space-y-3 rounded-2xl border border-line bg-white p-5">
            {state.messages.length === 0 && (
              <p className="text-sm text-muted">No messages yet.</p>
            )}
            {state.messages.map((m) => (
              <div
                key={m.id}
                className={m.direction === "INBOUND" ? "text-right" : "text-left"}
              >
                <span
                  className={`inline-block max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                    m.direction === "INBOUND"
                      ? "bg-accent text-white"
                      : "bg-background text-foreground"
                  }`}
                >
                  {m.text}
                </span>
              </div>
            ))}
          </div>

          <form
            className="flex gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!text.trim()) return;
              void send(text.trim(), `${externalId}-m${lastId}`);
              setText("");
            }}
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type a message to your Agent"
              className="flex-1 rounded-full border border-line bg-white px-4 py-3 text-sm"
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded-full bg-accent px-5 py-3 text-sm text-white disabled:opacity-50"
            >
              Send
            </button>
          </form>
          {error && <p className="text-sm text-red-700">{error}</p>}
        </div>

        <aside className="space-y-3">
          <h2 className="editorial text-lg">Awaiting your confirmation</h2>
          <p className="text-xs text-muted">
            Nothing here is used for matching until you confirm it.
          </p>
          {state.pending.length === 0 && (
            <p className="text-sm text-muted">No pending signals.</p>
          )}
          {state.pending.map((s) => (
            <div key={s.id} className="space-y-2 rounded-xl border border-line bg-white p-4">
              <p className="text-sm">
                <span className="text-muted">{s.category}.</span> {s.key} = {s.value}
              </p>
              <p className="text-xs text-muted">
                {s.source} · confidence {s.confidence.toFixed(2)}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void review(s.id, "confirm")}
                  className="rounded-full bg-accent px-3 py-1 text-xs text-white"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => void review(s.id, "reject")}
                  className="rounded-full border border-line px-3 py-1 text-xs"
                >
                  That&apos;s wrong
                </button>
              </div>
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}
