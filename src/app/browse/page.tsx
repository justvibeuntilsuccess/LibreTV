'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/header';
import { SmartImage } from '@/components/smart-image';
import { useAppStore } from '@/lib/store';
import { isAdultContent } from '@/lib/cms-parser';
import { buildWatchUrl } from '@/lib/utils';

interface Cat {
  id: string;
  name: string;
}

interface Item {
  vodId: string;
  name: string;
  pic?: string;
  remarks?: string;
  year?: string;
  typeName?: string;
}

export default function BrowsePage() {
  const envSources = useAppStore((s) => s.envSources);
  const customAPIs = useAppStore((s) => s.customAPIs);
  const adultMode = useAppStore((s) => s.adultMode);
  const imageMode = useAppStore((s) => s.imageProxyMode);
  const customProxy = useAppStore((s) => s.customImageProxy);

  const sources = useMemo(() => {
    const all = [...envSources, ...customAPIs].filter((s) => s.url);
    if (adultMode === 'exclude') return all.filter((s) => !s.isAdult);
    if (adultMode === 'only') return all.filter((s) => s.isAdult);
    return all;
  }, [envSources, customAPIs, adultMode]);

  const [sourceKey, setSourceKey] = useState('');
  const source = sources.find((s) => s.key === sourceKey) || sources[0];

  const [cats, setCats] = useState<Cat[]>([]);
  const [cat, setCat] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [page, setPage] = useState(1);
  const [pagecount, setPagecount] = useState(1);
  const [loadingCats, setLoadingCats] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 从 URL 恢复上次的「资源 / 分类 / 页码」，这样从播放页返回不会被重置
  const [ready, setReady] = useState(false);
  const pendingCat = useRef<string | null>(null);
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('source')) setSourceKey(sp.get('source') as string);
    if (sp.get('t')) pendingCat.current = sp.get('t');
    const p = parseInt(sp.get('pg') || '1', 10);
    if (p > 1) setPage(p);
    setReady(true);
  }, []);

  // 源列表就绪后，给一个真实存在的 key（首次进入时 URL 里可能没有）
  useEffect(() => {
    if (!ready || !sources.length) return;
    if (!sources.some((s) => s.key === sourceKey)) setSourceKey(sources[0].key);
  }, [ready, sources, sourceKey]);

  // 地址栏跟着状态走：浏览器「返回」时能原样恢复
  useEffect(() => {
    if (!ready || !source || !cat) return;
    const qs = new URLSearchParams({ source: source.key, t: cat });
    if (page > 1) qs.set('pg', String(page));
    window.history.replaceState(null, '', `/browse?${qs.toString()}`);
  }, [ready, source, cat, page]);

  // 换源 → 重新拉分类（分类永远来自源的 ac=list，新源无需改代码）
  useEffect(() => {
    if (!ready || !source) return;
    let cancelled = false;
    setCats([]);
    setCat('');
    setItems([]);
    setError('');
    setLoadingCats(true);
    (async () => {
      try {
        const res = await fetch(`/api/categories?url=${encodeURIComponent(source.url)}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error || '分类加载失败');
        let list: Cat[] = Array.isArray(data.classes) ? data.classes : [];
        if (adultMode === 'exclude') list = list.filter((c) => !isAdultContent(c.name));
        if (adultMode === 'only') list = list.filter((c) => isAdultContent(c.name));
        // 「全部」永远排在最前：不带 t 参数就是该源的全库列表
        list = [{ id: 'all', name: '全部' }, ...list];
        setCats(list);
        if (list[0]) {
          // 优先恢复 URL 里的分类，否则默认「全部」
          const want = pendingCat.current;
          pendingCat.current = null;
          setCat(want && list.some((c) => c.id === want) ? want : list[0].id);
        } else setError('这个源没有返回分类');
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '分类加载失败');
      } finally {
        if (!cancelled) setLoadingCats(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, source?.url, adultMode]);

  // 换分类或翻页 → 拉列表
  useEffect(() => {
    if (!ready || !source || !cat) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    (async () => {
      try {
        const res = await fetch(
          `/api/browse?url=${encodeURIComponent(source.url)}&t=${encodeURIComponent(cat)}&pg=${page}`
        );
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error || '加载失败');
        let list: Item[] = Array.isArray(data.items) ? data.items : [];
        // 「全部」会把伦理片等分类也带进来，这里按成人模式再过一遍
        if (adultMode === 'exclude') list = list.filter((it) => !isAdultContent(it.typeName));
        if (adultMode === 'only') list = list.filter((it) => isAdultContent(it.typeName));
        setItems(list);
        setPagecount(Math.max(1, Number(data.pagecount) || 1));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载失败');
          setItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, source?.url, cat, page, adultMode]);

  const pickCat = (id: string) => {
    setCat(id);
    setPage(1);
  };

  // 选中的分类在横向滚动条里可能看不见（比如恢复「香港剧」），自动滚到中间
  const chipsRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!cat) return;
    const el = chipsRef.current?.querySelector<HTMLElement>(`[data-cat="${cat}"]`);
    el?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [cat]);

  return (
    <>
      <Header />
      <main className="relative flex-1 max-w-6xl w-full mx-auto px-4 py-6">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <h1 className="text-lg font-semibold">分类浏览</h1>
          <select
            aria-label="选择资源"
            value={source?.key || ''}
            onChange={(e) => {
              setSourceKey(e.target.value);
              setPage(1);
            }}
            className="ml-auto bg-surface border border-line rounded-lg px-3 py-2 text-sm max-w-[16rem]"
          >
            {sources.map((s) => (
              <option key={s.key} value={s.key}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div ref={chipsRef} className="flex gap-2 overflow-x-auto pb-3 mb-4 -mx-1 px-1">
          {loadingCats && <span className="text-sm text-faint">正在读取分类…</span>}
          {cats.map((c) => (
            <button
              key={c.id}
              data-cat={c.id}
              onClick={() => pickCat(c.id)}
              className={`whitespace-nowrap text-sm px-3 py-1.5 rounded-full border transition-colors ${
                cat === c.id
                  ? 'bg-accent text-on-accent border-accent'
                  : 'bg-surface border-line hover:border-accent/60'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>

        {error && <p className="text-sm text-amber-500 mb-4">{error}</p>}

        {loading ? (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="aspect-[2/3] rounded-lg bg-chip" />
                <div className="h-3 mt-2 rounded bg-chip" />
              </div>
            ))}
          </div>
        ) : items.length ? (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-4">
            {items.map((it) => (
              <Link
                key={`${it.vodId}-${it.name}`}
                href={buildWatchUrl({
                  sourceKey: source!.key,
                  vodId: it.vodId,
                  title: it.name,
                  sourceUrl: source!.url,
                  detail: source!.detail,
                })}
                className="group"
              >
                <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-chip">
                  {it.pic ? (
                    <SmartImage
                      url={it.pic}
                      mode={imageMode}
                      customProxy={customProxy}
                      alt={it.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs text-faint px-2 text-center">
                      {it.name}
                    </div>
                  )}
                  {it.remarks && (
                    <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[11px] px-2 py-1 truncate">
                      {it.remarks}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm leading-snug line-clamp-2">{it.name}</p>
                <p className="text-xs text-faint truncate">
                  {[it.year, it.typeName].filter(Boolean).join(' · ')}
                </p>
              </Link>
            ))}
          </div>
        ) : (
          !error && <p className="text-sm text-faint">这个分类暂时没有内容。</p>
        )}

        {pagecount > 1 && (
          <div className="flex items-center justify-center gap-3 mt-8">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 text-sm rounded-lg border border-line disabled:opacity-40"
            >
              上一页
            </button>
            <span className="text-sm text-faint">
              {page} / {pagecount}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(pagecount, p + 1))}
              disabled={page >= pagecount}
              className="px-3 py-1.5 text-sm rounded-lg border border-line disabled:opacity-40"
            >
              下一页
            </button>
          </div>
        )}
      </main>
    </>
  );
}
