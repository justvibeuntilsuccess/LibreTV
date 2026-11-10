'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, onUnauthorized, STATUS_QUERY_KEY } from '@/lib/client-api';
import { applyEnvPresets } from '@/lib/subscription-sync';
import type { AuthStatusResponse } from '@/lib/types';
import { useToast } from './toast';
import { applyProfileSettings } from '@/lib/profile-settings';
import { db } from '@/lib/db';

/**
 * 认证上下文：
 * - 页面加载时查询 /api/status 判断会话有效性；
 * - 任何 API 返回 401/503 时全局打开登录框（客户端 API 层统一触发，不再散落检查）。
 */

type SetupRequired = boolean;

interface AuthContextValue {
  checked: boolean;
  verified: boolean;
  role: 'admin' | 'user' | null;
  /** 当前登录用户 id（本地历史按它隔离；未登录时 null） */
  userId: string | null;
  /** 服务器未设置 PASSWORD，需要管理员配置 */
  setupRequired: SetupRequired;
  /** /api/status 返回的应用版本（构建时从 package.json 注入） */
  version: string | null;
  openLogin: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  checked: false,
  verified: false,
  role: null,
  userId: null,
  setupRequired: false,
  version: null,
  openLogin: () => {},
  logout: async () => {},
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [checked, setChecked] = useState(false);
  const [verified, setVerified] = useState(false);
  const [role, setRole] = useState<'admin' | 'user' | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // 与 Providers 共用同一 query key 与缓存，避免 /api/status 被请求两次
  useEffect(() => {
    let cancelled = false;
    queryClient
      .fetchQuery({ queryKey: STATUS_QUERY_KEY, queryFn: () => api.status() })
      .then((s) => {
        if (cancelled) return;
        setVerified(s.verified);
        setRole(s.user?.role ?? null);
        setUserId(s.user?.id ?? null);
        setSetupRequired(!s.passwordRequired);
        setVersion(s.version);
        setChecked(true);
      })
      .catch(() => {
        if (!cancelled) setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [queryClient]);

  useEffect(
    () =>
      onUnauthorized((event) => {
        const setup = (event as CustomEvent).detail === 'setup';
        setSetupRequired(setup);
        setVerified(false);
        setRole(null);
        setUserId(null);
        setModalOpen(true);
      }),
    []
  );

  // 旧版本写入的历史没有 owner 字段：登录后归属到当前账号，
  // 避免升级成「按账号隔离」后老记录全部消失
  useEffect(() => {
    if (!verified || !userId) return;
    void db.history
      .filter((h) => !h.owner)
      .modify({ owner: userId })
      .catch(() => {});
  }, [verified, userId]);

  const openLogin = useCallback(() => setModalOpen(true), []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setVerified(false);
      setRole(null);
      setUserId(null);
      setModalOpen(true);
      toast('已退出登录', 'info');
    }
  }, [toast]);

  const handleLoginSuccess = useCallback(async () => {
    setVerified(true);
    setSetupRequired(false);
    setModalOpen(false);
    // 登录前以 401 失败的查询（如豆瓣推荐）需要重新拉取
    queryClient.invalidateQueries();
    toast('验证成功', 'success');
    // 预置订阅（DEFAULT_SUBSCRIPTIONS）的首屏同步发生在登录之前，会 401 静默失败，
    // 这里用缓存中的 /api/status 补跑一次（缓存缺失时回落为一次请求）
    try {
      const status = await queryClient.fetchQuery<AuthStatusResponse>({
        queryKey: STATUS_QUERY_KEY,
        queryFn: () => api.status(),
        staleTime: 0,
      });
      setRole(status.user?.role ?? null);
      setUserId(status.user?.id ?? null);
      if (status.user?.role === 'user') {
        const profileUserId = status.user.id;
        const response = await fetch('/api/admin');
        if (response.ok) {
          const data = await response.json() as { profile?: { id: string; updatedAt?: number; preferences?: Record<string, unknown> } | null };
          if (data.profile) applyProfileSettings(data.profile.preferences, data.profile.id, data.profile.updatedAt ?? 1, profileUserId);
        }
      }
      if (status) await applyEnvPresets(status);
    } catch {
      // 补拉预置数据失败不影响登录后的正常使用
    }
  }, [toast, queryClient]);

  return (
    <AuthContext.Provider value={{ checked, verified, role, userId, setupRequired, version, openLogin, logout }}>
      {children}
      {modalOpen && (
        <LoginModal
          setupRequired={setupRequired}
          onSuccess={handleLoginSuccess}
          onClose={() => setModalOpen(false)}
        />
      )}
    </AuthContext.Provider>
  );
}

function LoginModal({
  setupRequired,
  onSuccess,
  onClose,
}: {
  setupRequired: boolean;
  onSuccess: () => void;
  onClose: () => void;
}) {
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const submit = async () => {
    if (!password.trim() || loading) return;
    setLoading(true);
    setError('');
    try {
      await api.login(password, username);
      onSuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '验证失败';
      setError(msg === '需要登录' ? '密码错误' : msg);
      setPassword('');
      inputRef.current?.focus();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/80 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-surface-raised rounded-xl p-6 w-full max-w-sm mx-4 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={setupRequired ? '需要配置密码' : '访问验证'}
      >
        {setupRequired ? (
          <>
            <h2 className="text-lg font-semibold text-content mb-3">需要配置密码</h2>
            <p className="text-sm text-muted leading-relaxed">
              为确保安全，必须设置 <code className="text-accent">PASSWORD</code> 环境变量才能使用本服务。
              请联系管理员在部署配置中添加该变量后重启服务。
            </p>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-content mb-1">访问验证</h2>
            <p className="text-sm text-muted mb-4">请输入密码继续访问</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="input w-full mb-2"
                placeholder="用户名（管理员可留空使用旧密码）"
                autoComplete="username"
              />
              <input
                ref={inputRef}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input w-full"
                placeholder="密码"
                autoComplete="current-password"
              />
              {error && <p className="mt-2 text-sm text-danger">{error}</p>}
              <button type="submit" className="btn-primary w-full mt-4" disabled={loading || !password.trim()}>
                {loading ? '验证中...' : '进入'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
