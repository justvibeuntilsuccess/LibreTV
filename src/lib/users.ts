import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface ManagedUser {
  id: string;
  username: string;
  passwordHash: string;
  role: 'admin' | 'user';
  profileId: string;
  createdAt: number;
}
export interface PreferenceProfile {
  id: string;
  name: string;
  preferences: Record<string, unknown>;
  updatedAt: number;
}
interface UserDatabase { users: ManagedUser[]; profiles: PreferenceProfile[] }

const filePath = () => process.env.USER_DATA_FILE || path.join(process.cwd(), 'data', 'users.json');
const publicUser = ({ id, username, role, profileId, createdAt }: ManagedUser) => ({ id, username, role, profileId, createdAt });
const hashPassword = (password: string, salt = crypto.randomBytes(16).toString('hex')) => {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
};

export function verifyUserPassword(input: string, stored: string): boolean {
  const [salt, expected] = stored.split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(input, salt, 64);
  const wanted = Buffer.from(expected, 'hex');
  return actual.length === wanted.length && crypto.timingSafeEqual(actual, wanted);
}

async function readDatabase(): Promise<UserDatabase> {
  try {
    const data = JSON.parse(await fs.readFile(filePath(), 'utf8')) as UserDatabase;
    data.profiles = (data.profiles ?? []).map((profile) => ({ ...profile, updatedAt: profile.updatedAt ?? 1 }));
    return data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const password = process.env.PASSWORD || process.env.password || '';
    const initial: UserDatabase = {
      users: password ? [{ id: 'admin', username: 'admin', passwordHash: hashPassword(password), role: 'admin', profileId: 'default', createdAt: Date.now() }] : [],
      profiles: [{ id: 'default', name: '默认偏好', preferences: {}, updatedAt: 1 }],
    };
    await writeDatabase(initial);
    return initial;
  }
}

async function writeDatabase(data: UserDatabase): Promise<void> {
  const file = filePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
  await fs.rename(temporary, file);
}

export async function authenticateUser(username: string, password: string): Promise<ManagedUser | null> {
  const { users } = await readDatabase();
  const user = users.find((entry) => entry.username.toLowerCase() === username.trim().toLowerCase());
  return user && verifyUserPassword(password, user.passwordHash) ? user : null;
}

export async function listUsers() {
  const data = await readDatabase();
  return { users: data.users.map(publicUser), profiles: data.profiles };
}

export async function getUserById(id: string) {
  const { users } = await readDatabase();
  const found = users.find((entry) => entry.id === id);
  if (!found) return null;
  return publicUser(found);
}

export async function createUser(input: { username: string; password: string; role?: 'admin' | 'user'; profileId?: string }) {
  const data = await readDatabase();
  const username = input.username.trim();
  if (!/^[\p{L}\p{N}_.-]{2,32}$/u.test(username)) throw new Error('用户名须为 2–32 个字母、数字或 . _ -');
  if (input.password.length < 8) throw new Error('密码至少需要 8 个字符');
  if (data.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) throw new Error('用户名已存在');
  const profileId = input.profileId || 'default';
  if (!data.profiles.some((profile) => profile.id === profileId)) throw new Error('偏好配置不存在');
  const user: ManagedUser = { id: crypto.randomUUID(), username, passwordHash: hashPassword(input.password), role: input.role === 'admin' ? 'admin' : 'user', profileId, createdAt: Date.now() };
  data.users.push(user);
  await writeDatabase(data);
  return publicUser(user);
}

export async function deleteUser(id: string): Promise<void> {
  const data = await readDatabase();
  const target = data.users.find((user) => user.id === id);
  if (!target) throw new Error('用户不存在');
  if (target.role === 'admin' && data.users.filter((user) => user.role === 'admin').length <= 1) throw new Error('至少保留一个管理员');
  data.users = data.users.filter((user) => user.id !== id);
  await writeDatabase(data);
}

export async function updateUser(id: string, input: { profileId?: string; role?: 'admin' | 'user'; password?: string }) {
  const data = await readDatabase();
  const user = data.users.find((entry) => entry.id === id);
  if (!user) throw new Error('用户不存在');
  if (input.profileId) {
    if (!data.profiles.some((profile) => profile.id === input.profileId)) throw new Error('偏好配置不存在');
    user.profileId = input.profileId;
  }
  if (input.role) {
    if (input.role !== 'admin' && input.role !== 'user') throw new Error('角色无效');
    if (user.role === 'admin' && input.role === 'user' && data.users.filter((entry) => entry.role === 'admin').length <= 1) throw new Error('至少保留一个管理员');
    user.role = input.role;
  }
  if (input.password) {
    if (input.password.length < 8) throw new Error('密码至少需要 8 个字符');
    user.passwordHash = hashPassword(input.password);
  }
  await writeDatabase(data);
}

export async function saveProfile(profile: Omit<PreferenceProfile, 'updatedAt'>) {
  const data = await readDatabase();
  const name = profile.name.trim();
  if (!name || name.length > 40) throw new Error('配置名称须为 1–40 个字符');
  const index = data.profiles.findIndex((entry) => entry.id === profile.id);
  const current = data.profiles[index];
  const next = { ...profile, name, updatedAt: Math.max(Date.now(), (current?.updatedAt ?? 0) + 1) };
  if (index < 0) data.profiles.push(next);
  else data.profiles[index] = next;
  await writeDatabase(data);
  return next;
}

export async function removeProfile(id: string) {
  const data = await readDatabase();
  if (id === 'default') throw new Error('默认偏好配置不能删除');
  if (data.users.some((user) => user.profileId === id)) throw new Error('此配置仍分配给用户');
  data.profiles = data.profiles.filter((profile) => profile.id !== id);
  await writeDatabase(data);
}
