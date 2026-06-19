# WC26 Match Centre

Single-page React/Vite dashboard for World Cup scores, groups, knockout bracket, and winner odds. Express proxies both data providers so API keys never reach the browser.

## Local setup

1. Run `npm install`.
2. Add keys to `.env` using `.env.example` as the variable list.
3. Run `npm run dev` and open `http://localhost:5173`.

The UI remains fully usable with empty placeholder states until keys and tournament data are available. Live football data is cached for 55 seconds; odds are cached for 10 minutes to preserve free-tier credits.

## Railway

Create a Railway service from this repository and add `FOOTBALL_DATA_API_KEY` and `ODDS_API_KEY` under Variables. Railway uses `railway.json` to build with `npm run build`, start with `npm start`, and check `/api/health`.

Optional overrides are `FOOTBALL_COMPETITION_CODE` (default `WC`) and `ODDS_SPORT_KEY` (default `soccer_fifa_world_cup_winner`). The Odds API only exposes in-season sport keys, so update the latter from its `/v4/sports` response if its World Cup key differs when the market opens.
