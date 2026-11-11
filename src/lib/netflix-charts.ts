import type { DoubanItem } from './types';
import { fetchUpstream, getCache, setCache } from './fetch-utils';
import type { NetflixSub } from './netflix-subs';

/**
 * Netflix 榜单。
 *
 * 官方榜：Netflix Tudum Top 10（https://www.netflix.com/tudum/top10），
 * 直接读国家页 SSR 出来的 10 张卡片（顺序即排名），标题从 logo 图的 alt 取；
 * 官方页不带 2:3 海报，用 JustWatch 搜索补图。
 *
 * 类型榜：官方 Top 10 只有 Films / TV（以及英语/非英语），没有动作、纪录片这些
 * 细分。细分榜用 JustWatch 的公开 GraphQL（provider=nfx + genre），按平台热度排序。
 *
 * 中文采集站基本只索引中文片名，所以每条同时取 JustWatch 的英文名（展示）和
 * 中文名（searchTitle，点卡片时实际搜索的关键词）。
 *
 * 结果缓存 1 小时。
 */

const CACHE_TTL = 60 * 60 * 1000;

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const TUDUM_BASE = 'https://www.netflix.com/tudum/top10';
const JW_GRAPHQL = 'https://apis.justwatch.com/graphql';

/** 官方榜默认看马来西亚（Netflix 的榜是分国家的） */
const TUDUM_COUNTRY = 'malaysia';

export { NETFLIX_SUBS, isNetflixSub } from './netflix-subs';
export type { NetflixSub } from './netflix-subs';

// —— 官方 Top 10 ——

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/**
 * 从 Tudum 国家页抓 10 个 title（顺序即排名）。
 * 页面里每张卡片的标题 logo 挂在 data-uia="top10-card-logo" 容器下，alt 是完整标题。
 */
async function fetchTudumTitles(kind: 'tv' | 'films'): Promise<string[]> {
  const res = await fetchUpstream(`${TUDUM_BASE}/${TUDUM_COUNTRY}/${kind}`, {
    timeoutMs: 15000,
    headers: { 'User-Agent': CHROME_UA, 'Accept-Language': 'en-US,en;q=0.9' },
  });
  if (!res.ok) throw new Error(`Netflix Top10 响应异常 (${res.status})`);
  const html = await res.text();
  const titles: string[] = [];
  const re = /data-uia="top10-card-logo"[^>]*>\s*<img[^>]*?alt="([^"]+)"/g;
  for (const m of html.matchAll(re)) {
    const title = decodeEntities(m[1]).trim();
    if (title && !titles.includes(title)) titles.push(title);
  }
  return titles.slice(0, 10);
}

// —— JustWatch（公开 GraphQL，无需登录/密钥） ——

interface JwContent {
  title?: string;
  originalReleaseYear?: number;
  posterUrl?: string;
}

interface JwEdge {
  node?: {
    id?: string;
    objectType?: string;
    content?: JwContent;
    zh?: { title?: string };
  };
}

async function jwQuery(filter: Record<string, unknown>, first: number): Promise<JwEdge[]> {
  const query =
    'query T($country: Country!, $language: Language!, $languageZh: Language!, $first: Int!, $filter: TitleFilter) {' +
    ' popularTitles(country: $country, first: $first, filter: $filter) {' +
    ' edges { node { id objectType' +
    ' content(country: $country, language: $language) { title originalReleaseYear posterUrl }' +
    ' zh: content(country: $country, language: $languageZh) { title }' +
    ' } } } }';
  const res = await fetchUpstream(JW_GRAPHQL, {
    timeoutMs: 9000,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': CHROME_UA,
      Accept: 'application/json',
    },
    body: JSON.stringify({
      query,
      variables: { country: 'MY', language: 'en', languageZh: 'zh', first, filter },
    }),
  });
  if (!res.ok) throw new Error(`JustWatch 响应异常 (${res.status})`);
  const json = (await res.json()) as { data?: { popularTitles?: { edges?: JwEdge[] } } };
  return json.data?.popularTitles?.edges ?? [];
}

/** JustWatch 的 posterUrl 是模板：/poster/<id>/{profile}/<slug>.{format} */
function renderPoster(posterUrl: string | undefined): string | undefined {
  if (!posterUrl) return undefined;
  if (/^https?:\/\//.test(posterUrl)) return posterUrl;
  return `https://images.justwatch.com${posterUrl.replace('{profile}', 's718').replace('{format}', 'jpg')}`;
}

/** 去掉 Netflix 的季/部后缀，中文源里搜不到带后缀的名字 */
function stripSeason(title: string): string {
  return title
    .replace(/:\s*(Limited Series|Season\s+\d+|Part\s+\d+|Volume\s+\d+|Chapter\s+\d+)\s*$/i, '')
    .replace(/\s*第[一二三四五六七八九十\d]+[季部]\s*$/, '')
    .trim();
}

/** 官方榜的标题在 JustWatch 里搜一次，拿海报 + 中文名 */
async function lookupMeta(title: string): Promise<{ poster?: string; zh?: string; year?: string }> {
  const candidates = [title, title.replace(/:\s*[^:]+$/, '')].filter(
    (t, i, arr) => t && arr.indexOf(t) === i
  );
  for (const candidate of candidates) {
    try {
      const edges = await jwQuery({ searchQuery: candidate, packages: ['nfx'] }, 1);
      const node = edges[0]?.node;
      const poster = renderPoster(node?.content?.posterUrl);
      if (poster) {
        const y = node?.content?.originalReleaseYear;
        return { poster, zh: node?.zh?.title, year: y ? String(y) : undefined };
      }
    } catch {
      /* 下一候选 */
    }
  }
  return {};
}

async function fetchOfficial(kind: 'tv' | 'films'): Promise<DoubanItem[]> {
  const titles = await fetchTudumTitles(kind);
  if (titles.length === 0) throw new Error('Netflix 官方榜解析失败');

  const metas = await Promise.all(titles.map((t) => lookupMeta(t)));
  return titles.map((title, i) => ({
    id: `nfx_${kind}_${i + 1}`,
    title,
    cover: metas[i]?.poster || '',
    year: metas[i]?.year,
    isTv: kind === 'tv',
    searchTitle: stripSeason(metas[i]?.zh || title),
  }));
}

async function fetchGenre(genre: string): Promise<DoubanItem[]> {
  const edges = await jwQuery({ packages: ['nfx'], genres: [genre], objectTypes: ['MOVIE'] }, 24);
  return edges
    .map((edge, i) => {
      const content = edge.node?.content;
      const title = content?.title;
      const cover = renderPoster(content?.posterUrl);
      if (!title || !cover) return undefined;
      return {
        id: edge.node?.id ? `jw_${edge.node.id}` : `jw_${genre}_${i}`,
        title,
        cover,
        year: content?.originalReleaseYear ? String(content.originalReleaseYear) : undefined,
        isTv: false,
        searchTitle: stripSeason(edge.node?.zh?.title || title),
      } as DoubanItem;
    })
    .filter((item): item is DoubanItem => item !== undefined);
}

export async function fetchNetflixChart(sub: NetflixSub): Promise<DoubanItem[]> {
  const cacheKey = `netflix:${sub}`;
  const cached = getCache<DoubanItem[]>(cacheKey);
  if (cached) return cached;

  let items: DoubanItem[];
  if (sub === 'official_tv') items = await fetchOfficial('tv');
  else if (sub === 'official_films') items = await fetchOfficial('films');
  else items = await fetchGenre(sub);

  if (items.length === 0) throw new Error('榜单数据为空');
  setCache(cacheKey, items, CACHE_TTL);
  return items;
}
