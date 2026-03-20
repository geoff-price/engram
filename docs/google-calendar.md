# Engram × Google Calendar — Feature Spec (Revised)

## Goal

When a thought contains an explicit trigger phrase ("add to my calendar"), extract calendar events from the content and create them in Google Calendar. Supports multiple events per message (e.g., pasting a schedule). Events are color-coded by family member.

---

## Trigger Mechanism

**Explicit trigger phrase** — no auto-detection. The user must include a phrase like:

- "add to my calendar"
- "add this to my calendar"
- "put this on my calendar"
- "please add to my calendar"

Detection is case-insensitive string matching, not LLM-based. If the trigger is present AND Google Calendar credentials are configured, the calendar pipeline activates. Otherwise, normal thought capture proceeds unchanged.

The trigger phrase is stripped from the stored thought content.

---

## Event Extraction

When triggered, a separate LLM call (parallel with embedding + metadata extraction) extracts structured event data.

**Extraction schema (per event):**
- `title` — short, human-readable
- `start_datetime` — ISO 8601, resolved against current date (handles "tomorrow", "next Monday")
- `end_datetime` — ISO 8601, default 1 hour after start if not stated
- `location` — extract if present, omit otherwise
- `person` — the family member the event is for (for color coding)

**Context passed to LLM:**
- Current date in configured timezone
- Timezone identifier

**Multi-event:** A single message may contain multiple events. Each is extracted separately and created as its own Google Calendar event.

**Confidence rule:** Only extract events where `start_datetime` can be resolved with high confidence. Skip ambiguous dates silently.

---

## Family Color Mapping

Events are color-coded in Google Calendar based on which family member they're for.

**Configuration** (via environment variables):
- `CALENDAR_FAMILY_COLORS` — comma-separated `name:colorId` pairs
- `CALENDAR_DEFAULT_MEMBER` — name used when no person is mentioned

**Google Calendar color IDs:**
| ID | Color |
|----|-------|
| 1 | Lavender |
| 2 | Sage |
| 3 | Grape |
| 4 | Flamingo |
| 5 | Banana |
| 6 | Tangerine |
| 7 | Peacock |
| 8 | Graphite |
| 9 | Blueberry |
| 10 | Basil |
| 11 | Tomato |

**Resolution logic:**
1. If no person mentioned → use default member's color
2. If one family member mentioned → use their color
3. If multiple family members mentioned → use "family" color
4. If unknown person → use default member's color

---

## Google Calendar Integration

**Auth:** OAuth 2.0 with pre-authorized refresh token stored as env var. One-time consent flow via `npm run google-auth`. No per-request user auth.

**On extraction:**
1. Refresh access token (cached in memory, refreshed when expired)
2. For each extracted event: `POST /calendars/primary/events` with color ID
3. Collect results (event_id + status per event)
4. Store results in thought metadata

**On failure:** Per-event — failed events get `status: "failed"`, successful ones still get created. No retry.

**Idempotency:** Calendar events are created once per thought. The `calendar_action` field prevents re-processing.

---

## Metadata Changes

The thought type enum is **unchanged**. Calendar events are not a type — a thought retains its natural classification (task, meeting_note, etc.) and gains calendar metadata as a side effect.

**New metadata fields (additive to JSONB):**
```
is_calendar_event: boolean
calendar_action: "none" | "created" | "partial" | "failed"
calendar_events: Array<{
  title, start, end, location?, person?,
  color_id?, event_id?, status
}>
```

---

## Telegram Response

After calendar creation, the capture receipt includes event details:

```
✓ Captured as task
Topics: sports, family

✅ Added to Google Calendar:
• Jonah's Soccer Game — Sat, Mar 21 @ 10:00 AM
  📍 City Park Field 3
• Sydnie's Dance Recital — Sat, Mar 21 @ 2:00 PM
  📍 Community Center

⚠️ 1 event failed to add to calendar
```

---

## Environment Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `GOOGLE_CLIENT_ID` | OAuth client ID | `123...apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret | `GOCSPX-...` |
| `GOOGLE_REFRESH_TOKEN` | Pre-authorized refresh token | `1//0...` |
| `CALENDAR_TIMEZONE` | Timezone for date resolution | `America/New_York` |
| `CALENDAR_FAMILY_COLORS` | Name-to-color mapping | `member1:6,member2:4,family:9` |
| `CALENDAR_DEFAULT_MEMBER` | Default when no person named | `member1` |

---

## Pipeline Flow

```
1. User sends message with "add to my calendar: ..."
2. Trigger phrase detected (string match) → stripped from content
3. Parallel:
   - generateEmbedding(cleanContent)
   - extractMetadata(cleanContent)
   - extractCalendarEvents(cleanContent, currentDate, timezone)
4. Create Google Calendar events (sequential per event)
5. Merge calendar results into metadata
6. Insert thought with complete metadata
7. Reply with capture receipt + calendar receipt
```

If Google Calendar credentials are not configured, step 3's calendar extraction is skipped and the pipeline behaves exactly as before.

---

## What Does NOT Change

- Existing thought type enum (no new `event` type)
- Database schema (metadata fields are additive JSONB)
- Semantic search behavior
- Non-triggered message handling
- OB1 recipe (calendar is Engram-only)

## Out of Scope (Future)

- Editing or deleting existing calendar events
- Two-way sync (calendar → Engram)
- Confirmation/approval flow
- Non-primary calendar targeting
- Per-calendar targeting by family member
