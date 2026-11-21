export type LeagueAvailability = 'live' | 'scheduled' | 'delayed' | 'unsupported' | 'maintenance';

export type SportsLeague = {
  id: string;
  sport: string;
  name: string;
  /** ESPN path for the currently validated primary provider, if available. */
  path: string;
  region: string;
  availability: LeagueAvailability;
  provider: string;
  sourceEnabled: boolean;
};

const VERIFIED_LEAGUES: Array<Omit<SportsLeague, 'region' | 'availability' | 'provider' | 'sourceEnabled'> & Partial<Pick<SportsLeague, 'region' | 'availability' | 'provider' | 'sourceEnabled'>>> = [
  { id: 'nfl', sport: 'football', name: 'NFL', path: 'football/nfl', region: 'United States', availability: 'live', provider: 'ESPN + verified fallbacks', sourceEnabled: true },
  { id: 'ncaaf', sport: 'football', name: 'NCAA Football', path: 'football/college-football' },
  { id: 'nba', sport: 'basketball', name: 'NBA', path: 'basketball/nba' },
  { id: 'wnba', sport: 'basketball', name: 'WNBA', path: 'basketball/wnba' },
  { id: 'ncaab', sport: 'basketball', name: "NCAA Men's Basketball", path: 'basketball/mens-college-basketball' },
  { id: 'ncaaw', sport: 'basketball', name: "NCAA Women's Basketball", path: 'basketball/womens-college-basketball' },
  { id: 'mlb', sport: 'baseball', name: 'MLB', path: 'baseball/mlb' },
  { id: 'nhl', sport: 'hockey', name: 'NHL', path: 'hockey/nhl' },
  { id: 'ncaah', sport: 'hockey', name: "NCAA Men's Ice Hockey", path: 'hockey/mens-college-hockey' },
  { id: 'ncaawh', sport: 'hockey', name: "NCAA Women's Ice Hockey", path: 'hockey/womens-college-hockey' },
  { id: 'epl', sport: 'soccer', name: 'Premier League', path: 'soccer/eng.1' },
  { id: 'efl', sport: 'soccer', name: 'EFL Championship', path: 'soccer/eng.2' },
  { id: 'facup', sport: 'soccer', name: 'FA Cup', path: 'soccer/eng.fa' },
  { id: 'laliga', sport: 'soccer', name: 'La Liga', path: 'soccer/esp.1' },
  { id: 'mls', sport: 'soccer', name: 'MLS', path: 'soccer/usa.1' },
  { id: 'ucl', sport: 'soccer', name: 'Champions League', path: 'soccer/uefa.champions' },
  { id: 'uel', sport: 'soccer', name: 'Europa League', path: 'soccer/uefa.europa' },
  { id: 'uecl', sport: 'soccer', name: 'Conference League', path: 'soccer/uefa.europa.conf' },
  { id: 'bundesliga', sport: 'soccer', name: 'Bundesliga', path: 'soccer/ger.1' },
  { id: 'bl2', sport: 'soccer', name: '2. Bundesliga', path: 'soccer/ger.2' },
  { id: 'bl3', sport: 'soccer', name: '3. Liga', path: 'soccer/ger.3' },
  { id: 'dfb_pokal', sport: 'soccer', name: 'DFB-Pokal', path: 'soccer/ger.dfb_pokal' },
  { id: 'seriea', sport: 'soccer', name: 'Serie A', path: 'soccer/ita.1' },
  { id: 'ligue1', sport: 'soccer', name: 'Ligue 1', path: 'soccer/fra.1' },
  { id: 'ligue2', sport: 'soccer', name: 'Ligue 2', path: 'soccer/fra.2' },
  { id: 'eredivisie', sport: 'soccer', name: 'Eredivisie', path: 'soccer/ned.1' },
  { id: 'primeira', sport: 'soccer', name: 'Primeira Liga', path: 'soccer/por.1' },
  { id: 'scottish', sport: 'soccer', name: 'Scottish Premiership', path: 'soccer/sco.1' },
  { id: 'superlig', sport: 'soccer', name: 'Turkish Super Lig', path: 'soccer/tur.1' },
  { id: 'belgian', sport: 'soccer', name: 'Belgian Pro League', path: 'soccer/bel.1' },
  { id: 'saudi', sport: 'soccer', name: 'Saudi Pro League', path: 'soccer/ksa.1' },
  { id: 'ligamx', sport: 'soccer', name: 'Liga MX', path: 'soccer/mex.1' },
  { id: 'argentina', sport: 'soccer', name: 'Argentine Primera División', path: 'soccer/arg.1' },
  { id: 'brasileirao', sport: 'soccer', name: 'Brasileirão Série A', path: 'soccer/bra.1' },
  { id: 'libertadores', sport: 'soccer', name: 'Copa Libertadores', path: 'soccer/conmebol.libertadores' },
  { id: 'sudamericana', sport: 'soccer', name: 'Copa Sudamericana', path: 'soccer/conmebol.sudamericana' },
  { id: 'aleague', sport: 'soccer', name: 'A-League Men', path: 'soccer/aus.1' },
  { id: 'nationsleague', sport: 'soccer', name: 'UEFA Nations League', path: 'soccer/uefa.nations' },
  { id: 'concacafnl', sport: 'soccer', name: 'Concacaf Nations League', path: 'soccer/concacaf.nations.league' },
  { id: 'afconqual', sport: 'soccer', name: 'AFCON Qualifying', path: 'soccer/caf.nations_qual' },
  { id: 'nwsl', sport: 'soccer', name: 'NWSL', path: 'soccer/usa.nwsl' },
  { id: 'wsl', sport: 'soccer', name: "Women's Super League", path: 'soccer/eng.w.1' },
  { id: 'atp', sport: 'tennis', name: 'ATP', path: 'tennis/atp' },
  { id: 'wta', sport: 'tennis', name: 'WTA', path: 'tennis/wta' },
  { id: 'ufc', sport: 'mma', name: 'UFC', path: 'mma/ufc' },
  { id: 'bellator', sport: 'mma', name: 'Bellator', path: 'mma/bellator' },
  { id: 'pfl', sport: 'mma', name: 'PFL', path: 'mma/pfl' },
  { id: 'premrugby', sport: 'rugby', name: 'Premiership Rugby', path: 'rugby/267979' },
  { id: 'top14', sport: 'rugby', name: 'French Top 14', path: 'rugby/270559' },
  { id: 'championsrugby', sport: 'rugby', name: 'European Rugby Champions Cup', path: 'rugby/271937' },
  { id: 'nrl', sport: 'rugby_league', name: 'NRL', path: 'rugby-league/3' },
  { id: 'afl', sport: 'aussierules', name: 'AFL', path: 'australian-football/afl' },
  { id: 'nll', sport: 'lacrosse', name: 'NLL', path: 'lacrosse/nll' },
  { id: 'pll', sport: 'lacrosse', name: 'PLL', path: 'lacrosse/pll' },
  { id: 'mvb', sport: 'volleyball', name: "NCAA Men's Volleyball", path: 'volleyball/mens-college-volleyball' },
  { id: 'wvb', sport: 'volleyball', name: "NCAA Women's Volleyball", path: 'volleyball/womens-college-volleyball' },
  { id: 'mwp', sport: 'water_polo', name: "NCAA Men's Water Polo", path: 'water-polo/mens-college-water-polo' },
  { id: 'wwp', sport: 'water_polo', name: "NCAA Women's Water Polo", path: 'water-polo/womens-college-water-polo' },
  { id: 'wfh', sport: 'field_hockey', name: "NCAA Women's Field Hockey", path: 'field-hockey/womens-college-field-hockey' },
  { id: 'pga', sport: 'golf', name: 'PGA Tour', path: 'golf/pga' },
] ;

type PendingLeague = readonly [id: string, sport: string, name: string, region: string];
const pending = (entries: readonly PendingLeague[]): SportsLeague[] => entries.map(([id, sport, name, region]) => ({
  id, sport, name, region, path: '', availability: 'unsupported', provider: 'Awaiting approved provider', sourceEnabled: false,
}));

/**
 * The catalogue is intentionally broader than the feed set.  A competition is
 * discoverable globally, but can only receive scores, markets, or token picks
 * once a source adapter has passed its identity/freshness checks.
 */
const CATALOGUE_ONLY = pending([
  ['liga1','soccer','Liga 1','Romania'],['superliga_gr','soccer','Super League Greece','Greece'],['ekstraklasa','soccer','Ekstraklasa','Poland'],['czech1','soccer','Czech First League','Czechia'],['superliga_rs','soccer','Serbian SuperLiga','Serbia'],['hnb','soccer','Croatian Football League','Croatia'],['superliga_dk','soccer','Danish Superliga','Denmark'],['eliteserien','soccer','Eliteserien','Norway'],['allsvenskan','soccer','Allsvenskan','Sweden'],['veikkausliiga','soccer','Veikkausliiga','Finland'],
  ['superliga_ch','soccer','Swiss Super League','Switzerland'],['austrian_bundesliga','soccer','Austrian Bundesliga','Austria'],['ukraine_premier','soccer','Ukrainian Premier League','Ukraine'],['bulgaria_first','soccer','Bulgarian First League','Bulgaria'],['hungary_nb1','soccer','Nemzeti Bajnokság I','Hungary'],['slovakia_super','soccer','Slovak Super Liga','Slovakia'],['slovenia_prva','soccer','Slovenian PrvaLiga','Slovenia'],['bosnia_premier','soccer','Bosnian Premier League','Bosnia and Herzegovina'],['israel_premier','soccer','Israeli Premier League','Israel'],['qatar_stars','soccer','Qatar Stars League','Qatar'],
  ['uae_pro','soccer','UAE Pro League','United Arab Emirates'],['j1','soccer','J1 League','Japan'],['j2','soccer','J2 League','Japan'],['k1','soccer','K League 1','South Korea'],['csl','soccer','Chinese Super League','China'],['isl','soccer','Indian Super League','India'],['thai1','soccer','Thai League 1','Thailand'],['vleague1','soccer','V.League 1','Vietnam'],['indonesia1','soccer','Liga 1 Indonesia','Indonesia'],['malaysia_super','soccer','Malaysia Super League','Malaysia'],
  ['south_africa_psl','soccer','South African Premiership','South Africa'],['egypt_premier','soccer','Egyptian Premier League','Egypt'],['morocco_botola','soccer','Botola Pro','Morocco'],['tunisia1','soccer','Tunisian Ligue Professionnelle 1','Tunisia'],['algeria1','soccer','Algerian Ligue 1','Algeria'],['nigeria_npfl','soccer','Nigeria Premier Football League','Nigeria'],['kenya_pl','soccer','Kenyan Premier League','Kenya'],['ghana_pl','soccer','Ghana Premier League','Ghana'],['caf_cl','soccer','CAF Champions League','Africa'],['caf_conf','soccer','CAF Confederation Cup','Africa'],
  ['copa_america','soccer','Copa América','South America'],['concacaf_champions','soccer','CONCACAF Champions Cup','North America'],['gold_cup','soccer','CONCACAF Gold Cup','North America'],['world_cup','soccer','FIFA World Cup','Global'],['club_world_cup','soccer','FIFA Club World Cup','Global'],['olympic_soccer','soccer','Olympic Football','Global'],['afc_champions','soccer','AFC Champions League Elite','Asia'],['afc_cup','soccer','AFC Champions League Two','Asia'],['ofc_champions','soccer','OFC Champions League','Oceania'],['coppa_italia','soccer','Coppa Italia','Italy'],
  ['nba_gleague','basketball','NBA G League','United States'],['euroleague','basketball','EuroLeague','Europe'],['eurocup','basketball','EuroCup','Europe'],['acb','basketball','Liga ACB','Spain'],['bbl_de','basketball','Basketball Bundesliga','Germany'],['lnb_proa','basketball','LNB Pro A','France'],['legabasket','basketball','Lega Basket Serie A','Italy'],['vtb','basketball','VTB United League','Europe'],['nbl_au','basketball','National Basketball League','Australia'],['cba','basketball','Chinese Basketball Association','China'],['b_league','basketball','B.League','Japan'],['kbl','basketball','Korean Basketball League','South Korea'],['pba','basketball','Philippine Basketball Association','Philippines'],['bal','basketball','Basketball Africa League','Africa'],['wnbl','basketball','WNBL','Australia'],
  ['cfl','football','Canadian Football League','Canada'],['ufl','football','United Football League','United States'],['elf','football','European League of Football','Europe'],['gfl','football','German Football League','Germany'],['lfa','football','Liga de Fútbol Americano','Mexico'],['xleague','football','X-League','Japan'],['italy_football','football','Italian Football League','Italy'],['brazil_football','football','Brazilian Football League','Brazil'],['austria_football','football','Austrian Football League','Austria'],['ifaf_world','football','IFAF World Championship','Global'],
  ['npb','baseball','Nippon Professional Baseball','Japan'],['kbo','baseball','KBO League','South Korea'],['cpbl','baseball','Chinese Professional Baseball League','Taiwan'],['mexican_league','baseball','Liga Mexicana de Béisbol','Mexico'],['caribbean_series','baseball','Caribbean Series','Caribbean'],['dominican_winter','baseball','Dominican Winter League','Dominican Republic'],['venezuela_winter','baseball','Venezuelan Winter League','Venezuela'],['australian_baseball','baseball','Australian Baseball League','Australia'],['italian_baseball','baseball','Italian Baseball League','Italy'],['european_baseball','baseball','European Baseball Championship','Europe'],
  ['shl','hockey','Swedish Hockey League','Sweden'],['liiga','hockey','Liiga','Finland'],['del','hockey','Deutsche Eishockey Liga','Germany'],['nl_hockey','hockey','National League','Switzerland'],['extraliga_cz','hockey','Czech Extraliga','Czechia'],['khl','hockey','Kontinental Hockey League','Eurasia'],['ahl','hockey','American Hockey League','North America'],['echl','hockey','ECHL','United States'],['whl','hockey','Western Hockey League','Canada'],['iihf_worlds','hockey','IIHF World Championship','Global'],
  ['davis_cup','tennis','Davis Cup','Global'],['billie_jean_king','tennis','Billie Jean King Cup','Global'],['atp_challenger','tennis','ATP Challenger Tour','Global'],['itf_men','tennis','ITF Men’s World Tennis Tour','Global'],['itf_women','tennis','ITF Women’s World Tennis Tour','Global'],['australian_open','tennis','Australian Open','Australia'],['roland_garros','tennis','Roland-Garros','France'],['wimbledon','tennis','Wimbledon','United Kingdom'],['us_open_tennis','tennis','US Open Tennis','United States'],['united_cup','tennis','United Cup','Australia'],
  ['ipl','cricket','Indian Premier League','India'],['bbl_cricket','cricket','Big Bash League','Australia'],['psl_cricket','cricket','Pakistan Super League','Pakistan'],['cpl','cricket','Caribbean Premier League','Caribbean'],['hundred','cricket','The Hundred','United Kingdom'],['sa20','cricket','SA20','South Africa'],['bpl_cricket','cricket','Bangladesh Premier League','Bangladesh'],['lpl_cricket','cricket','Lanka Premier League','Sri Lanka'],['icc_odi','cricket','ICC ODI Championship','Global'],['icc_t20','cricket','ICC T20 World Cup','Global'],
  ['f1','motorsport','Formula 1','Global'],['formula_e','motorsport','Formula E','Global'],['indycar','motorsport','IndyCar Series','United States'],['nascar_cup','motorsport','NASCAR Cup Series','United States'],['motogp','motorsport','MotoGP','Global'],['worldsbk','motorsport','Superbike World Championship','Global'],['wrc','motorsport','World Rally Championship','Global'],['wec','motorsport','FIA World Endurance Championship','Global'],['supercars','motorsport','Supercars Championship','Australia'],['formula2','motorsport','Formula 2','Global'],
  ['boxing','boxing','Professional Boxing','Global'],['one','mma','ONE Championship','Asia'],['rizin','mma','Rizin Fighting Federation','Japan'],['k1_kickboxing','mma','K-1 Kickboxing','Japan'],['glory','mma','GLORY Kickboxing','Global'],['bare_knuckle','mma','Bare Knuckle Fighting Championship','United States'],
  ['urc','rugby','United Rugby Championship','Europe'],['super_rugby','rugby','Super Rugby Pacific','Pacific'],['japan_rugby','rugby','Japan Rugby League One','Japan'],['currie_cup','rugby','Currie Cup','South Africa'],['six_nations','rugby','Six Nations','Europe'],['rugby_world_cup','rugby','Rugby World Cup','Global'],['super_league','rugby_league','Super League','Europe'],['state_of_origin','rugby_league','State of Origin','Australia'],
  ['handball_champions','handball','EHF Champions League','Europe'],['handball_bundesliga','handball','Handball-Bundesliga','Germany'],['liga_asobal','handball','Liga ASOBAL','Spain'],['volleyball_nations','volleyball','Volleyball Nations League','Global'],['superlega','volleyball','Italian SuperLega','Italy'],['plusliga','volleyball','Polish PlusLiga','Poland'],['vleague_jp','volleyball','Japan V.League','Japan'],['beach_volleyball','volleyball','Beach Volleyball World Tour','Global'],['futsal_wc','futsal','FIFA Futsal World Cup','Global'],['floorball_wc','floorball','Floorball World Championship','Global'],
  ['darts_pdc','darts','PDC Darts','Global'],['snooker_wst','snooker','World Snooker Tour','Global'],['table_tennis_wtt','table_tennis','World Table Tennis','Global'],['badminton_bwf','badminton','BWF World Tour','Global'],['cycling_worldtour','cycling','UCI WorldTour','Global'],['winter_olympics','winter_sports','Winter Olympic Sports','Global'],['esports_lol','esports','League of Legends Esports','Global'],['esports_cs','esports','Counter-Strike Esports','Global'],['esports_valorant','esports','VALORANT Champions Tour','Global'],['olympics','multi_sport','Olympic Games','Global'],
]);

export const LIVE_LEAGUES: readonly SportsLeague[] = VERIFIED_LEAGUES.map(league => ({
  ...league,
  region: league.region ?? 'Global',
  availability: league.availability ?? 'live',
  provider: league.provider ?? 'ESPN + verified fallbacks',
  sourceEnabled: league.sourceEnabled ?? true,
}));

/** Every competition COWBOY can surface in discovery and personalization. */
export const SPORTS_CATALOGUE: readonly SportsLeague[] = LIVE_LEAGUES.concat(CATALOGUE_ONLY);

/** Only these are polled until a new adapter is approved and enabled. */
export const SOURCE_LEAGUES = LIVE_LEAGUES.filter(league => league.sourceEnabled);

export function getLeague(id: string): SportsLeague | undefined {
  return SPORTS_CATALOGUE.find(league => league.id === id);
}

export function hasRecordStandings(league: string): boolean {
  return ['nba', 'wnba', 'mlb', 'nfl', 'nhl'].includes(league);
}
