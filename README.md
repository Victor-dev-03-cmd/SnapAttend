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

## Student safety location (experimental feature branch)

The student portal is at `/student.html`. It uses the existing Mango runtime and the
browser Geolocation API. It **never** collects GPS on page load or in the background.

- **Safe Check-In**: students must tick the consent checkbox and press `I Reached`.
- **Parent request**: an authorized administrator creates a 15-minute request;
  the student can accept or ignore it. Push and parent WhatsApp triggers are not live.
- **SOS**: a student deliberately chooses to share one current snapshot. An SOS event
  can appear in the institution admin's `/api/admin/safety-events` list on the persistent
  Bun server, but **no SMS, WhatsApp, emergency dispatch or push is currently sent**.

### Administrator steps on the persistent Bun server

1. Import students with a parent phone and a valid, documented `parent_opt_in=1`.
2. Issue a seven-day student access token via the Admin interface or
   `POST /api/admin/students/:id/safety-access`. Share it privately; never put
   it in a URL, log, localStorage or public message.
3. Student types the token in their own safety portal, explicitly accepts
   sharing for each event, then taps the chosen action.
4. Staff can read tenant-scoped safety events for a maximum of 24 hours.

**Data safety:** Student device GPS coordinates are only stored in SQLite on the
persistent Bun host when explicitly shared. Active records are purged after 24 hours
(by request and daily scheduler); backup-retention policy must be configured before
real deployment. GPS accuracy varies, can be spoofed, and is not proof of school
arrival or immediate emergency response. Students can refuse location sharing.
Teacher/class attendance must not be inferred from voluntary student check-in.
Production still requires verified parent consent, student identity verification,
encrypted backups, audit logging, incident response, delivery acknowledgements,
and real WhatsApp template approval with authenticated reply correlation.

Vercel remains a **UI demo**; `/api/student/*` requests are disabled there. In demo
mode, a device may preview its own location and Google Maps link after permission,
but it is not sent to the server or guardian. Never test emergency response on
the Vercel demo.

## Multi-academy onboarding and role-specific PIN login

**Sign In:** Search/select a registered academy (only academies opted into public listing appear).
Choose **Admin**, **Teacher**, or **Student / Parent**, then enter a four-digit PIN.
Teacher login additionally needs the **class code**; Student/Parent login needs the
**class code and student's roll number**. These identify the correct account even when
two users have the same four digits.

**Register Academy:** New academy, school, college, campus, or tuition-centre
owners can enter a unique code, name, institution type and initial **Admin PIN**.
A new academy starts a 15-day trial. Registration is disabled on the Vercel UI-only
demo and disabled on real deployments with `APP_ENV=production` unless an operator
explicitly enables it. Before opening production registration, add organization
ownership verification, abuse controls and a secure PIN recovery process.

**Admin setup:** Create a class with its own teacher PIN; import students with
roll numbers and guardian contact; use Admin → Student safety access to set
separate student and guardian PINs for each selected child. Guardian PINs
can only be issued when documented guardian contact/consent is present.
PINs are Argon2id-hashed in SQLite; never store their plaintext in source.
No administrator can retrieve an existing PIN; it must be reset.

**Identity isolation:** A student and parent only see the associated student's
attendance. They cannot fetch class rosters or other students. Staff API
access is checked server-side, not inferred from the UI role buttons.

**Important:** Four-digit PINs have only 10,000 possible values, so the included
basic request throttling is MVP-only. Before storing real child data, add
persistent rate limiting / stronger credentials, verified guardian accounts,
audit trails, account recovery and enforced enrollment controls. Do not promise
end-to-end encryption: only HTTPS in transit and password hashing are currently
implemented. Vercel stays a UI preview without durable SQLite storage or login.

**Developer test account, fresh local database only:**
- Academy: `demo-school`
- Teacher: class `grade-8a`, PIN `2468`
- Admin: PIN `1357` (development seed only)

Existing local databases seeded with the old admin password are not silently
migrated to a weaker PIN. Back them up and use a controlled administrator
credential migration procedure or a clean disposable demo database.
