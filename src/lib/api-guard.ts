import { NextResponse } from 'next/server';
import { isPasswordConfigured, sessionIdentityFromCookieHeader } from './auth';
import { getUserById } from './users';

/** API Route 共享守卫：未配置密码返回 503，未登录返回 401 */
export async function guardRequest(req: Request): Promise<NextResponse | null> {
  if (!isPasswordConfigured()) {
    return NextResponse.json(
      { error: '服务器未设置 PASSWORD 环境变量' },
      { status: 503 }
    );
  }
  const identity = sessionIdentityFromCookieHeader(req.headers.get('cookie'));
  if (!identity) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }
  const user = await getUserById(identity.userId);
  if (!user || user.role !== identity.role) return NextResponse.json({ error: '账号已停用或权限已更改，请重新登录' }, { status: 401 });
  return null;
}

export function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}
