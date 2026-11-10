'use client';

import { useCallback, useEffect, useState } from 'react';
import { Drawer } from './drawer';
import { useToast } from './toast';

type User = { id: string; username: string; role: 'admin' | 'user'; profileId: string; createdAt: number };
type Profile = { id: string; name: string; preferences: Record<string, unknown> };
type ProfilePreferences = {
  adultMode: 'exclude' | 'only' | 'all';
  adFilter: boolean;
  doubanEnabled: boolean;
  recommendSource: 'douban' | 'bangumi' | 'hot-list';
  autoplayNext: boolean;
  imageProxyMode: 'direct' | 'proxy' | 'custom';
  customImageProxy: string;
};

const DEFAULT_PREFERENCES: ProfilePreferences = {
  adultMode: 'exclude',
  adFilter: true,
  doubanEnabled: true,
  recommendSource: 'hot-list',
  autoplayNext: true,
  imageProxyMode: 'direct',
  customImageProxy: '',
};

function readPreferences(value: Record<string, unknown>): ProfilePreferences {
  return {
    adultMode: value.adultMode === 'only' || value.adultMode === 'all' ? value.adultMode : 'exclude',
    adFilter: typeof value.adFilter === 'boolean' ? value.adFilter : true,
    doubanEnabled: typeof value.doubanEnabled === 'boolean' ? value.doubanEnabled : true,
    recommendSource: value.recommendSource === 'douban' || value.recommendSource === 'bangumi' ? value.recommendSource : 'hot-list',
    autoplayNext: typeof value.autoplayNext === 'boolean' ? value.autoplayNext : true,
    imageProxyMode: value.imageProxyMode === 'proxy' || value.imageProxyMode === 'custom' ? value.imageProxyMode : 'direct',
    customImageProxy: typeof value.customImageProxy === 'string' ? value.customImageProxy : '',
  };
}

export function UserManagerDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [users, setUsers] = useState<User[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [resetPassword, setResetPassword] = useState<Record<string, string>>({});
  const [name, setName] = useState('');
  const [preferences, setPreferences] = useState<ProfilePreferences>(DEFAULT_PREFERENCES);
  const [editingProfileId, setEditingProfileId] = useState<string | undefined>();
  const { toast } = useToast();

  const refresh = useCallback(async () => {
    const response = await fetch('/api/admin');
    if (!response.ok) throw new Error('无法加载用户管理数据');
    const data = await response.json() as { users: User[]; profiles: Profile[] };
    setUsers(data.users);
    setProfiles(data.profiles);
  }, []);
  useEffect(() => { if (open) void refresh().catch((error) => toast(error.message, 'error')); }, [open, refresh, toast]);

  const mutate = async (body: Record<string, unknown>) => {
    const response = await fetch('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json() as { error?: string };
    if (!response.ok) throw new Error(data.error || '操作失败');
    await refresh();
  };

  return <Drawer open={open} onClose={onClose} title="用户与偏好配置" width="max-w-xl">
    <section className="space-y-3">
      <h3 className="font-semibold text-content">用户</h3>
      <form className="grid grid-cols-2 gap-2" onSubmit={(event) => {
        event.preventDefault();
        void mutate({ action: 'create-user', user: { username, password, profileId: profiles[0]?.id || 'default' } })
          .then(() => { setUsername(''); setPassword(''); toast('用户已创建', 'success'); })
          .catch((error) => toast(error.message, 'error'));
      }}>
        <input className="input" placeholder="用户名" value={username} onChange={(e) => setUsername(e.target.value)} required minLength={2} maxLength={32} />
        <input className="input" placeholder="初始密码（至少 8 位）" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        <button className="btn-primary col-span-2" type="submit">创建普通用户</button>
      </form>
      <ul className="divide-y divide-line rounded-lg border border-line">
        {users.map((user) => <li key={user.id} className="flex items-center gap-2 p-3">
          <div className="min-w-0 flex-1"><div className="text-sm text-content">{user.username} <span className="text-xs text-muted">{user.role === 'admin' ? '管理员' : '用户'}</span></div>
            <select aria-label={`${user.username} 的角色`} className="input mt-1 h-8 py-1" value={user.role} onChange={(e) => void mutate({ action: 'update-user', id: user.id, patch: { role: e.target.value } }).catch((error) => toast(error.message, 'error'))}>
              <option value="user">普通用户</option><option value="admin">管理员</option>
            </select>
            <select aria-label={`${user.username} 的偏好配置`} className="input mt-1 h-8 py-1" value={user.profileId} onChange={(e) => void mutate({ action: 'update-user', id: user.id, patch: { profileId: e.target.value } }).catch((error) => toast(error.message, 'error'))}>
              {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <input aria-label={`为 ${user.username} 重置密码`} className="input w-28" type="password" placeholder="新密码" minLength={8} value={resetPassword[user.id] ?? ''} onChange={(e) => setResetPassword((prev) => ({ ...prev, [user.id]: e.target.value }))} />
            <button className="text-xs text-accent hover:underline" onClick={() => {
              const nextPassword = resetPassword[user.id] ?? '';
              if (nextPassword.length < 8) { toast('密码至少需要 8 个字符', 'error'); return; }
              void mutate({ action: 'update-user', id: user.id, patch: { password: nextPassword } }).then(() => { setResetPassword((prev) => ({ ...prev, [user.id]: '' })); toast('密码已重置', 'success'); }).catch((error) => toast(error.message, 'error'));
            }}>重置密码</button>
          </div>
          <button className="text-xs text-danger hover:underline" onClick={() => void mutate({ action: 'delete-user', id: user.id }).catch((error) => toast(error.message, 'error'))}>删除</button>
        </li>)}
      </ul>
    </section>

    <section className="mt-8 space-y-3">
      <h3 className="font-semibold text-content">偏好配置</h3>
      <p className="text-xs text-muted">配置会在普通用户登录时自动应用。</p>
      <form className="space-y-2" onSubmit={(event) => {
        event.preventDefault();
        void mutate({ action: 'save-profile', profile: { id: editingProfileId, name, preferences } })
          .then(() => { setName(''); setPreferences(DEFAULT_PREFERENCES); setEditingProfileId(undefined); toast('偏好配置已保存', 'success'); })
          .catch((error) => toast(error.message, 'error'));
      }}>
        <input className="input w-full" placeholder="配置名称" value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} />
        <PreferenceSelect label="内容范围" value={preferences.adultMode} onChange={(value) => setPreferences((current) => ({ ...current, adultMode: value as ProfilePreferences['adultMode'] }))} options={[
          ['exclude', '不含 18+'], ['only', '仅 18+'], ['all', '全部内容'],
        ]} />
        <PreferenceSelect label="首页推荐来源" value={preferences.recommendSource} onChange={(value) => setPreferences((current) => ({ ...current, recommendSource: value as ProfilePreferences['recommendSource'] }))} options={[
          ['hot-list', '影视热榜'], ['douban', '豆瓣'], ['bangumi', 'Bangumi'],
        ]} />
        <PreferenceSelect label="封面图加载方式" value={preferences.imageProxyMode} onChange={(value) => setPreferences((current) => ({ ...current, imageProxyMode: value as ProfilePreferences['imageProxyMode'] }))} options={[
          ['direct', '直接加载'], ['proxy', '使用内置代理'], ['custom', '自定义代理'],
        ]} />
        {preferences.imageProxyMode === 'custom' && <input className="input w-full" aria-label="自定义封面图代理地址" placeholder="自定义代理地址" value={preferences.customImageProxy} onChange={(e) => setPreferences((current) => ({ ...current, customImageProxy: e.target.value }))} />}
        <PreferenceToggle label="过滤广告片段" checked={preferences.adFilter} onChange={(checked) => setPreferences((current) => ({ ...current, adFilter: checked }))} />
        <PreferenceToggle label="启用豆瓣推荐" checked={preferences.doubanEnabled} onChange={(checked) => setPreferences((current) => ({ ...current, doubanEnabled: checked }))} />
        <PreferenceToggle label="自动连播下一集" checked={preferences.autoplayNext} onChange={(checked) => setPreferences((current) => ({ ...current, autoplayNext: checked }))} />
        <button className="btn-primary" type="submit">{editingProfileId ? '保存偏好配置' : '创建偏好配置'}</button>
      </form>
      <ul className="space-y-2">{profiles.map((profile) => <li key={profile.id} className="flex items-center justify-between rounded-lg bg-card px-3 py-2 text-sm text-content">
        <span>{profile.name}</span><span className="flex gap-3"><button className="text-xs text-accent hover:underline" onClick={() => { setEditingProfileId(profile.id); setName(profile.name); setPreferences(readPreferences(profile.preferences)); }}>编辑</button>{profile.id !== 'default' && <button className="text-xs text-danger hover:underline" onClick={() => void mutate({ action: 'delete-profile', id: profile.id }).catch((error) => toast(error.message, 'error'))}>删除</button>}</span>
      </li>)}</ul>
    </section>
  </Drawer>;
}

function PreferenceSelect({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (value: string) => void }) {
  return <label className="block space-y-1 text-sm text-content">{label}<select className="input w-full" value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>;
}

function PreferenceToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm text-content">{label}<input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>;
}
