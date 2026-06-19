import 'dotenv/config'
import compression from 'compression'
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const app = express()
const port = process.env.PORT || 3001
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const footballBase = 'https://api.football-data.org/v4'
const oddsBase = 'https://api.the-odds-api.com/v4'
const competition = process.env.FOOTBALL_COMPETITION_CODE || 'WC'
const oddsSport = process.env.ODDS_SPORT_KEY || 'soccer_fifa_world_cup_winner'
const cache = new Map()

app.use(compression())

async function cached(key, ttl, loader) {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.time < ttl) return hit.value
  const value = await loader()
  cache.set(key, { value, time: Date.now() })
  return value
}

async function fetchJson(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(12000) })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.message || body.error || `Upstream request failed (${response.status})`)
  return { body, headers: response.headers }
}

function normalizeMatch(match) {
  const score = match.score?.fullTime || {}
  return {
    id: match.id,
    date: match.utcDate,
    status: match.status,
    minute: match.minute,
    stage: match.stage,
    group: match.group,
    home: match.homeTeam,
    away: match.awayTeam,
    homeScore: score.home,
    awayScore: score.away,
    winner: match.score?.winner,
  }
}

function normalizeGroups(standings = []) {
  return standings
    .filter((standing) => standing.type === 'TOTAL' && standing.group)
    .map((standing) => ({
      name: standing.group.replace(/^GROUP_/, ''),
      teams: standing.table
        .map((row) => ({
          name: row.team.shortName || row.team.name,
          code: row.team.tla,
          crest: row.team.crest,
          played: row.playedGames,
          won: row.won,
          draw: row.draw,
          lost: row.lost,
          gd: row.goalDifference,
          points: row.points,
        }))
        .sort((a, b) => b.points - a.points || b.gd - a.gd),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function normalizeOdds(events = []) {
  const selections = new Map()
  for (const event of events) {
    for (const bookmaker of event.bookmakers || []) {
      for (const market of bookmaker.markets || []) {
        for (const outcome of market.outcomes || []) {
          if (!outcome.price || !outcome.name) continue
          const item = selections.get(outcome.name) || { team: outcome.name, prices: [] }
          item.prices.push(outcome.price)
          selections.set(outcome.name, item)
        }
      }
    }
  }
  return [...selections.values()]
    .map(({ team, prices }) => {
      const decimal = Math.max(...prices)
      return { team, decimal, probability: 100 / decimal }
    })
    .sort((a, b) => a.decimal - b.decimal)
}

async function footballData() {
  if (!process.env.FOOTBALL_DATA_API_KEY) throw new Error('Add FOOTBALL_DATA_API_KEY to enable live tournament data.')
  const headers = { 'X-Auth-Token': process.env.FOOTBALL_DATA_API_KEY }
  const [matches, standings] = await Promise.all([
    fetchJson(`${footballBase}/competitions/${competition}/matches`, { headers }),
    fetchJson(`${footballBase}/competitions/${competition}/standings`, { headers }),
  ])
  return {
    matches: (matches.body.matches || []).map(normalizeMatch),
    groups: normalizeGroups(standings.body.standings),
  }
}

async function oddsData() {
  if (!process.env.ODDS_API_KEY) throw new Error('Add ODDS_API_KEY to enable live tournament odds.')
  const params = new URLSearchParams({ apiKey: process.env.ODDS_API_KEY, regions: 'us', markets: 'outrights', oddsFormat: 'decimal' })
  const result = await fetchJson(`${oddsBase}/sports/${oddsSport}/odds?${params}`)
  return { odds: normalizeOdds(result.body), remaining: result.headers.get('x-requests-remaining') }
}

app.get('/api/health', (_req, res) => res.json({ ok: true }))

app.get('/api/dashboard', async (_req, res) => {
  const [football, odds] = await Promise.allSettled([
    cached('football', 55_000, footballData),
    cached('odds', 10 * 60_000, oddsData),
  ])
  res.json({
    updatedAt: new Date().toISOString(),
    football: football.status === 'fulfilled' ? football.value : { matches: [], groups: [], error: football.reason.message },
    odds: odds.status === 'fulfilled' ? odds.value : { odds: [], error: odds.reason.message },
  })
})

app.use(express.static(path.join(root, 'dist')))
app.get('*path', (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')))

app.listen(port, () => console.log(`WC26 server listening on ${port}`))
