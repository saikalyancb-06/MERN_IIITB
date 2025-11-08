# Collaboration UI

This Vite/React client powers the phase-1 Idea Planner experience—creating private rooms with
5-letter keys, routing collaborators into `/rooms/:code`, and mirroring MongoDB change streams
so hosts can manage participants in real time.

## Env

Duplicate the sample file and point the client at the API origin:

```bash
cp .env.example .env
# optionally set VITE_API_URL=https://your-api:4000
```

## Scripts

- `npm run dev` – local dev server with HMR
- `npm run build` – production bundle (tsc + vite build)
- `npm run preview` – preview the production build

The UI expects the backend from `../server` to be running (default
`http://localhost:4000`).

## Features

- Lobby form to create or join rooms, persisting identity in `localStorage`.
- Automatic redirect to `/rooms/:code` after successful entry.
- EventSource connection to `/api/rooms/:code/stream` pushes Mongo change streams into the UI.
- Host controls to copy keys, remove participants, and end the room—the UI auto-updates for
  guests when these actions happen.
