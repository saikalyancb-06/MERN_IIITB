# Idea Planner prototype

This repo now holds the first phase of the Idea Planner: creating private rooms with shareable
5-letter keys so collaborators can join before the ideation timers start. A lightweight Express
API persists rooms and participants in MongoDB (so future real-time features can tap into change
streams), while the Vite/React client walks hosts and guests through creating or entering a room.

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
- Live roster card keeps the latest room snapshot (code, host, participant list) in the UI.
- All data flows through MongoDB so upcoming real-time phases can listen on change streams.
