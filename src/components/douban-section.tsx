'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { DoubanItem } from '@/lib/types';
import { NETFLIX_SUBS } from '@/lib/netflix-subs';
import { DoubanCard, FeaturedDoubanCard } from './video-card';

const MOVIE_TAGS = ['热门', '最新', '经典', '豆瓣高分', '冷门佳片', '华语', '欧美', '韩国', '日本', '动画'];
const TV_TAGS = ['热门', '美剧', '英剧', '韩剧', '日剧', '国产剧', '港剧', '日本动画', '综艺', '纪录片'];
const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/** 首页推荐区：数据源由设置决定（豆瓣热门 / Bangumi 新番放送 / 影视热榜），二选一展示 */
export function RecommendSection({ onPick }: { onPick: (title: string) => void }) {
  const doubanEnabled = useAppStore((s) => s.doubanEnabled);
  const recommendSource = useAppStore((s) => s.recommendSource);

  if (!doubanEnabled) return null;
  if (recommendSource === 'bangumi') return <BangumiView onPick={onPick} />;
  if (recommendSource === 'hot-list') return <HotListView onPick={onPick} />;
  return <DoubanView onPick={onPick} />;
}

/**
 * 豆瓣推荐：影视切换 + 标签筛选。
 * 一次性渲染全部条目：数据本就一次拉全（50 条），卡片图片又是 lazy 加载，
 * 视口外的图不会请求，因此不需要「加载更多」这类本地切片分页来打断浏览。
 */
function DoubanView({ onPick }: { onPick: (title: string) => void }) {
  const [type, setType] = useState<'movie' | 'tv'>('movie');
  const [tag, setTag] = useState('热门');

  const query = useQuery({
    queryKey: ['douban', type, tag],
    queryFn: ({ signal }) => api.douban(type, tag, 0, 50, signal),
  });

  const tags = type === 'movie' ? MOVIE_TAGS : TV_TAGS;
  const items = query.data?.items ?? [];

  const switchType = (t: 'movie' | 'tv') => {
    if (t === type) return;
    setType(t);
    setTag('热门');
  };

  return (
    <section aria-label="影视推荐">
      <header className="mb-5">
        <p className="mb-1 text-[11px] font-semibold tracking-[.18em] text-accent uppercase">精选片单</p>
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-[-.03em] text-content">现在值得一看</h2>
        <p className="mt-1 text-sm text-muted">从热门新片到口碑佳作，为你发现精彩内容。</p>
      </header>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="glass-controls flex rounded-full p-1">
            <TypeButton active={type === 'movie'} onClick={() => switchType('movie')}>
              电影
            </TypeButton>
            <TypeButton active={type === 'tv'} onClick={() => switchType('tv')}>
              剧集
            </TypeButton>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-4">
        {tags.map((t) => (
          <button
            key={t}
            className={cn(
              'px-3 py-1.5 rounded-full text-xs transition-colors',
              t === tag ? 'bg-accent text-on-accent shadow-lg shadow-accent/20' : 'glass-chip text-muted hover:text-content'
            )}
            onClick={() => setTag(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {query.isError ? (
        <p className="text-center text-sm text-faint py-8">推荐内容加载失败，可稍后重试或在设置中关闭</p>
      ) : query.isLoading ? (
        <GridSkeleton />
      ) : items.length === 0 ? (
        <p className="text-center text-sm text-faint py-8">该分类暂无推荐内容</p>
      ) : <RecommendationShelf items={items} onPick={onPick} />}
    </section>
  );
}

/** Bangumi 每日放送：星期筛选，一次拉全量无分页 */
function BangumiView({ onPick }: { onPick: (title: string) => void }) {
  const [weekday, setWeekday] = useState<number | 'all'>('all');

  const query = useQuery({
    queryKey: ['bangumi-calendar'],
    queryFn: ({ signal }) => api.bangumiCalendar(signal),
  });

  let items: DoubanItem[] = [];
  if (query.data) {
    items = weekday === 'all'
      ? query.data.days.flatMap((d) => d.items)
      : (query.data.days.find((d) => d.weekday === weekday)?.items ?? []);
  }

  return (
    <section aria-label="新番放送推荐">
      <header className="mb-5">
        <p className="mb-1 text-[11px] font-semibold tracking-[.18em] text-accent uppercase">今日放送</p>
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-[-.03em] text-content">新番日历</h2>
      </header>
      <div className="flex flex-wrap gap-1.5 mb-4">
        <ChipButton active={weekday === 'all'} onClick={() => setWeekday('all')}>
          全部
        </ChipButton>
        {WEEKDAYS.map((name, i) => (
          <ChipButton key={name} active={weekday === i + 1} onClick={() => setWeekday(i + 1)}>
            {name}
          </ChipButton>
        ))}
      </div>

      {query.isError ? (
        <p className="text-center text-sm text-faint py-8">推荐内容加载失败，可稍后重试或在设置中关闭</p>
      ) : query.isLoading ? (
        <GridSkeleton />
      ) : <RecommendationShelf items={items} onPick={onPick} />}
    </section>
  );
}

const HOT_LISTS = [
  { id: 'netflix', label: 'Netflix' },
  { id: 'documentary', label: '纪录片' },
];

/** 影视热榜：chips 切换；Netflix 额外带一排细分（官方 Top10 / 类型） */
function HotListView({ onPick }: { onPick: (title: string) => void }) {
  const [listId, setListId] = useState(HOT_LISTS[0].id);
  const [subId, setSubId] = useState<string>('official_tv');
  const sub = listId === 'netflix' ? subId : undefined;

  const query = useQuery({
    queryKey: ['hot-list', listId, sub],
    queryFn: ({ signal }) => api.hotList(listId, sub, signal),
  });

  const items = query.data?.items ?? [];

  return (
    <section aria-label="影视榜单推荐">
      <header className="mb-5">
        <p className="mb-1 text-[11px] font-semibold tracking-[.18em] text-accent uppercase">热度榜单</p>
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-[-.03em] text-content">全站正在热播</h2>
      </header>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {HOT_LISTS.map((l) => (
          <ChipButton key={l.id} active={listId === l.id} onClick={() => setListId(l.id)}>
            {l.label}
          </ChipButton>
        ))}
      </div>

      {listId === 'netflix' && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {NETFLIX_SUBS.map((s) => (
            <ChipButton key={s.id} active={subId === s.id} onClick={() => setSubId(s.id)}>
              {s.label}
            </ChipButton>
          ))}
        </div>
      )}

      {query.isError ? (
        <p className="text-center text-sm text-faint py-8">推荐内容加载失败，可稍后重试或在设置中关闭</p>
      ) : query.isLoading ? (
        <GridSkeleton />
      ) : <RecommendationShelf items={items} onPick={onPick} />}
    </section>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2.5">
      {Array.from({ length: 16 }).map((_, i) => (
        <div key={i}>
          <div className="aspect-[2/3] rounded-lg bg-chip animate-pulse" />
          <div className="h-3 mt-2 rounded bg-chip animate-pulse" />
        </div>
      ))}
    </div>
  );
}

function RecommendationShelf({
  items,
  onPick,
}: {
  items: DoubanItem[];
  onPick: (title: string) => void;
}) {
  if (items.length === 0) return <p className="py-10 text-center text-sm text-faint">暂无推荐内容</p>;
  const [featured, ...rest] = items;
  return (
    <>
      <FeaturedDoubanCard
        item={featured}
        onClick={() => onPick(featured.searchTitle || featured.title)}
      />
      {rest.length > 0 && (
        <div className="recommendation-rail glass-shelf flex gap-4 overflow-x-auto pb-5 scrollbar-thin snap-x snap-mandatory">
          {rest.map((item) => (
            <div key={item.id} className="w-[126px] sm:w-[154px] lg:w-[170px] shrink-0 snap-start">
              <DoubanCard item={item} onClick={() => onPick(item.searchTitle || item.title)} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function ChipButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className={cn(
        'px-3 py-1.5 rounded-full text-xs transition-colors',
        active ? 'bg-accent text-on-accent shadow-lg shadow-accent/20' : 'glass-chip text-muted hover:text-content'
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function TypeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className={cn('px-3.5 py-1.5 rounded-full text-sm transition-colors', active ? 'bg-accent text-on-accent shadow-lg shadow-accent/20' : 'glass-chip text-muted hover:text-content')}
      onClick={onClick}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}
