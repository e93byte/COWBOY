'use client';

import {useRef, useState} from 'react';

const topics = [
  {
    id:'free-picks', title:'Free picks', link:{href:'/',label:'Open the sports board'},
    articles:[
      {title:'How do I make a pick?', text:'Choose an eligible game on the sports board or open Game Center to select a winner, spread, or total when the source has posted that market. Then sign in and confirm. You can review up to five independent picks together, including different markets on one game. You may play free or use COWBOY Tokens. Tokens have no cash value, cannot be purchased or redeemed, and there are no deposits or prizes.'},
      {title:'Why is a pick locked?', text:'Entry closes at scheduled start or when the source stops reporting the game as scheduled. A delayed or unavailable league feed pauses entry for that league. The server checks game status again when you confirm.'},
      {title:'Can I change or cancel a pick?', text:'Open My picks to edit or cancel an open pick before scheduled start. The server checks the current game status before accepting the change.'},
      {title:'Where is COWBOY available?', text:'COWBOY is a free-prediction service, not a sportsbook. Availability and sports-data coverage can vary by location, device, and data provider; the app does not verify worldwide availability.'},
    ],
  },
  {
    id:'results', title:'Results and settlement', link:{href:'/picks',label:'Open My picks'},
    articles:[
      {title:'How are results confirmed?', text:'Use Refresh results in My picks. A pick stays open until the feed confirms the exact event and its result. A confirmed cancellation voids the pick. A postponed game can stay open.'},
      {title:'Which games allow a draw pick?', text:'Eligible soccer games show a Draw option before kickoff. Draw picks settle on a confirmed full-time result.'},
      {title:'What do the pick statuses mean?', text:'Open means a result is pending. Won and Lost reflect the confirmed result. Void means the game was cancelled. Cancelled means you cancelled the pick before the game started.'},
    ],
  },
  {
    id:'live-data', title:'Live scores and data', link:{href:'/live',label:'Open Live'},
    articles:[
      {title:'How often do scores update?', text:'Scores refresh automatically while COWBOY is visible. The latest update time and any delays appear on the scoreboard. Coverage varies by sport.'},
      {title:'What happens if the game summary fails?', text:'Game Center can show the latest available scoreboard for that matchup while the detailed feed recovers. For matched hockey games, it can use backup scores from the NHL. The page labels the fallback and pauses picks when current game data is unavailable.'},
      {title:'Why are scores or games missing?', text:'Check the last update time and the league’s status. A delayed feed can show the last received data. Use Refresh sports or retry the affected league. Some sports supply a scoreboard without a play-by-play feed.'},
    ],
  },
  {
    id:'account', title:'Account and preferences', link:{href:'/preferences',label:'Open Preferences'},
    articles:[
      {title:'What follows me between browsers?', text:'Signed-in follows and saved picks are stored on the COWBOY server. Guest follows, schedule timezone, and update preferences are stored in this browser. Use a unique password.'},
      {title:'Where are the account controls?', text:'Open your signed-in account to download your data, sign out other sessions, or delete the account. Preferences also lets you choose the schedule timezone, followed-game updates, and quiet hours.'},
    ],
  },
] as const;

export function HelpCenter() {
  const [query,setQuery]=useState('');
  const search = useRef<HTMLInputElement>(null);
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const results = topics.map(topic=>({
    ...topic,articles:topic.articles.filter(article=>
      terms.every(term=>`${topic.title} ${article.title} ${article.text}`.toLowerCase().includes(term))
    ),
  })).filter(topic=>topic.articles.length);
  const matches = results.reduce((count,topic)=>count+topic.articles.length,0);

  return <div className="cw-help">
    <div className="cw-help-search">
      <label htmlFor="cw-help-query">Search help</label>
      <input ref={search} id="cw-help-query" type="search" value={query} onChange={event=>setQuery(event.target.value)}
        placeholder="Try locked picks or delayed scores"/>
      {terms.length > 0 && <p role="status">{matches === 0 ? 'No matching articles' : `${matches} matching ${matches===1?'article':'articles'}`}</p>}
    </div>
    {!terms.length && <nav aria-label="Help topics" className="cw-help-topics">
      {topics.map(topic=><a key={topic.id} href={`#${topic.id}`}>{topic.title}</a>)}
    </nav>}
    {matches===0 && <button className="cw-clear" onClick={()=>{setQuery('');search.current?.focus();}}>Clear search</button>}
    {results.map(topic=><section id={topic.id} key={topic.id} aria-labelledby={`cw-help-${topic.id}`} className="cw-help-topic">
      <h2 id={`cw-help-${topic.id}`}>{topic.title}</h2>
      {topic.articles.map(article=><article key={article.title}>
        <h3>{article.title}</h3>
        <p>{article.text}</p>
      </article>)}
      <a href={topic.link.href}>{topic.link.label} <span aria-hidden="true">→</span></a>
    </section>)}
  </div>;
}
