export default function PrivacyPage() {
  return (
    <div className="max-w-2xl space-y-8">
      <h1 className="editorial text-4xl">Privacy</h1>
      <p className="text-sm leading-relaxed text-muted">
        This page describes how MESH is built to handle your data. It is a product
        description, not a completed legal privacy policy.
      </p>

      <section className="space-y-3">
        <h2 className="editorial text-xl">Separate layers</h2>
        <p className="text-sm leading-relaxed text-muted">
          Raw conversation, private memory, structured relationship intelligence, the
          connection graph and any training dataset are kept separate. They are not one
          pool of data.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="editorial text-xl">Separate consents</h2>
        <p className="text-sm leading-relaxed text-muted">
          Service usage, matching, AI improvement and third-party processing are recorded
          as four independent consents. One checkbox does not authorise all of them, and
          your content is not sent to an external model without the matching consent.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="editorial text-xl">Correction and deletion</h2>
        <p className="text-sm leading-relaxed text-muted">
          When you correct or withdraw something, the change propagates to derived
          memory, caches and learned assumptions. A rejected assumption does not quietly
          come back.
        </p>
      </section>
    </div>
  );
}
