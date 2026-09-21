# MESH

**Find people worth knowing.**

AI understands you. AI finds people worth knowing. AI creates the first connection.
Then AI gets out of the way.

MESH is a messaging-first connection platform: the website explains the product and
hands you to Messages, where your Agent gets to know you over time, proposes one
person at a time, and — when both sides want it — sets up a single 20-minute video
call before stepping out of the way.

See [AGENTS.md](./AGENTS.md) for the stack, how to run it, module boundaries and the
current implementation status (what is real, what is mock, what is only an interface).

## Quick start

```bash
cp .env.example .env
npm install
npm run db:migrate
npm run dev      # http://localhost:3000
npm run worker   # second shell
```

Then open `/dev/chat` to simulate the messaging channel end to end.
