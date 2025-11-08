# Collaboration UI

This Vite/React client powers the phase-1 Idea Planner experience—creating private rooms with
5-letter keys and letting participants join instantly.

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
