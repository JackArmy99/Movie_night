// The Dutch streaming services TMDB (JustWatch) knows about, cached a week.
import { getJson, setJson } from "./settings";
import { dutchServices, hasTmdb, Provider } from "./tmdb";

// The big Dutch services first; TMDB lists dozens of small ones.
export const POPULAR = [8, 119, 337, 72, 1899, 350, 71, 1773, 2, 3];

export async function serviceList(): Promise<Provider[]> {
  const cached = await getJson<{ at: number; list: Provider[] } | null>("services_list", null);
  let list = cached?.list ?? [];
  if (hasTmdb() && (!cached || Date.now() - cached.at > 7 * 864e5)) {
    try {
      list = await dutchServices();
      await setJson("services_list", { at: Date.now(), list });
    } catch {
      /* keep the cached list */
    }
  }
  const rank = (p: Provider) => {
    const i = POPULAR.indexOf(p.id);
    return i < 0 ? 99 : i;
  };
  return [...list].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}
