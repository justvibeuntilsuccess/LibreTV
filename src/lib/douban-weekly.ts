import type { DoubanItem } from './types';
import { fetchUpstream, getCache, setCache } from './fetch-utils';
import { fetchNetflixChart, isNetflixSub } from './netflix-charts';

/**
 * 影视热榜聚合。
 *
 * 两条数据路径：
 * 1) 豆瓣 rexxar 移动端接口（m.douban.com，需 iPhone UA + Referer）——直连，可指定条数，
 *    覆盖豆瓣的周榜/正在上映/最新/分类剧集/Top250 等 collection；
 * 2) 60s API（免 key）——百度电视剧榜；另外五个豆瓣周榜在直连失败时也回退到它。
 *
 * 结果统一缓存 1 小时，避免把豆瓣打限流。
 */

const CACHE_TTL = 60 * 60 * 1000;
const UA = 'LibreTV (+https://github.com/LibreSpark/LibreTV)';

const FALLBACK_BASE = 'https://60s.viki.moe';

function apiBase(): string {
  return (process.env['60S_API_BASE'] || 'https://60s.crystelf.top').replace(/\/+$/, '');
}

/** 榜单标识：豆瓣周榜/上映/分类榜 + 百度热播剧 */
export const HOT_LIST_IDS = [
  'douban_movie_weekly',
  'douban_tv_chinese',
  'douban_tv_global',
  'douban_show_chinese',
  'douban_show_global',
  'baidu_teleplay',
  'tvb_cantonese',
  'netflix',
  'documentary',
  'movie_showing',
  'movie_latest',
  'tv_american',
  'tv_korean',
  'tv_japanese',
  'tv_animation',
  'movie_top250',
] as const;

export type HotListId = (typeof HOT_LIST_IDS)[number];

export function isHotListId(id: string): id is HotListId {
  return (HOT_LIST_IDS as readonly string[]).includes(id);
}

const DOUBAN_BASE_URL = 'https://m.douban.com/rexxar/api/v2/subject_collection';
const DOUBAN_REFERER = 'https://m.douban.com/subject_collection';
const DOUBAN_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

/** 直连豆瓣的 collection 映射；isTv 决定卡片点击后按剧集还是电影搜索 */
const DIRECT_COLLECTIONS: Record<string, { collection: string; isTv: boolean }> = {
  douban_movie_weekly: { collection: 'movie_weekly_best', isTv: false },
  douban_tv_chinese: { collection: 'tv_chinese_best_weekly', isTv: true },
  douban_tv_global: { collection: 'tv_global_best_weekly', isTv: true },
  douban_show_chinese: { collection: 'show_chinese_best_weekly', isTv: true },
  douban_show_global: { collection: 'show_global_best_weekly', isTv: true },
  movie_showing: { collection: 'movie_showing', isTv: false },
  movie_latest: { collection: 'movie_latest', isTv: false },
  tv_american: { collection: 'tv_american', isTv: true },
  tv_korean: { collection: 'tv_korean', isTv: true },
  tv_japanese: { collection: 'tv_japanese', isTv: true },
  tv_animation: { collection: 'tv_animation', isTv: true },
  movie_top250: { collection: 'movie_top250', isTv: false },
};

/** 五个周榜在 60s 上对应的分类，仅作为直连失败时的兜底 */
const SIXTY_WEEKLY_CATEGORY: Partial<Record<HotListId, string>> = {
  douban_movie_weekly: 'movie',
  douban_tv_chinese: 'tv_chinese',
  douban_tv_global: 'tv_global',
  douban_show_chinese: 'show_chinese',
  douban_show_global: 'show_global',
};

/** 每张榜单最多取多少条 */
const DIRECT_COUNT = 20;

// —— 60s API 原始结构（只取用到的字段） ——

interface DoubanWeeklyRaw {
  id?: number | string;
  title?: string;
  year?: number | string;
  rating?: number;
  cover_proxy?: string;
  cover?: string;
}

interface BaiduTeleplayRaw {
  title?: string;
  cover?: string | null;
}

interface SixtyResponse<T> {
  code?: number;
  data?: T;
}

// —— 豆瓣 rexxar 原始结构（不同 collection 字段不完全一致） ——

interface DoubanCover {
  url?: string;
}

interface DoubanPic {
  large?: string;
  normal?: string;
}

interface DoubanDirectRaw {
  id?: number | string;
  title?: string;
  year?: number | string;
  rating?: number | { value?: number } | null;
  cover_url?: string | null;
  cover?: string | DoubanCover | null;
  pic?: string | DoubanPic | null;
}

function pickCover(raw: DoubanDirectRaw): string | undefined {
  const candidates: unknown[] = [
    raw.cover_url,
    typeof raw.cover === 'string' ? raw.cover : raw.cover?.url,
    typeof raw.pic === 'string' ? raw.pic : raw.pic?.large,
    typeof raw.pic === 'object' && raw.pic ? raw.pic.normal : undefined,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && /^https?:\/\//.test(c)) return c;
  }
  return undefined;
}

function pickRating(raw: DoubanDirectRaw): number | undefined {
  const value = typeof raw.rating === 'number' ? raw.rating : raw.rating?.value;
  return typeof value === 'number' && value > 0 ? value : undefined;
}

/** 豆瓣直连条目 → DoubanItem；缺标题或封面的脏数据丢弃 */
export function doubanDirectToItem(raw: DoubanDirectRaw, isTv: boolean): DoubanItem | undefined {
  const cover = pickCover(raw);
  if (!raw.id || !raw.title || !cover) return undefined;
  const rating = pickRating(raw);
  return {
    id: String(raw.id),
    title: raw.title,
    cover,
    rating: rating ? String(rating) : undefined,
    year: raw.year ? String(raw.year) : undefined,
    isTv,
  };
}

/** 豆瓣周榜（60s 版）条目 → DoubanItem；缺标题或封面的脏数据丢弃 */
export function doubanWeeklyToItem(raw: DoubanWeeklyRaw, isTv: boolean): DoubanItem | undefined {
  // 原生 cover 是 img*.doubanio.com，命中图片代理的豆瓣白名单并带 Referer 伪装，
  // 可稳定加载；cover_proxy（doubanio.viki.moe 公共镜像）限流严重，仅作兜底
  const cover = raw.cover || raw.cover_proxy;
  if (!raw.id || !raw.title || !cover) return undefined;
  return {
    id: String(raw.id),
    title: raw.title,
    cover,
    rating: raw.rating && raw.rating > 0 ? String(raw.rating) : undefined,
    year: raw.year ? String(raw.year) : undefined,
    isTv,
  };
}

/** 百度热播剧条目 → DoubanItem；无评分，海报为空的条目丢弃 */
export function baiduTeleplayToItem(raw: BaiduTeleplayRaw, index: number): DoubanItem | undefined {
  if (!raw.title || !raw.cover) return undefined;
  return {
    // 百度榜无稳定 id，用榜单内序号保证 React key 唯一
    id: `baidu_${index}`,
    title: raw.title,
    cover: raw.cover,
    isTv: true,
  };
}

function assertArray<T>(value: unknown, what: string): T[] {
  if (!Array.isArray(value)) throw new Error(`${what}数据异常`);
  return value as T[];
}

async function fetchJson(path: string): Promise<unknown> {
  const primary = apiBase();
  // 主实例失败（限流/宕机/网络不通）时回退官方实例；两者相同则只试一次
  const bases = primary === FALLBACK_BASE ? [primary] : [primary, FALLBACK_BASE];

  let lastError: unknown;
  for (const base of bases) {
    try {
      const res = await fetchUpstream(`${base}${path}`, {
        timeoutMs: 8000,
        headers: { 'User-Agent': UA, Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`60s API 响应异常 (${res.status})`);
      return await res.json();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('60s API 请求失败');
}

/** 直连豆瓣 rexxar：一次取 DIRECT_COUNT 条 */
async function fetchDoubanCollection(collection: string): Promise<DoubanDirectRaw[]> {
  const url = `${DOUBAN_BASE_URL}/${collection}/items?start=0&count=${DIRECT_COUNT}&items_only=1&for_mobile=1`;
  const res = await fetchUpstream(url, {
    timeoutMs: 9000,
    headers: {
      'User-Agent': DOUBAN_UA,
      Referer: `${DOUBAN_REFERER}/${collection}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`豆瓣榜单响应异常 (${res.status})`);
  const json = (await res.json()) as { subject_collection_items?: unknown };
  return assertArray<DoubanDirectRaw>(json.subject_collection_items, '豆瓣榜单');
}

const DOUBAN_TV_RECOMMEND = 'https://m.douban.com/rexxar/api/v2/tv/recommend';

/**
 * 豆瓣「选剧/选电影」接口：按标签 + 排序取条目。
 * sort: T 综合 / U 近期热度 / R 首播时间 / S 高分优先
 */
async function fetchDoubanRecommend(
  kind: 'tv' | 'movie',
  tags: string,
  sort: 'T' | 'U' | 'R' | 'S',
  count: number
): Promise<DoubanDirectRaw[]> {
  const url = `${DOUBAN_TV_RECOMMEND.replace('/tv/recommend', `/${kind}/recommend`)}?tags=${encodeURIComponent(tags)}&sort=${sort}&start=0&count=${count}`;
  const res = await fetchUpstream(url, {
    timeoutMs: 9000,
    headers: {
      'User-Agent': DOUBAN_UA,
      Referer: `https://m.douban.com/${kind}/`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`豆瓣${kind === 'tv' ? '剧集' : '电影'}榜响应异常 (${res.status})`);
  const json = (await res.json()) as { items?: unknown };
  return assertArray<DoubanDirectRaw>(json.items, '豆瓣推荐榜');
}

/**
 * TVB 粤语剧：豆瓣没有「TVB 周榜」，用剧集选剧接口按「港剧」+「TVB」两个标签、
 * 以首播时间排序，合并去重。港剧基本是粤语制作，TVB 标签负责补齐纯 TVB 条目。
 */
async function fetchTvbCantonese(): Promise<DoubanItem[]> {
  const [hk, tvb] = await Promise.all([
    fetchDoubanRecommend('tv', '港剧', 'R', DIRECT_COUNT).catch(() => []),
    fetchDoubanRecommend('tv', 'TVB', 'R', DIRECT_COUNT).catch(() => []),
  ]);

  const seen = new Set<string>();
  const items: DoubanItem[] = [];
  for (const raw of [...hk, ...tvb]) {
    const item = doubanDirectToItem(raw, true);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
    if (items.length >= 24) break;
  }
  return items;
}

/**
 * 纪录片：豆瓣没有单独的纪录片榜，用剧集入口的「纪录片」标签，
 * 近期热度 + 高分优先两组合并去重（新的在前，经典在后）。
 */
async function fetchDocumentary(): Promise<DoubanItem[]> {
  const [hot, top] = await Promise.all([
    fetchDoubanRecommend('tv', '纪录片', 'U', DIRECT_COUNT).catch(() => []),
    fetchDoubanRecommend('tv', '纪录片', 'S', DIRECT_COUNT).catch(() => []),
  ]);

  const seen = new Set<string>();
  const items: DoubanItem[] = [];
  for (const raw of [...hot, ...top]) {
    const item = doubanDirectToItem(raw, true);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
    if (items.length >= 24) break;
  }
  return items;
}

export async function fetchHotList(id: HotListId, sub?: string): Promise<DoubanItem[]> {
  const cacheKey = `hot-list:${id}:${sub ?? ''}`;
  const cached = getCache<DoubanItem[]>(cacheKey);
  if (cached) return cached;

  let items: DoubanItem[] = [];

  // 0) 特殊榜单：豆瓣没有现成的 TVB / Netflix 榜，用标签接口拼
  if (id === 'tvb_cantonese') {
    items = await fetchTvbCantonese();
  } else if (id === 'netflix') {
    items = await fetchNetflixChart(isNetflixSub(sub ?? '') ? (sub as never) : 'official_tv');
  } else if (id === 'documentary') {
    items = await fetchDocumentary();
  }

  // 1) 优先直连豆瓣：条数更多（20 条），分类也更全
  const direct = DIRECT_COLLECTIONS[id];
  if (items.length === 0 && direct) {
    try {
      items = (await fetchDoubanCollection(direct.collection))
        .map((entry) => doubanDirectToItem(entry, direct.isTv))
        .filter((item): item is DoubanItem => item !== undefined);
    } catch {
      items = [];
    }
  }

  // 2) 直连失败时，原来有 60s 对应分类的周榜回退到 60s
  const category = SIXTY_WEEKLY_CATEGORY[id];
  if (items.length === 0 && category) {
    const raw = (await fetchJson(`/v2/douban/weekly/${category}`)) as SixtyResponse<DoubanWeeklyRaw[]>;
    const isTv = id !== 'douban_movie_weekly';
    items = assertArray<DoubanWeeklyRaw>(raw.data, '豆瓣周榜')
      .map((entry) => doubanWeeklyToItem(entry, isTv))
      .filter((item): item is DoubanItem => item !== undefined);
  }

  // 3) 百度电视剧榜只走 60s
  if (items.length === 0 && id === 'baidu_teleplay') {
    const raw = (await fetchJson('/v2/baidu/teleplay')) as SixtyResponse<BaiduTeleplayRaw[]>;
    items = assertArray<BaiduTeleplayRaw>(raw.data, '百度热播剧榜')
      .map((entry, i) => baiduTeleplayToItem(entry, i))
      .filter((item): item is DoubanItem => item !== undefined);
  }

  if (items.length === 0) throw new Error('榜单数据为空');

  setCache(cacheKey, items, CACHE_TTL);
  return items;
}
