import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { checkUpstreamAllowed } from '@/lib/ssrf';
import { fetchUpstreamJson } from '@/lib/fetch-utils';
import { cmsRequestHeaders } from '@/lib/cms-parser';

export const runtime = 'nodejs';

export interface BrowseItem {
  vodId: string;
  name: string;
  pic?: string;
  remarks?: string;
  year?: string;
  typeName?: string;
}

interface RawVod {
  vod_id?: unknown;
  vod_name?: unknown;
  vod_pic?: unknown;
  vod_remarks?: unknown;
  vod_year?: unknown;
  type_name?: unknown;
}

function parseList(data: unknown): BrowseItem[] {
  const list = (data as { list?: unknown } | null)?.list;
  if (!Array.isArray(list)) return [];
  return list
    .map((row) => {
      const v = row as RawVod;
      return {
        vodId: String(v.vod_id ?? ''),
        name: String(v.vod_name ?? ''),
        pic: typeof v.vod_pic === 'string' ? v.vod_pic : undefined,
        remarks: typeof v.vod_remarks === 'string' ? v.vod_remarks : undefined,
        year: typeof v.vod_year === 'string' ? v.vod_year : undefined,
        typeName: typeof v.type_name === 'string' ? v.type_name : undefined,
      };
    })
    .filter((i) => i.vodId && i.name);
}

/** 按分类浏览：AppleCMS 的 ?ac=videolist&t=<type_id>&pg=<page> */
export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  const sp = new URL(req.url).searchParams;
  const base = (sp.get('url') || '').trim().replace(/\/+$/, '');
  const t = (sp.get('t') || '').trim();
  const all = t === '' || t === 'all';
  const pg = Math.max(1, Math.min(500, parseInt(sp.get('pg') || '1', 10) || 1));

  if (!/^https?:\/\//.test(base)) {
    return NextResponse.json({ error: '无效的源地址' }, { status: 400 });
  }
  if (!all && !/^\d+$/.test(t)) {
    return NextResponse.json({ error: '无效的分类 id' }, { status: 400 });
  }
  const verdict = await checkUpstreamAllowed(base);
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.reason }, { status: 400 });
  }

  try {
    // t 缺省 = 该源的全部内容（苹果CMS 不带 t 就是全库列表）
    const upstream = all
      ? `${base}?ac=videolist&pg=${pg}`
      : `${base}?ac=videolist&t=${encodeURIComponent(t)}&pg=${pg}`;
    const data = await fetchUpstreamJson<Record<string, unknown>>(upstream, {
      timeoutMs: 12000,
      headers: cmsRequestHeaders(),
    });
    const items = parseList(data);
    const pagecount = Math.max(1, Math.min(500, Number(data.pagecount) || 1));
    const total = Number(data.total) || items.length;
    return NextResponse.json({ items, page: pg, pagecount, total });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '加载失败' },
      { status: 502 }
    );
  }
}
