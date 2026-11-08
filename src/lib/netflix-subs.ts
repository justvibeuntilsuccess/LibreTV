/** Netflix 榜单的细分入口（前后端共用，纯常量，不依赖任何服务端模块） */
export const NETFLIX_SUBS = [
  { id: 'official_tv', label: '官方剧集 Top10' },
  { id: 'official_films', label: '官方电影 Top10' },
  { id: 'act', label: '动作' },
  { id: 'doc', label: '纪录片' },
  { id: 'cmy', label: '喜剧' },
  { id: 'crm', label: '犯罪' },
  { id: 'scf', label: '科幻' },
  { id: 'ani', label: '动画' },
  { id: 'hrr', label: '恐怖' },
  { id: 'war', label: '战争' },
] as const;

export type NetflixSub = (typeof NETFLIX_SUBS)[number]['id'];

export function isNetflixSub(sub: string): sub is NetflixSub {
  return NETFLIX_SUBS.some((s) => s.id === sub);
}
