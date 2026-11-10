import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { sessionIdentityFromCookieHeader } from '@/lib/auth';
import { createUser, deleteUser, getUserById, listUsers, removeProfile, saveProfile, updateUser } from '@/lib/users';

export const runtime = 'nodejs';

function identity(req: Request) {
  return sessionIdentityFromCookieHeader(req.headers.get('cookie'));
}

export async function GET(req: Request) {
  const session = identity(req);
  if (!session) return NextResponse.json({ error: '需要登录' }, { status: 401 });
  const account = await getUserById(session.userId);
  if (!account || account.role !== session.role) return NextResponse.json({ error: '账号已停用或权限已更改，请重新登录' }, { status: 401 });
  if (account.role === 'admin') return NextResponse.json(await listUsers());
  const data = await listUsers();
  const profile = data.profiles.find((entry) => entry.id === account.profileId);
  return NextResponse.json({ profile: profile ?? null });
}

export async function POST(req: Request) {
  const session = identity(req);
  if (!session) return NextResponse.json({ error: '需要登录' }, { status: 401 });
  const account = await getUserById(session.userId);
  if (!account || account.role !== session.role) return NextResponse.json({ error: '账号已停用或权限已更改，请重新登录' }, { status: 401 });
  if (account.role !== 'admin') return NextResponse.json({ error: '仅管理员可管理用户和偏好配置' }, { status: 403 });
  try {
    const body = await req.json() as { action?: string; id?: string; user?: { username: string; password: string; role?: 'admin' | 'user'; profileId?: string }; patch?: { profileId?: string; role?: 'admin' | 'user'; password?: string }; profile?: { id?: string; name: string; preferences: Record<string, unknown> } };
    if (body.action === 'create-user' && body.user) return NextResponse.json({ user: await createUser(body.user) });
    if (body.action === 'update-user' && body.id && body.patch) { await updateUser(body.id, body.patch); return NextResponse.json({ success: true }); }
    if (body.action === 'delete-user' && body.id) { await deleteUser(body.id); return NextResponse.json({ success: true }); }
    if (body.action === 'save-profile' && body.profile) {
      const profile = await saveProfile({ id: body.profile.id || crypto.randomUUID(), name: body.profile.name, preferences: body.profile.preferences ?? {} });
      return NextResponse.json({ profile });
    }
    if (body.action === 'delete-profile' && body.id) { await removeProfile(body.id); return NextResponse.json({ success: true }); }
    return NextResponse.json({ error: '无效的管理请求' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '操作失败' }, { status: 400 });
  }
}
