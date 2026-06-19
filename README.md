# WC26 Match Centre

Single-page React/Vite dashboard for World Cup scores, derived group standings, knockout bracket, and live Kalshi winner markets. Express normalizes the public ESPN and Kalshi feeds; neither requires authentication.

## Local setup

1. Run `npm install`.
2. Run `npm run dev` and open `http://localhost:5173`.

The UI remains fully usable with empty placeholder states until tournament data is available. ESPN scores and Kalshi markets are fetched without authentication, cached for 25 seconds, and refreshed in the browser every 30 seconds. Group standings are calculated from completed ESPN group-stage events and matched to ESPN's official group metadata.

## Railway

Create a Railway service from this repository. No API variables are required. Railway uses `railway.json` to build with `npm run build`, start with `npm start`, and check `/api/health`.
