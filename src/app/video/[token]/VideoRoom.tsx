"use client";

import { useEffect, useState } from "react";

interface RoomProps {
  token: string;
  room: {
    scheduledAt: string;
    durationMins: number;
    counterpartName: string;
  };
}

/**
 * Deliberately bare: the other person, camera, microphone, a timer and a way
 * out. No browsing, no reactions, no live scoring.
 */
export function VideoRoom({ token, room }: RoomProps) {
  const [secondsLeft, setSecondsLeft] = useState(room.durationMins * 60);
  const [camera, setCamera] = useState(true);
  const [microphone, setMicrophone] = useState(true);
  const [left, setLeft] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (left) return;
    const timer = setInterval(() => setSecondsLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(timer);
  }, [left]);

  async function leave() {
    setLeaving(true);
    await fetch("/api/video/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    setLeft(true);
    setLeaving(false);
  }

  if (left) {
    return (
      <div className="max-w-xl space-y-4">
        <h1 className="editorial text-3xl">Call ended</h1>
        <p className="text-muted">
          Your Agent will ask you how it went, privately. {room.counterpartName} never
          sees your answer.
        </p>
      </div>
    );
  }

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = String(secondsLeft % 60).padStart(2, "0");

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="editorial text-2xl">{room.counterpartName}</h1>
        <span className="rounded-full border border-line px-3 py-1 text-sm text-muted">
          {minutes}:{seconds}
        </span>
      </div>

      <div className="flex aspect-video items-center justify-center rounded-2xl border border-line bg-background">
        <div className="text-center">
          <p className="editorial text-xl">Mock video room</p>
          <p className="mt-2 text-sm text-muted">
            There is no real audio or video in this build. Nothing is transmitted or
            recorded.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => setCamera((v) => !v)}
          className="rounded-full border border-line px-5 py-2 text-sm"
        >
          Camera {camera ? "on" : "off"}
        </button>
        <button
          onClick={() => setMicrophone((v) => !v)}
          className="rounded-full border border-line px-5 py-2 text-sm"
        >
          Microphone {microphone ? "on" : "off"}
        </button>
        <button
          onClick={leave}
          disabled={leaving}
          className="rounded-full bg-accent px-5 py-2 text-sm text-white disabled:opacity-50"
        >
          {leaving ? "Leaving…" : "Leave"}
        </button>
      </div>
    </div>
  );
}
