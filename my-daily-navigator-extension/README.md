# My Daily Navigator Extension Beta Scaffold

This Manifest V3 extension connects read-only Google Calendar events to the local ASTRODAMOS timing engine.

## Privacy and permissions

- Calendar access is read-only.
- Meeting titles are classified locally with keyword rules.
- Descriptions and attendee lists are not read by the bridge.
- Gemini fallback is not enabled in this beta scaffold. It requires a separate explicit opt-in flow.
- The extension never reschedules an event automatically.

## Required setup before tester installation

1. Create a Google OAuth client for the final unpacked extension ID.
2. Replace `REPLACE_WITH_GOOGLE_OAUTH_CLIENT_ID` in `manifest.json`.
3. Add each focus-group participant as an OAuth test user.
4. Load the folder from `chrome://extensions` with Developer mode and **Load unpacked**.

## Personal runtime handoff contract

Authorized extension code can store verified personal data through the `MCM_SAVE_CONTEXT` runtime message:

```js
{
  type: "MCM_SAVE_CONTEXT",
  context: { processes: [] },
  profile: { birthDate: "1990-01-01" },
  moonTimeline: [],
  scoringWeights: { astrology: 1, biorhythm: 0, moon: 0 }
}
```

The default weights deliberately use ASTRODAMOS only. Biorhythm and Moon scores become part of the composite only after product-approved weights are supplied. Moon data must be marked `verified: true` or `sourceVerified: true`; otherwise it is excluded rather than guessed.

The secure handoff from the encrypted My Cosmic Mentor report into this message is intentionally not wired in the scaffold yet. It must be added and tested before the package is distributed to focus-group users.

## Calendar to ASTRODAMOS bridge

The primary bridge is:

```js
CalendarAstrodamosBridge.evaluateCalendarEvent({
  event,             // Google Calendar event resource
  context,           // verified ASTRODAMOS processes
  profile,           // birthDate only for the biorhythm module
  moonTimeline,      // verified hourly ephemeris rows
  scoringWeights,    // product-approved component weights
  timeZone
})
```

It returns the normalized event, local meeting classification, 0–100 score, traffic-light band, component scores, and concise calculation factors. `rankCalendarAlternatives()` evaluates only free slots supplied by the Calendar Free/Busy response.

## Canonical engine

`engine/astrodamos.js` is a packaged copy of the repository's canonical `astrodamos-engine.js`. The acceptance test fails if the packaged copy drifts from the canonical source.
