# Quiz Arena

Teddy Brother Studio, Creative Consultancy portfolio. A Kahoot-style live quiz with a 3D podium. Join from other tabs of the same browser, or through the Node relay (Network mode). Optional AI question generation.

- `web/` Angular + Three.js app (works with no sign-in and no API keys)
- `api/` Node.js API, zero dependencies (optional extras, see below)

## Run locally

```bash
cd web && npm install && npm start      # http://localhost:4205
cd api && npm start                      # http://localhost:3105  (optional)
```

Build: `cd web && npm run build`.

## AI integration (mock first, real when you add a key)
`api/ai.js` is a provider adapter. `AI_PROVIDER=mock` (default) returns simulated output and calls no model; the UI labels it "Mock AI · simulated". `AI_PROVIDER=anthropic` makes a real call using `AI_API_KEY` and `AI_MODEL` (written but untested without a key). Copy `api/.env.example` to `api/.env` to configure. Failures are shown, never silently replaced with fake AI output.

## Navigation
The shared top bar in `web/src/app/nav.ts` links all portfolio projects at localhost:4201 to 4205. Edit the `SITES` URLs when deployed.
