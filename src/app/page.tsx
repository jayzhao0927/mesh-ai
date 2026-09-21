import Link from "next/link";

const steps = [
  {
    title: "Message your Agent",
    body: "No app, no profile, no swiping. One message starts everything.",
  },
  {
    title: "Let it get to know you",
    body: "A normal conversation. You confirm what it understood; you can correct it any time.",
  },
  {
    title: "Meet someone worth knowing",
    body: "When both sides are interested, it sets up one 20-minute video. Then it steps back.",
  },
];

export default function Home() {
  return (
    <div className="space-y-24">
      <section className="max-w-2xl space-y-6">
        <h1 className="editorial text-5xl leading-tight sm:text-6xl">
          Find people worth knowing.
        </h1>
        <p className="text-lg text-muted">
          AI gets to know you, finds someone worth meeting, and helps create the first
          connection.
        </p>
        <Link
          href="/meet"
          className="inline-block rounded-full bg-accent px-6 py-3 text-white hover:opacity-90"
        >
          Meet Your Agent
        </Link>
      </section>

      <section className="grid gap-10 sm:grid-cols-3">
        {steps.map((step, i) => (
          <div key={step.title} className="space-y-3">
            <span className="editorial text-sm text-muted">0{i + 1}</span>
            <h2 className="editorial text-xl">{step.title}</h2>
            <p className="text-sm leading-relaxed text-muted">{step.body}</p>
          </div>
        ))}
      </section>

      <section className="max-w-2xl space-y-4 border-t border-line pt-12">
        <p className="editorial text-2xl leading-relaxed">
          AI understands you. AI finds people worth knowing. AI creates the first
          connection. Then AI gets out of the way.
        </p>
        <p className="text-sm text-muted">
          The goal is not more time spent with an AI. It is fewer wasted introductions.
        </p>
      </section>
    </div>
  );
}
