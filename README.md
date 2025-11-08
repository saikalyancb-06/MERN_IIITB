# Idea Planner prototype

This repo now holds the first phase of the Idea Planner: creating private rooms with shareable
5-letter keys so collaborators can join before the ideation timers start. A lightweight Express
API persists rooms and participants in MongoDB (with change streams powering real-time updates),
while the Vite/React client now routes participants straight into a Meet-style `/rooms/:code`
experience once they create or join a room.

## Getting started

### 1. Backend (Express + Mongo)

```bash
cp .env.example .env            # adjust MONGO_URI / PORT if needed
cd server
npm install                    # already run once in repo, safe to re-run
npm run dev                    # boots http://localhost:4000
```

Environment flags:

- `MONGO_URI` – point at the instance that powers real-time flows (change streams etc.)
- `MONGO_DB` – database name; defaults to `idea_planner`
- `PORT` – API port; defaults to `4000`

### 2. Frontend (Vite + React)

```bash
cd collaboration
cp .env.example .env           # only needed if API isn’t at http://localhost:4000
npm install                    # if not already done
npm run dev                    # boots http://localhost:5173 by default
```

The `VITE_API_URL` variable should match the backend origin (defaults to
`http://localhost:4000`).

## Current capabilities

- Create a room with host name + optional label; API returns a unique 5-letter code stored in Mongo.
- Join an existing room by entering the code + participant name; backend de-duplicates attendees.
- Participants are issued UUIDs so Mongo documents stay stable for change streams & admin controls.
- After create/join, users are redirected to `/rooms/:code`, where:
  - A MongoDB change-stream powered SSE feed keeps the roster, presence, and host actions live.
  - Hosts can copy the room key, remove attendees, or end the room; guests auto-redirect out if
    they are removed or when the host ends the session.
- All traffic flows through MongoDB, so the realtime behavior is backed entirely by the data layer.
