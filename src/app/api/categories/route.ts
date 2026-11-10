import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { checkUpstreamAllowed } from '@/lib/ssrf';
import { fetchUpstreamJson } from '@/lib/fetch-utils';
import { cmsRequestHeaders } from '@/lib/cms-parser';

export const runtime = 'nodejs';

interface RawClass {
  type_id?: unknown;
  type_name?: unknown;
}

interface CacheEntry {
  at: number;
  classes: { id: string; name: string }[];
}

/** 分类列表变化很慢，按源缓存 6 小时；新加的源第一次访问就会现拉，无需改代码 */
const CACHE_TTL = 6 * 60 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

function parseClasses(data: unknown): { id: string; name: string }[] {
  const cls = (data as { class?: unknown } | null)?.class;
  if (!Array.isArray(cls)) return [];
  return cls
    .map((item) => {
      const c = item as RawClass;
      return { id: String(c.type_id ?? ''), name: String(c.type_name ?? '') };
    })
    .filter((c) => c.id && c.name);
}

/**
 * 读取一个苹果CMS源的分类树。
 * 优先 ac=list（最轻）；部分源只在 videolist 响应里带 class，做一次回退。
 */
async function fetchClasses(base: string) {
  const headers = cmsRequestHeaders();
  try {
    const data = await fetchUpstreamJson<unknown>(`${base}?ac=list`, { timeoutMs: 10000, headers });
    const classes = parseClasses(data);
    if (classes.length) return classes;
  } catch {
    /* 回退到 videolist */
  }
  const data = await fetchUpstreamJson<unknown>(`${base}?ac=videolist&pg=1`, { timeoutMs: 12000, headers });
  return parseClasses(data);
}

export async function GET(req: Request) {
  const guarded = await guardRequest(req);
  if (guarded) return guarded;

  const raw = new URL(req.url).searchParams.get('url') || '';
  const base = raw.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(base)) {
    return NextResponse.json({ error: '无效的源地址' }, { status: 400 });
  }
  const verdict = await checkUpstreamAllowed(base);
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.reason }, { status: 400 });
  }

  const hit = cache.get(base);
  if (hit && Date.now() - hit.at < CACHE_TTL) {
    return NextResponse.json({ classes: hit.classes, cached: true });
  }

  try {
    const classes = await fetchClasses(base);
    cache.set(base, { at: Date.now(), classes });
    return NextResponse.json({ classes });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '获取分类失败' },
      { status: 502 }
    );
  }
}
