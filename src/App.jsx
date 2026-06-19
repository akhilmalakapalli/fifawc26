import { useEffect, useMemo, useState } from 'react'

const groupNames = 'ABCDEFGHIJKL'.split('')
const rounds = [
  ['Round of 32', 'LAST_32', 16],
  ['Round of 16', 'LAST_16', 8],
  ['Quarterfinals', 'QUARTER_FINALS', 4],
  ['Semifinals', 'SEMI_FINALS', 2],
  ['Final', 'FINAL', 1],
]
const activeStatuses = new Set(['IN_PLAY', 'PAUSED', 'EXTRA_TIME', 'PENALTY_SHOOTOUT'])

function useDashboard() {
  const [state, setState] = useState({ loading: true, football: { matches: [], groups: [] }, odds: { odds: [] } })
  useEffect(() => {
    let mounted = true
    const load = () => fetch('/api/dashboard')
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Dashboard unavailable')))
      .then((data) => mounted && setState({ ...data, loading: false }))
      .catch((error) => mounted && setState((current) => ({ ...current, loading: false, error: error.message })))
    load()
    const timer = setInterval(load, 30_000)
    return () => { mounted = false; clearInterval(timer) }
  }, [])
  return state
}

function Team({ team, align = 'left' }) {
  return <span className={`team team-${align}`}>
    {align === 'right' && <span>{team?.tla || 'TBD'}</span>}
    {team?.crest ? <img src={team.crest} alt="" /> : <i>{team?.tla?.slice(0, 2) || '?'}</i>}
    {align !== 'right' && <span>{team?.shortName || team?.name || 'To be decided'}</span>}
  </span>
}

function MatchCard({ match }) {
  const live = activeStatuses.has(match.status)
  const date = match.date ? new Date(match.date) : null
  return <article className={`match-card ${live ? 'is-live' : ''}`}>
      <div className="match-meta">
      <span>{live ? `${match.minute || ''} LIVE` : match.status === 'FINISHED' ? 'FULL TIME' : date?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      <span>{match.group?.replace('GROUP_', 'GROUP ') || match.stage?.replaceAll('_', ' ')}</span>
    </div>
    <div className="score-row"><Team team={match.home} /><strong>{match.homeScore ?? '-'}</strong></div>
    <div className="score-row"><Team team={match.away} /><strong>{match.awayScore ?? '-'}</strong></div>
    <time>{date?.toLocaleDateString([], { month: 'short', day: 'numeric' })}</time>
  </article>
}

function LiveScores({ matches, loading, error }) {
  const today = new Date().toLocaleDateString('en-CA')
  const todaysMatches = matches.filter((match) => new Date(match.date).toLocaleDateString('en-CA') === today)
  const visible = todaysMatches.length ? todaysMatches : matches.filter((match) => activeStatuses.has(match.status)).slice(0, 8)
  return <section id="scores" className="section dark-section">
    <SectionHead number="01" eyebrow="Match centre" title="Live scores" detail="Auto-refreshes every 30 seconds" light />
    {visible.length ? <div className="match-grid">{visible.map((match) => <MatchCard key={match.id} match={match} />)}</div> : <EmptyState loading={loading} error={error} text="No World Cup matches are scheduled today." />}
  </section>
}

function GroupCard({ name, teams }) {
  return <article className="group-card">
    <header><span>Group</span><strong>{name}</strong></header>
    <div className="table-head"><span>Team</span><span>W</span><span>D</span><span>L</span><span>GD</span><span>Pts</span></div>
    {(teams.length ? teams : Array.from({ length: 4 })).map((team, index) => <div className="table-row" key={team?.code || index}>
      <span className="table-team"><b>{index + 1}</b>{team?.crest ? <img src={team.crest} alt="" /> : <i />}{team?.code || 'TBD'}</span>
      <span>{team?.won ?? '-'}</span><span>{team?.draw ?? '-'}</span><span>{team?.lost ?? '-'}</span><span>{team?.gd ?? '-'}</span><strong>{team?.points ?? '-'}</strong>
    </div>)}
  </article>
}

function Groups({ groups, error }) {
  const groupMap = Object.fromEntries(groups.map((group) => [group.name, group.teams]))
  return <section id="groups" className="section groups-section">
    <SectionHead number="02" eyebrow="Road to the knockouts" title="Groups A-L" detail="Sorted by points, then goal difference" />
    {error && <InlineNotice text={error} />}
    <div className="groups-grid">{groupNames.map((name) => <GroupCard key={name} name={name} teams={groupMap[name] || []} />)}</div>
  </section>
}

const standingsColumns = [
  { key: 'played', label: 'P' },
  { key: 'won', label: 'W' },
  { key: 'draw', label: 'D' },
  { key: 'lost', label: 'L' },
  { key: 'goalsFor', label: 'GF' },
  { key: 'goalsAgainst', label: 'GA' },
  { key: 'gd', label: 'GD' },
  { key: 'points', label: 'PTS' },
]

function Standings({ groups, loading, error }) {
  const [sort, setSort] = useState({ key: 'points', dir: 'desc' })
  const teams = useMemo(() => groups.flatMap((group) =>
    (group.teams || []).map((team, index) => ({ ...team, group: group.name, groupPos: index + 1, qualified: index < 2 }))
  ), [groups])

  const sorted = useMemo(() => {
    const tiebreak = (a, b) => (b.points - a.points) || (b.gd - a.gd) || (b.goalsFor - a.goalsFor)
    return [...teams].sort((a, b) => {
      let result
      if (sort.key === 'team') result = (a.name || '').localeCompare(b.name || '') || -tiebreak(a, b)
      else if (sort.key === 'group') result = (a.group || '').localeCompare(b.group || '') || a.groupPos - b.groupPos
      else result = ((b[sort.key] || 0) - (a[sort.key] || 0)) || tiebreak(a, b)
      return sort.dir === 'asc' ? -result : result
    })
  }, [teams, sort])

  const toggle = (key) => setSort((current) => current.key === key
    ? { key, dir: current.dir === 'desc' ? 'asc' : 'desc' }
    : { key, dir: key === 'team' || key === 'group' ? 'asc' : 'desc' })
  const indicator = (key) => sort.key === key ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''

  return <section id="standings" className="section standings-section">
    <SectionHead number="03" eyebrow="Every team, ranked" title="Standings" detail="Top 2 per group advance · click a column to sort" />
    {error && <InlineNotice text={error} />}
    {teams.length ? <div className="standings-wrap">
      <table className="standings-table">
        <thead><tr>
          <th className="col-pos">#</th>
          <th className="col-team sortable" onClick={() => toggle('team')}>Team{indicator('team')}</th>
          <th className="sortable" onClick={() => toggle('group')}>GRP{indicator('group')}</th>
          {standingsColumns.map((column) => <th key={column.key} className="sortable" onClick={() => toggle(column.key)}>{column.label}{indicator(column.key)}</th>)}
        </tr></thead>
        <tbody>
          {sorted.map((team, index) => <tr key={team.id || `${team.group}-${team.code}`} className={team.qualified ? 'is-qualified' : ''}>
            <td className="col-pos"><b>{index + 1}</b></td>
            <td className="col-team">{team.qualified && <i className="q-badge">Q</i>}{team.crest ? <img src={team.crest} alt="" /> : <i className="crest-fallback" />}<span>{team.name || team.code}</span></td>
            <td className="col-group">{team.group || '-'}</td>
            {standingsColumns.map((column) => <td key={column.key} className={column.key === 'points' ? 'col-pts' : ''}>{column.key === 'gd' && team.gd > 0 ? `+${team.gd}` : team[column.key] ?? 0}</td>)}
          </tr>)}
        </tbody>
      </table>
    </div> : <EmptyState loading={loading} error={error} text="Standings appear once group matches kick off." />}
    {teams.length ? <p className="standings-legend"><i className="q-badge">Q</i> Currently in the top 2 of its group — on track to reach the knockout stage.</p> : null}
  </section>
}

function BracketMatch({ match, index }) {
  const name = (team) => team?.tla || team?.shortName || 'TBD'
  return <div className="bracket-match">
    <span><b>{index * 2 + 1}</b>{name(match?.home)}<em>{match?.homeScore ?? '-'}</em></span>
    <span><b>{index * 2 + 2}</b>{name(match?.away)}<em>{match?.awayScore ?? '-'}</em></span>
  </div>
}

function Bracket({ matches }) {
  return <section id="bracket" className="section bracket-section">
    <SectionHead number="04" eyebrow="Win or go home" title="The bracket" detail="Slots update as teams advance" light />
    <div className="bracket-scroll"><div className="bracket">
      {rounds.map(([label, stage, count]) => {
        const stageMatches = matches.filter((match) => match.stage === stage)
        return <div className="round" key={stage}><h3>{label}<span>{count * 2} teams</span></h3><div className="round-list">{Array.from({ length: count }, (_, index) => <BracketMatch key={index} index={index} match={stageMatches[index]} />)}</div></div>
      })}
    </div></div>
  </section>
}

function Odds({ odds, error }) {
  return <section id="odds" className="section odds-section">
    <SectionHead number="05" eyebrow="Kalshi market" title="Winner odds" detail="Updates every 30 seconds" />
    {error && <InlineNotice text={error} />}
    <div className="odds-layout">
      <div className="odds-lede"><span className="outline-26">26</span><p>Who lifts the trophy?</p><small>Live market-implied chance based on the midpoint of Kalshi's YES bid and ask, with the last traded price as fallback.</small><a className="kalshi-link" href="https://kalshi.com/category/sports/soccer/world-soccer-cup/soccer-cup/games" target="_blank" rel="noreferrer">Bet on Kalshi <b>↗</b></a></div>
      <div className="odds-list">
        {(odds.length ? odds.slice(0, 12) : Array.from({ length: 8 })).map((item, index) => <article className="odds-card" key={item?.team || index}>
          <b>{String(index + 1).padStart(2, '0')}</b><strong>{item?.team || 'Awaiting market'}</strong>
          <div><span>{item ? `${item.probability.toFixed(1)}%` : '--'}</span><em>{item?.decimal ? `${item.decimal.toFixed(2)}x` : '--'}</em></div>
          <i style={{ width: `${item ? Math.min(item.probability * 3, 100) : 0}%` }} />
        </article>)}
      </div>
    </div>
  </section>
}

function SectionHead({ number, eyebrow, title, detail, light = false }) {
  return <header className={`section-head ${light ? 'light' : ''}`}><span>{number}</span><div><small>{eyebrow}</small><h2>{title}</h2></div><p>{detail}</p></header>
}

function EmptyState({ loading, error, text }) {
  return <div className="empty-state"><span className={loading ? 'spinner' : ''} /> <strong>{loading ? 'Loading live data' : error || text}</strong></div>
}

function InlineNotice({ text }) { return <div className="inline-notice"><span>!</span>{text}</div> }

export default function App() {
  const data = useDashboard()
  const matches = data.football?.matches || []
  const liveCount = useMemo(() => matches.filter((match) => activeStatuses.has(match.status)).length, [matches])
  return <main>
    <header className="topbar">
      <a className="brand" href="#top"><b>WC<br />26</b><span><strong>FIFA World Cup 2026</strong><small>Live match centre</small></span></a>
      <nav><a href="#scores">Scores</a><a href="#groups">Groups</a><a href="#standings">Standings</a><a href="#bracket">Bracket</a><a href="#odds">Odds</a></nav>
      <div className="live-pill"><i />{liveCount ? `${liveCount} LIVE` : 'LIVE DATA'}</div>
    </header>
    <section className="hero" id="top">
      <div className="hero-copy"><span>United States / Canada / Mexico</span><h1>Every match.<br />Every moment.<br /><em>Live.</em></h1><p>Scores, standings, the road to the final and the market's favorites. One page, always current.</p><a href="#scores">Enter match centre <b>↓</b></a></div>
      <div className="hero-art"><span className="hero-number">26</span><div className="ball"><i /><i /><i /><i /><i /></div><div className="red-stripe">WORLD CUP WORLD CUP WORLD CUP</div></div>
      <footer><span>48 teams</span><span>104 matches</span><span>16 host cities</span><time>11.06 - 19.07</time></footer>
    </section>
    <LiveScores matches={matches} loading={data.loading} error={data.football?.error || data.error} />
    <Groups groups={data.football?.groups || []} error={data.football?.error} />
    <Standings groups={data.football?.groups || []} loading={data.loading} error={data.football?.error} />
    <Bracket matches={matches} />
    <Odds odds={data.odds?.odds || []} error={data.odds?.error} />
    <footer className="footer"><a className="brand" href="#top"><b>WC<br />26</b></a><p>Independent World Cup match centre.<br />Data refreshes automatically.</p><div><a href="https://www.espn.com/soccer/league/_/name/fifa.world" target="_blank" rel="noreferrer">ESPN scores ↗</a><a href="https://kalshi.com/category/sports/soccer/world-soccer-cup/soccer-cup/games" target="_blank" rel="noreferrer">Kalshi markets ↗</a></div></footer>
  </main>
}
