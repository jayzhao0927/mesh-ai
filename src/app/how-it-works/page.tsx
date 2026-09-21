const sections = [
  {
    title: "1. Message your Agent",
    body: "You start a normal conversation in Messages. No download, no public profile, no questionnaire.",
  },
  {
    title: "2. It builds an understanding, with you",
    body: "What you say, what you prefer, and what MESH infers are kept apart. Inferences stay hypotheses until you confirm them, and one sentence from you can overturn any of them.",
  },
  {
    title: "3. Verification, then the pool",
    body: "We get to know you before we ask you to verify yourself. Verification happens once there is something real to protect.",
  },
  {
    title: "4. One recommendation at a time",
    body: "No feed, no browsing, no compatibility percentage. You get a person and the reason they are worth knowing.",
  },
  {
    title: "5. A 20-minute video, not endless texting",
    body: "If both sides are interested, MESH finds a time that works for both and sends each of you a private link.",
  },
  {
    title: "6. Contact details only with both yeses",
    body: "After the call, each side answers privately. Nothing is shared with the other person. Contact details are exchanged only when both of you explicitly agree.",
  },
  {
    title: "7. Then the Agent leaves",
    body: "From that point it is just two people. MESH learns from what you choose to tell it, not by watching you.",
  },
];

export default function HowItWorksPage() {
  return (
    <div className="max-w-2xl space-y-12">
      <h1 className="editorial text-4xl">How it works</h1>
      <div className="space-y-8">
        {sections.map((s) => (
          <div key={s.title} className="space-y-2 border-b border-line pb-6 last:border-0">
            <h2 className="editorial text-xl">{s.title}</h2>
            <p className="text-sm leading-relaxed text-muted">{s.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
