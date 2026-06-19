import compression from 'compression'
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const app = express()
const port = process.env.PORT || 3001
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const espnScoreboardUrl = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard'
const espnStandingsUrl = 'https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings'
const kalshiMarketsUrl = 'https://external-api.kalshi.com/trade-api/v2/markets'
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

const espnStages = {
  'round-of-32': 'LAST_32',
  'round-of-16': 'LAST_16',
  quarterfinals: 'QUARTER_FINALS',
  semifinals: 'SEMI_FINALS',
  final: 'FINAL',
}

function normalizeTeam(competitor) {
  const team = competitor?.team || {}
  return {
    id: team.id,
    name: team.displayName,
    shortName: team.shortDisplayName,
    tla: team.abbreviation,
    crest: team.logo,
  }
}

function normalizeEspnMatch(event, groupByTeam) {
  const competition = event.competitions?.[0] || {}
  const home = competition.competitors?.find((team) => team.homeAway === 'home')
  const away = competition.competitors?.find((team) => team.homeAway === 'away')
  const state = event.status?.type?.state
  return {
    id: event.id,
    date: event.date,
    status: state === 'in' ? 'IN_PLAY' : state === 'post' ? 'FINISHED' : 'SCHEDULED',
    minute: state === 'in' ? event.status?.displayClock : null,
    stage: espnStages[event.season?.slug] || (event.season?.slug === 'group-stage' ? 'GROUP_STAGE' : event.season?.slug?.toUpperCase()),
    group: groupByTeam.get(home?.team?.id) ? `GROUP_${groupByTeam.get(home.team.id)}` : null,
    home: normalizeTeam(home),
    away: normalizeTeam(away),
    homeScore: home?.score ?? null,
    awayScore: away?.score ?? null,
    winner: home?.winner ? 'HOME_TEAM' : away?.winner ? 'AWAY_TEAM' : 'DRAW',
  }
}

function deriveGroups(events, officialStandings) {
  const groupEvents = events.filter((event) => event.season?.slug === 'group-stage')
  const parent = new Map()
  const find = (id) => {
    if (!parent.has(id)) parent.set(id, id)
    if (parent.get(id) !== id) parent.set(id, find(parent.get(id)))
    return parent.get(id)
  }
  const union = (a, b) => parent.set(find(a), find(b))

  for (const event of groupEvents) {
    const competitors = event.competitions?.[0]?.competitors || []
    if (competitors.length === 2) union(competitors[0].team.id, competitors[1].team.id)
  }

  const components = new Map()
  groupEvents.forEach((event, eventIndex) => {
    for (const competitor of event.competitions?.[0]?.competitors || []) {
      const root = find(competitor.team.id)
      const component = components.get(root) || { first: eventIndex, teams: new Map(), events: [] }
      component.first = Math.min(component.first, eventIndex)
      component.teams.set(competitor.team.id, competitor)
      if (!component.events.includes(event)) component.events.push(event)
      components.set(root, component)
    }
  })

  const officialGroupByTeam = new Map()
  for (const group of officialStandings.children || []) {
    const name = group.name?.replace(/^Group\s+/i, '')
    for (const entry of group.standings?.entries || []) officialGroupByTeam.set(entry.team?.id, name)
  }

  const orderedComponents = [...components.values()].map((component) => ({
    ...component,
    name: officialGroupByTeam.get(component.teams.values().next().value?.team?.id),
  })).sort((a, b) => (a.name || '').localeCompare(b.name || '') || a.first - b.first)

  const groupByTeam = new Map()
  const groups = orderedComponents.map((component, index) => {
    const name = component.name || String.fromCharCode(65 + index)
    const table = [...component.teams.values()].map((competitor) => ({
      id: competitor.team.id,
      name: competitor.team.shortDisplayName || competitor.team.displayName,
      code: competitor.team.abbreviation,
      crest: competitor.team.logo,
      played: 0, won: 0, draw: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, gd: 0, points: 0,
    }))
    const rows = new Map(table.map((row) => [row.id, row]))
    component.events.filter((event) => event.status?.type?.completed).forEach((event) => {
      const competitors = event.competitions?.[0]?.competitors || []
      if (competitors.length !== 2) return
      const [first, second] = competitors
      const firstRow = rows.get(first.team.id)
      const secondRow = rows.get(second.team.id)
      const firstScore = Number(first.score)
      const secondScore = Number(second.score)
      firstRow.played += 1; secondRow.played += 1
      firstRow.goalsFor += firstScore; firstRow.goalsAgainst += secondScore
      secondRow.goalsFor += secondScore; secondRow.goalsAgainst += firstScore
      if (firstScore === secondScore) {
        firstRow.draw += 1; secondRow.draw += 1; firstRow.points += 1; secondRow.points += 1
      } else {
        const winner = firstScore > secondScore ? firstRow : secondRow
        const loser = firstScore > secondScore ? secondRow : firstRow
        winner.won += 1; winner.points += 3; loser.lost += 1
      }
    })
    table.forEach((row) => { row.gd = row.goalsFor - row.goalsAgainst; groupByTeam.set(row.id, name) })
    return { name, teams: table.sort((a, b) => b.points - a.points || b.gd - a.gd || b.goalsFor - a.goalsFor) }
  })
  return { groups, groupByTeam }
}

function isWorldCupWinnerMarket(market) {
  const ticker = `${market.ticker || ''} ${market.event_ticker || ''}`.toUpperCase()
  const copy = `${market.title || ''} ${market.subtitle || ''}`.toLowerCase()
  const worldCupTicker = /(?:KX)?(?:WC|WORLDCUP|WORLD.*CUP)/.test(ticker)
  const winnerMarket = /\bwin(?:ner)?\b|champion/.test(copy) || /(?:WIN|CHAMP)/.test(ticker)
  return worldCupTicker && winnerMarket
}

async function espnData() {
  const params = new URLSearchParams({ dates: '20260611-20260719', limit: '200' })
  const [scoreboard, standings] = await Promise.all([
    fetchJson(`${espnScoreboardUrl}?${params}`),
    fetchJson(espnStandingsUrl),
  ])
  const events = scoreboard.body.events || []
  const { groups, groupByTeam } = deriveGroups(events, standings.body)
  return { matches: events.map((event) => normalizeEspnMatch(event, groupByTeam)), groups }
}

function normalizeKalshiMarkets(markets) {
  return markets.filter(isWorldCupWinnerMarket).map((market) => {
    const bid = Number(market.yes_bid_dollars)
    const ask = Number(market.yes_ask_dollars)
    const last = Number(market.last_price_dollars)
    const price = bid > 0 && ask > 0 ? (bid + ask) / 2 : last || ask || bid
    const team = market.yes_sub_title || market.subtitle || market.title
    return {
      team,
      probability: price * 100,
      decimal: price > 0 ? 1 / price : null,
      ticker: market.ticker,
      volume: Number(market.volume_fp || market.volume || 0),
    }
  }).filter((market) => market.team && market.probability > 0).sort((a, b) => b.probability - a.probability)
}

async function kalshiData() {
  const markets = []
  let cursor = ''
  // Kalshi caps each response at 1,000 markets, so follow cursors before filtering locally.
  for (let page = 0; page < 10; page += 1) {
    const params = new URLSearchParams({ limit: '1000', status: 'open', series_ticker: 'KXMENWORLDCUP' })
    if (cursor) params.set('cursor', cursor)
    const { body } = await fetchJson(`${kalshiMarketsUrl}?${params}`)
    markets.push(...(body.markets || []))
    cursor = body.cursor
    if (!cursor) break
  }
  return { odds: normalizeKalshiMarkets(markets) }
}

app.get('/api/health', (_req, res) => res.json({ ok: true }))

app.get('/api/dashboard', async (_req, res) => {
  const [football, odds] = await Promise.allSettled([
    cached('espn', 25_000, espnData),
    cached('kalshi', 25_000, kalshiData),
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
