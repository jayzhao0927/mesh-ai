const points = [
  ["Private by default", "Your conversation with your Agent is never shown to another user. There are no public profiles and no user search."],
  ["Private feedback stays private", "What you say after a video call is never revealed to the other person, in any form."],
  ["Both sides must agree", "Mutual interest is required before a call. Explicit consent from both people is required before any contact details are exchanged."],
  ["Hard boundaries are absolute", "Deal breakers, boundaries, blocks and paused states are enforced before anything is recommended. No learned preference can override them."],
  ["Block and report", "You can block or report anyone, at any point, through your Agent."],
  ["Pause anytime", "Tell your Agent to pause and it stops looking for people until you say otherwise."],
];

export default function SafetyPage() {
  return (
    <div className="max-w-2xl space-y-10">
      <h1 className="editorial text-4xl">Safety</h1>
      <dl className="space-y-6">
        {points.map(([title, body]) => (
          <div key={title} className="space-y-1">
            <dt className="editorial text-lg">{title}</dt>
            <dd className="text-sm leading-relaxed text-muted">{body}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
