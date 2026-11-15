# SnapAttend & Safe-Reach

Ultra-lightweight classroom attendance, child safety and parent messaging SaaS.

## Stack (strict)
- **Bun.js** — application runtime and task runner
- **Hono.js** — HTTP API framework
- **Mango Framework** — frontend DOM runtime (not React or Angular)
- **SQLite** via `bun:sqlite` — persistent database

No Node.js runtime, Express.js, AngularJS, ORM, Redis, MongoDB, React or Next.js.

## Status
MVP in development. The live WhatsApp integration is **not enabled** until institution onboarding, guardian opt-in, Meta template approval, signing verification and end-to-end testing are completed. Emergency flags require staff follow-up and must not be treated as a guaranteed alert or emergency dispatch service.

## Run
```sh
bun install
cp .env.example .env
bun run seed
bun run dev
```
Open http://localhost:3000.

## Privacy
Keep real student names, guardian numbers, passwords, and attendance exports out of version control. Demo records are fictional. Deploy with HTTPS, backups and school data protection controls before use.
