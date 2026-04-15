// Simple ranking utility: sorts artisans by rating desc and returns top N
export function rankArtisans(artisans = [], top = 10) {
  return (artisans || [])
    .slice()
    .sort((a, b) => (b.rating || 0) - (a.rating || 0))
    .slice(0, top);
}
