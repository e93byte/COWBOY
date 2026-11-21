import CompetitionDirectory from '../components/CompetitionDirectory';
import '../live.css';

export const metadata = {title:'Discover sports | COWBOY'};

export default function DiscoverPage() {
  return <div className="cowboy-live cw-discover">
    <header className="cw-header">
      <a className="cw-brand" href="/"><img src="/cowboy-mark.webp" alt=""/><span>COWBOY</span></a>
    </header>
    <main className="cw-discover-main">
      <h1>Discover competitions</h1>
      <CompetitionDirectory/>
    </main>
  </div>;
}
