(() => {
  const {pathname, search, origin} = window.location;
  const resume = pathname === "/offline.html" ? new URLSearchParams(search).get("resume") : pathname + search;
  try {
    const target = resume && new URL(resume, origin);
    if (target?.origin === origin && (target.pathname === "/" || target.pathname === "/live")) {
      document.getElementById("reconnect").href = target.href;
    }
  } catch {
    // Keep the default home link when the saved address is invalid.
  }

  let board;
  try {
    board = JSON.parse(localStorage.getItem("cowboy.offlineBoard.v1") || "null");
  } catch {
    return;
  }

  if (board?.source !== "ESPN" || !Number.isFinite(Date.parse(board.fetchedAt)) || !Array.isArray(board.games)) return;
  const games = board.games.slice(0, 250).filter(game => {
    return game && typeof game.league === "string" && typeof game.statusText === "string" &&
      Number.isFinite(Date.parse(game.startsAt)) &&
      typeof game.away?.name === "string" && typeof game.home?.name === "string";
  });
  const source = document.getElementById("source");
  const timestamp = document.createElement("time");
  timestamp.dateTime = board.fetchedAt;
  timestamp.textContent = new Date(board.fetchedAt).toLocaleString();
  source.replaceChildren("Scoreboard saved ", timestamp, ". Scores and game status may have changed.");
  if (board.partial) source.append(" Only leagues confirmed in the last update are shown.");
  if (!games.length) return;

  document.getElementById("controls").hidden = false;
  const filter = document.getElementById("league");
  filter.add(new Option("All leagues", ""));
  for (const league of [...new Set(games.map(game => game.league))].sort()) filter.add(new Option(league, league));

  function row(team) {
    const line = document.createElement("p");
    line.className = "matchup";
    const name = document.createElement("span");
    name.textContent = team.name;
    const score = document.createElement("b");
    score.textContent = Number.isFinite(team.score) ? String(team.score) : "—";
    line.append(name, score);
    return line;
  }

  function render() {
    const selected = filter.value ? games.filter(game => game.league === filter.value) : games;
    document.getElementById("count").textContent = `${selected.length} ${selected.length === 1 ? "game" : "games"}`;
    document.getElementById("games").replaceChildren(...selected.map(game => {
      const item = document.createElement("li");
      const meta = document.createElement("p");
      meta.className = "game-meta";
      const status = game.status === "scheduled" ? new Date(game.startsAt).toLocaleString() : game.statusText;
      meta.textContent = `${game.league} · ${status}`;
      const confirmed = Number.isFinite(Date.parse(game.confirmedAt)) ? game.confirmedAt : board.fetchedAt;
      const updated = document.createElement("time");
      updated.dateTime = confirmed;
      updated.textContent = "Last confirmed " + new Date(confirmed).toLocaleString();
      item.append(meta, row(game.away), row(game.home), updated);
      return item;
    }));
  }

  filter.addEventListener("change", render);
  render();
})();
