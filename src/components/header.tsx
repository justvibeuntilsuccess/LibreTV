'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ThemeToggle } from './theme';
import { SourceManagerDrawer } from './source-manager';
import { HistoryPanel } from './history-panel';
import { requestShowDownloadManager } from './download-manager';
import { Icon } from './icon';
import { SearchHistoryDropdown, useSearchHistory } from './search-history';
import { cn } from '@/lib/utils';
import { useAuth } from './auth';
import { UserManagerDrawer } from './user-manager';

/**
 * 顶部导航：
 * - 左侧：Logo + 主导航（分类 / 直播 / 关于）
 * - 中间：搜索（仅首页以外的页面）
 * - 右侧：主题、历史、下载、用户菜单（用户管理 / 设置 / 退出）
 * - 窄屏：主导航与次要操作收进右侧的菜单面板，任何一项都不换行
 */
export function Header({ showSearch = false }: { showSearch?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const { role, verified, logout, openLogin } = useAuth();
  const [query, setQuery] = useState('');
  // 与首页搜索框共用同一套「最近搜索」下拉逻辑
  const searchHistory = useSearchHistory(query);

  // 路由变化后自动收起所有菜单
  useEffect(() => {
    setUserMenuOpen(false);
    setMobileMenuOpen(false);
  }, [pathname]);

  // 点击外部 / Esc 收起
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (userMenuRef.current && !userMenuRef.current.contains(target)) setUserMenuOpen(false);
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(target)) setMobileMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setUserMenuOpen(false);
        setMobileMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const submitSearch = (text: string) => {
    const q = text.trim().slice(0, 100);
    if (!q) return;
    searchHistory.close();
    router.push(`/?s=${encodeURIComponent(q)}`, { scroll: false });
    // 顶栏搜索一并写入最近搜索（此前只有首页会记录）
    searchHistory.record(q);
  };

  const pickHistory = (text: string) => {
    setQuery(text);
    submitSearch(text);
  };

  const openSettings = () => {
    setUserMenuOpen(false);
    setMobileMenuOpen(false);
    setSettingsOpen(true);
  };
  const openHistory = () => {
    setMobileMenuOpen(false);
    setHistoryOpen(true);
  };
  const openDownloads = () => {
    setMobileMenuOpen(false);
    requestShowDownloadManager();
  };
  const openUsers = () => {
    setUserMenuOpen(false);
    setMobileMenuOpen(false);
    setUsersOpen(true);
  };
  const doLogout = () => {
    setUserMenuOpen(false);
    setMobileMenuOpen(false);
    void logout();
  };

  // 未登录：只留 Logo + 一个「登录」按钮，不展示任何导航与操作入口
  if (!verified) {
    return (
      <header className="glass-nav sticky top-0 z-40 backdrop-blur-2xl border-b">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-7 h-16 flex items-center">
          <Link href="/" aria-label="LibreTV 首页" className="flex shrink-0 items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-512.png" alt="LibreTV" className="w-8 h-8 rounded-[10px]" />
            <span className="hidden sm:block text-[15px] font-semibold tracking-[-.02em] text-content whitespace-nowrap">
              LibreTV
            </span>
          </Link>
          <div className="flex-1" />
          <button
            type="button"
            onClick={openLogin}
            className="shrink-0 whitespace-nowrap rounded-full bg-accent px-4 py-1.5 text-[13px] font-medium text-on-accent transition-colors hover:bg-accent-hover"
          >
            登录
          </button>
        </div>
      </header>
    );
  }

  return (
    <>
      <header className="glass-nav sticky top-0 z-40 backdrop-blur-2xl border-b">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-7 h-16 flex flex-nowrap items-center gap-3 sm:gap-5">
          <Link href="/" aria-label="LibreTV 首页" className="flex shrink-0 items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-512.png" alt="LibreTV" className="w-8 h-8 rounded-[10px]" />
            <span className="hidden sm:block text-[15px] font-semibold tracking-[-.02em] text-content whitespace-nowrap">
              LibreTV
            </span>
          </Link>

          {/* 主导航：只在 md 以上显示，避免中文被挤成竖排 */}
          <nav className="hidden md:flex items-center gap-0.5 shrink-0" aria-label="主导航">
            <HeaderLink href="/browse" active={pathname === '/browse'}>分类</HeaderLink>
            <HeaderLink href="/live" active={pathname === '/live'}>直播</HeaderLink>
            <HeaderLink href="/about" active={pathname === '/about'}>关于</HeaderLink>
          </nav>

          {showSearch && (
            <form
              className="hidden md:block min-w-0 flex-1 max-w-xl"
              onSubmit={(e) => {
                e.preventDefault();
                submitSearch(query);
              }}
            >
              <div ref={searchHistory.containerRef} className="relative">
                <input
                  className={cn(
                    'input w-full h-9',
                    // 展开时：上圆角与外框沿用聚焦样式，底边改为内部分隔线，与下拉拼成同一面板
                    searchHistory.visible &&
                      'rounded-b-none border-accent border-b-line bg-surface-raised focus-visible:ring-0'
                  )}
                  aria-label="搜索影片"
                  placeholder="搜索影片..."
                  value={query}
                  maxLength={100}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    searchHistory.resetActive();
                  }}
                  onFocus={searchHistory.onFocus}
                  onKeyDown={(e) => searchHistory.onKeyDown(e, pickHistory)}
                  role="combobox"
                  aria-expanded={searchHistory.visible}
                  aria-controls="header-search-history"
                  aria-autocomplete="list"
                  aria-activedescendant={
                    searchHistory.visible && searchHistory.activeIndex >= 0
                      ? `header-search-history-${searchHistory.activeIndex}`
                      : undefined
                  }
                />
                {searchHistory.visible && (
                  <SearchHistoryDropdown
                    id="header-search-history"
                    matches={searchHistory.matches}
                    activeIndex={searchHistory.activeIndex}
                    onPick={pickHistory}
                    onRemove={searchHistory.remove}
                    onClearAll={searchHistory.clearAll}
                  />
                )}
              </div>
            </form>
          )}

          <div className="flex-1 md:hidden" />

          <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
            <ThemeToggle />

            {/* 次要操作：登录后才显示（历史/下载都是本机个人数据） */}
            {role && (
              <div className="hidden sm:flex items-center gap-0.5">
                <IconButton label="观看历史" onClick={openHistory}>
                  <Icon name="clock" />
                </IconButton>
                <IconButton label="下载管理" onClick={openDownloads}>
                  <Icon name="download" />
                </IconButton>
              </div>
            )}

            {role && (
              <div ref={userMenuRef} className="relative hidden sm:block">
                <button
                  type="button"
                  className={cn(
                    'ml-1 flex items-center gap-1 rounded-full pl-1 pr-1.5 py-1 transition-colors',
                    'hover:bg-hover',
                    userMenuOpen && 'bg-hover'
                  )}
                  aria-label="账户菜单"
                  aria-haspopup="menu"
                  aria-expanded={userMenuOpen}
                  onClick={() => {
                    setUserMenuOpen((v) => !v);
                    setMobileMenuOpen(false);
                  }}
                >
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-accent/15 text-accent">
                    <Icon name="user" className="h-4 w-4" />
                  </span>
                  <Icon
                    name="chevronDown"
                    className={cn('h-3.5 w-3.5 text-muted transition-transform', userMenuOpen && 'rotate-180')}
                  />
                </button>

                {userMenuOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 top-[calc(100%+10px)] w-48 rounded-xl border border-line bg-surface p-1.5 shadow-xl"
                  >
                    {role === 'admin' && (
                      <MenuItem onClick={openUsers}>
                        <Icon name="user" className="h-4 w-4" />
                        用户管理
                      </MenuItem>
                    )}
                    <MenuItem onClick={openSettings}>
                      <Icon name="gear" className="h-4 w-4" />
                      设置
                    </MenuItem>
                    <div className="my-1 h-px bg-line" />
                    <MenuItem onClick={doLogout} danger>
                      <Icon name="close" className="h-4 w-4" />
                      退出登录
                    </MenuItem>
                  </div>
                )}
              </div>
            )}

            {/* 窄屏菜单：主导航 + 次要操作 + 账户操作 */}
            <div ref={mobileMenuRef} className="relative md:hidden">
              <IconButton
                label="菜单"
                onClick={() => {
                  setMobileMenuOpen((v) => !v);
                  setUserMenuOpen(false);
                }}
              >
                <Icon name={mobileMenuOpen ? 'close' : 'menu'} />
              </IconButton>

              {mobileMenuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-[calc(100%+10px)] w-56 rounded-xl border border-line bg-surface p-1.5 shadow-xl"
                >
                  <MobileNavItem href="/browse" active={pathname === '/browse'}>分类</MobileNavItem>
                  <MobileNavItem href="/live" active={pathname === '/live'}>直播</MobileNavItem>
                  <MobileNavItem href="/about" active={pathname === '/about'}>关于</MobileNavItem>
                  <div className="my-1 h-px bg-line" />
                  {role && (
                    <>
                      <MenuItem onClick={openHistory}>
                        <Icon name="clock" className="h-4 w-4" />
                        观看历史
                      </MenuItem>
                      <MenuItem onClick={openDownloads}>
                        <Icon name="download" className="h-4 w-4" />
                        下载管理
                      </MenuItem>
                    </>
                  )}
                  {role === 'admin' && (
                    <MenuItem onClick={openUsers}>
                      <Icon name="user" className="h-4 w-4" />
                      用户管理
                    </MenuItem>
                  )}
                  {role && (
                    <>
                      <MenuItem onClick={openSettings}>
                        <Icon name="gear" className="h-4 w-4" />
                        设置
                      </MenuItem>
                      <div className="my-1 h-px bg-line" />
                      <MenuItem onClick={doLogout} danger>
                        <Icon name="close" className="h-4 w-4" />
                        退出登录
                      </MenuItem>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <SourceManagerDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <HistoryPanel open={historyOpen} onClose={() => setHistoryOpen(false)} />
      <UserManagerDrawer open={usersOpen} onClose={() => setUsersOpen(false)} />
    </>
  );
}

function HeaderLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        'shrink-0 whitespace-nowrap px-3 py-2 rounded-full text-[13px] transition-colors',
        active ? 'text-content bg-chip' : 'text-muted hover:text-content hover:bg-hover'
      )}
    >
      {children}
    </Link>
  );
}

function MobileNavItem({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        'flex w-full items-center rounded-lg px-3 py-2 text-[13px] transition-colors',
        active ? 'bg-hover text-content' : 'text-muted hover:bg-hover hover:text-content'
      )}
    >
      {children}
    </Link>
  );
}

function MenuItem({
  onClick,
  children,
  danger = false,
}: {
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition-colors',
        danger ? 'text-muted hover:bg-hover hover:text-danger' : 'text-muted hover:bg-hover hover:text-content'
      )}
    >
      {children}
    </button>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="p-2 rounded-md text-muted hover:text-content hover:bg-hover transition-colors"
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
