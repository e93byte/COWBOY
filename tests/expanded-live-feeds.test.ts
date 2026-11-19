import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createLiveSportsClient, LIVE_LEAGUES, normalizeScoreboard } from '../app/lib/live-sports';

const samples = JSON.parse(readFileSync(new URL('./fixtures/live-sports/expanded-scoreboards.json', import.meta.url), 'utf8'));
const golfSample = JSON.parse(readFileSync(new URL('./fixtures/live-sports/scoreboards.json', import.meta.url), 'utf8')).pga;
const expected = [
  { id: 'ncaab', sport: 'basketball', path: 'basketball/mens-college-basketball', home: 'UCLA Bruins', away: 'Long Beach State Beach' },
  { id: 'ncaaw', sport: 'basketball', path: 'basketball/womens-college-basketball', home: 'Central Michigan Chippewas', away: 'Michigan Wolverines' },
  { id: 'mls', sport: 'soccer', path: 'soccer/usa.1', home: 'Orlando City SC', away: 'FC Cincinnati' },
  { id: 'ucl', sport: 'soccer', path: 'soccer/uefa.champions', home: 'Bodo/Glimt', away: 'LASK Linz' },
  { id: 'bundesliga', sport: 'soccer', path: 'soccer/ger.1', home: 'Bayern Munich', away: 'FC Cologne' },
  { id: 'seriea', sport: 'soccer', path: 'soccer/ita.1', home: 'Como', away: 'Cagliari' },
  { id: 'ligue1', sport: 'soccer', path: 'soccer/fra.1', home: 'Troyes', away: 'Le Havre AC' },
  { id: 'brasileirao', sport: 'soccer', path: 'soccer/bra.1', home: 'Coritiba', away: 'Santos' },
  { id: 'aleague', sport: 'soccer', path: 'soccer/aus.1', home: 'Western Sydney Wanderers FC', away: 'Adelaide United FC' },
  { id: 'nationsleague', sport: 'soccer', path: 'soccer/uefa.nations', home: 'Faroe Islands', away: 'Moldova', winner: 'home' },
  { id: 'nwsl', sport: 'soccer', path: 'soccer/usa.nwsl', home: 'Gotham FC', away: 'Kansas City Current', winner: 'away' },
  { id: 'wsl', sport: 'soccer', path: 'soccer/eng.w.1', home: 'Aston Villa', away: 'Birmingham City', winner: 'home' },
  { id: 'bl2', sport: 'soccer', path: 'soccer/ger.2', home: 'Arminia Bielefeld', away: '1. FC Magdeburg' },
  { id: 'dfb_pokal', sport: 'soccer', path: 'soccer/ger.dfb_pokal', home: 'Holstein Kiel', away: 'FC Cologne' },
  { id: 'afl', sport: 'aussierules', path: 'australian-football/afl', home: 'Sydney Swans', away: 'Geelong Cats' },
  { id: 'nll', sport: 'lacrosse', path: 'lacrosse/nll', home: 'Oshawa FireWolves', away: 'Saskatchewan Rush' },
  { id: 'nrl', sport: 'rugby_league', path: 'rugby-league/3', home: 'Roosters', away: 'Knights', winner: 'home' },
  { id: 'mvb', sport: 'volleyball', path: 'volleyball/mens-college-volleyball', home: 'UC Santa Barbara Gauchos', away: 'Concordia University Irvine Golden Eagles' },
  { id: 'wvb', sport: 'volleyball', path: 'volleyball/womens-college-volleyball', home: 'New Mexico Lobos', away: 'Wyoming Cowboys', winner: 'away' },
  { id: 'wwp', sport: 'water_polo', path: 'water-polo/womens-college-water-polo', home: 'USC Trojans', away: 'California Golden Bears', winner: 'home' },
  { id: 'wfh', sport: 'field_hockey', path: 'field-hockey/womens-college-field-hockey', home: 'Maryland Terrapins', away: 'Harvard Crimson' },
  { id: 'bellator', sport: 'mma', path: 'mma/bellator', home: 'Darragh Kelly', away: 'Dmytrii Hrytsenko', winner: 'home' },
  { id: 'pfl', sport: 'mma', path: 'mma/pfl', home: 'Lorenzo Parente', away: 'Stiven Shehu' },
] as const;

for (const entry of expected) {
  test(`${entry.id} exposes the observed scoreboard and normalizes a real source fixture`, () => {
    const config = LIVE_LEAGUES.find(league => league.id === entry.id);
    assert.ok(config, `${entry.id} must be wired into the live board`);
    assert.equal(config.sport, entry.sport);
    assert.equal(config.path, entry.path);
    assert.equal(samples[entry.id]._source, `https://site.api.espn.com/apis/site/v2/sports/${config.path}/scoreboard`);
    const [event] = normalizeScoreboard(entry.id, samples[entry.id]);
    const firstEvent = samples[entry.id].events[0];
    // MMA scoreboards are fight cards: each bout is a competition with its own id.
    assert.equal(event.id, entry.sport === 'mma' ? firstEvent.competitions[0].id : firstEvent.id);
    assert.equal(event.home.name, entry.home);
    assert.equal(event.away.name, entry.away);
    const winner = 'winner' in entry ? entry.winner : null;
    assert.equal(event.status, winner ? 'final' : 'scheduled');
    assert.equal(event.winner, winner);
  });
}

test('expanded leagues are fetched through the same bounded board and source-verified detail path', async () => {
  const calls: string[] = [];
  const client = createLiveSportsClient({ fetch: async input => {
    const url = String(input);
    calls.push(url);
    const config = expected.find(entry => url.includes(`/${entry.path}/`));
    if (!config) return Response.json(url.includes('/golf/pga/') ? golfSample : { events: [] });
    if (url.endsWith('/scoreboard')) return Response.json(samples[config.id]);
    if (url.endsWith(`/summary?event=${samples[config.id].events[0].id}`)) {
      return Response.json({ header: samples[config.id].events[0] });
    }
    return new Response(null, { status: 404 });
  } });
  const board = await client.getLiveBoard();
  assert.equal(board.leagues.length, LIVE_LEAGUES.length);
  assert.equal(board.leagues.filter(league => league.status === 'ok').length, LIVE_LEAGUES.length);
  assert.ok(board.golf?.[0].leaderboard.length);
  for (const entry of expected) {
    const event = board.events.find(event => event.league === entry.id);
    assert.ok(event, `${entry.id} appears on the board`);
    assert.equal(board.leagues.find(league => league.id === entry.id)?.status, 'ok');
    const detail = await client.getLiveEvent(entry.id, event.id);
    assert.equal(detail?.id, event.id);
    assert.equal(detail?.home.name, entry.home);
    // MMA details resolve through the scoreboard cache, not /summary.
    if (entry.sport === 'mma') {
      assert.ok(calls.includes(`https://site.api.espn.com/apis/site/v2/sports/${entry.path}/scoreboard`));
    } else {
      assert.ok(calls.includes(`https://site.api.espn.com/apis/site/v2/sports/${entry.path}/summary?event=${event.id}`));
    }
  }
});
