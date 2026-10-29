export interface EpisodeListItem { id: string; title: string; count: number }

export function EpisodeList({ episodes, activeId, onSelect }: { episodes: readonly EpisodeListItem[]; activeId: string; onSelect: (id: string) => void }) {
  return <nav className="avs-episode-list" aria-label="分集">{episodes.map(episode => <button key={episode.id} type="button" aria-current={episode.id === activeId ? "page" : undefined} onClick={() => onSelect(episode.id)}>
    <span>{episode.title}</span><small>{episode.count} 个镜头</small>
  </button>)}</nav>;
}
