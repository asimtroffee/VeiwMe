# Interview Booking Board — Plan (v2: Sessions)

Core shift from v1: instead of one shared link showing every day to everyone, the admin creates **Sessions**. Each session is its own self-contained slot board with its **own unique link**. The admin sends the right link to the right group, and that group only ever sees and books within that one session.

---

## What a "Session" is

A session is one bookable schedule block:
- A **name/label** (e.g., "Marketing Cohort — Interview Day", "Round 2 Panel B")
- A **date**
- A **start time and end time** chosen by the admin (e.g., 9:00 AM–6:00 PM, or a short 9:30 AM–12:30 PM window)
- Auto-generated **15-minute slots** across that range
- A **unique link** (e.g., `.../session/8f2a1c`) that only shows this session's slots

Each session is independent — separate slots, separate bookings, separate link. Nothing booked in one session is visible in another.

---

## Admin Vision

**Purpose:** Create sessions, get a shareable link for each, and manage bookings within them.

### Admin overview
- The admin has their own view — a list of every session created so far, each showing its name, date, hours, and a live "X/Y booked" count.
- Reaching this view requires a **shared admin password**, entered once per browser/session — not the individual session links, not something participants ever see or need. Getting a session's link does **not** grant any access to the overview.

### Creating a session
1. From the admin overview, click **"+ New session."**
2. Enter a **name/label** for the session.
3. Choose the **date**.
4. Choose the session's **start time and end time**.
5. Confirm — the system generates the 15-minute slots and a **unique link** for this session.
6. Copy that link and send it to the specific group meant to use it (e.g., paste into an email or a group chat for that cohort).

### Managing an existing session
- Open a session (from the overview, or via its own link) to see its live slot board — same "Open" vs "Booked with name" view as before.
- **Cancel any booking** within that session, with a confirmation step.
- **Copy the session's link again** at any time to resend it.
- **Delete a session** entirely — warns first if it has existing bookings, since deleting removes them.
- Everything about a session stays scoped to itself — canceling or editing one session never touches another.

### Open decisions for this side
- **How is the password managed?** One fixed shared password everyone on the admin side uses — decided. Not per-person, not changeable through the UI for now.
- **How long does entering it last?** ✅ Decided — once entered correctly on a device/browser, it's remembered there; no need to re-enter it on later visits from that same browser.
- **Lockout on repeated failures:** ✅ Decided — after **5 wrong attempts**, the prompt locks out further tries for **15 minutes** before allowing another attempt (a reasonable default — easy to shorten/lengthen later if it's too strict or too loose).
- **Can a session be edited after creation** (name, date, hours) once it already has bookings, or is it locked in once the link has gone out?
- **Long sessions** — a 9 AM–6 PM session is ~36 slots. Group into Morning/Afternoon sections, or keep one scrollable list?
- **Reusing a session** — if the same cohort needs a second interview day, is that a brand-new session (new link), or should one session support multiple dates? (Current plan: one date per session, keeps each link simple and unambiguous.)

---

## Participant Vision

**Purpose:** Use the exact link they were given to book a slot in *their* session — no searching, no picking from a list of unrelated groups.

### Booking flow
1. Open the **unique session link** sent to them (e.g., by email, group chat).
2. **Info gate (required):** before anything else loads, they're asked for their **name** and **email or phone number**. The slot board itself isn't visible or usable until this is submitted — no browsing the schedule anonymously.
3. Once submitted, they land on that session's slot board — **open** slots styled apart from **booked** ones, which show the booked person's name.
4. Click **"Book this slot"** on an open one — since their info was already collected at the gate, this is a direct one-click booking (or a lightweight "Book this slot for [name]?" confirmation), not a second form to fill out.
5. It locks in immediately and shows as booked for everyone else with that same link within a few seconds.

### Edge cases
- **Near-simultaneous booking:** if someone else took the slot moments earlier, they're told it was just taken and asked to pick another.
- **Changed plans:** they can cancel their own booking the same way anyone with the link can — click Cancel, confirm, slot reopens.

### What's different from v1
- Participants never see a list of days/sessions to choose from — the link *is* the selection. This avoids someone from Cohort A accidentally browsing into Cohort B's slots.
- If a participant is only supposed to book one session, there's nothing in the UI pointing them toward any other session.
- **The board is no longer browsable anonymously** — identifying info is collected upfront at the gate, before the schedule itself is shown, not at the moment of booking.

### Open decisions for this side
- **Remembering info on return visits:** if the same participant closes the tab and reopens their session link later, should the gate remember their name/contact (so they're not retyping it), or ask again every time?
- **Validation at the gate:** should the email/phone field be format-checked (e.g., valid email pattern) before letting them through, or accept anything typed?
- **Editing after the gate:** if someone mistypes their name/contact and only notices after booking, is there a way to fix it, or do they need to cancel and rebook?
- **Time zone assumption:** slot labels still assume one implicit time zone per session — fine if each cohort is local, but worth confirming.
- **Data visibility:** within a session, names/emails/phones are visible to anyone else who has that session's link (not across sessions).

---

## Shared rules (apply to both sides)

- **One link per session** — no session is reachable except through its own link (or the admin overview).

- **Conflict handling** — the system re-checks a slot's status immediately before saving, so only the first of two near-simultaneous bookings succeeds.
- **Confirmation before deletion** — canceling a booking or deleting a session both require an explicit confirm step.