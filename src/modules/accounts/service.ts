import { one, run, tx } from '../../core/db';
import { isEmail } from '../../core/http';
import { hashPassword, verifyPassword } from '../../core/password';
import type { Role } from '../../core/types';

export interface UserRow {
  id: number;
  username: string;
  email: string | null;
  first_name: string;
  role: Role;
  is_active: number;
  password_hash: string;
}

export function findUserByLogin(login: string): UserRow | undefined {
  return one<UserRow>(
    'SELECT * FROM users WHERE (username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE) AND is_active = 1',
    [login, login],
  );
}

export interface CustomerRow {
  id: number;
  user_id: number | null;
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
}

export function ensureCustomerForUser(userId: number, defaults: Partial<CustomerRow> = {}): CustomerRow {
  const existing = one<CustomerRow>('SELECT * FROM customers WHERE user_id = ?', [userId]);
  if (existing) return existing;

  const id = run(
    'INSERT INTO customers (user_id, name, phone, email, address) VALUES (?, ?, ?, ?, ?)',
    [
      userId,
      defaults.name ?? 'Guest',
      defaults.phone ?? `pending-${userId}`,
      defaults.email ?? '',
      defaults.address ?? '',
    ],
  ).lastId;

  return one<CustomerRow>('SELECT * FROM customers WHERE id = ?', [id]) as CustomerRow;
}

export interface RegisterInput {
  name: string;
  username: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
}

export function registerCustomer(input: RegisterInput): { ok: true; userId: number } | { ok: false; error: string } {
  if (!input.name || !input.username || !input.password) {
    return { ok: false, error: 'Name, username and password are required.' };
  }
  if (input.password.length < 6) {
    return { ok: false, error: 'Password must be at least 6 characters long.' };
  }
  if (input.password !== input.confirmPassword) {
    return { ok: false, error: 'Passwords do not match.' };
  }
  if (input.email && !isEmail(input.email)) {
    return { ok: false, error: 'Please enter a valid email address.' };
  }
  if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(input.username)) {
    return { ok: false, error: 'Username must be 3–30 characters (letters, numbers, dot, dash, underscore).' };
  }

  const usernameTaken = one<{ id: number }>('SELECT id FROM users WHERE username = ? COLLATE NOCASE', [
    input.username,
  ]);
  if (usernameTaken) return { ok: false, error: 'That username is already taken.' };

  if (input.email) {
    const emailTaken = one<{ id: number }>('SELECT id FROM users WHERE email = ? COLLATE NOCASE', [input.email]);
    if (emailTaken) return { ok: false, error: 'That email address is already registered.' };
  }

  return tx(() => {
    const userId = run(
      'INSERT INTO users (username, email, password_hash, first_name, role) VALUES (?, ?, ?, ?, ?)',
      [input.username, input.email || null, hashPassword(input.password), input.name.split(' ')[0] ?? input.username, 'customer'],
    ).lastId;

    const existingCustomer = input.phone
      ? one<CustomerRow>('SELECT * FROM customers WHERE phone = ? AND user_id IS NULL', [input.phone])
      : undefined;

    if (existingCustomer) {
      run('UPDATE customers SET user_id = ?, name = ?, email = ? WHERE id = ?', [
        userId,
        input.name,
        input.email,
        existingCustomer.id,
      ]);
    } else {
      run('INSERT INTO customers (user_id, name, phone, email) VALUES (?, ?, ?, ?)', [
        userId,
        input.name,
        input.phone || `pending-${userId}`,
        input.email,
      ]);
    }

    return { ok: true as const, userId };
  });
}

export function authenticate(login: string, password: string): UserRow | null {
  const user = findUserByLogin(login);
  if (!user) return null;
  return verifyPassword(password, user.password_hash) ? user : null;
}

export function changePassword(userId: number, currentPassword: string, newPassword: string, confirmPassword: string) {
  const user = one<UserRow>('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) return { ok: false as const, error: 'Account not found.' };
  if (!verifyPassword(currentPassword, user.password_hash)) {
    return { ok: false as const, error: 'Your current password is incorrect.' };
  }
  if (newPassword.length < 6) return { ok: false as const, error: 'New password must be at least 6 characters.' };
  if (newPassword !== confirmPassword) return { ok: false as const, error: 'New passwords do not match.' };

  const hash = hashPassword(newPassword);
  run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, userId]);
  return { ok: true as const, passwordHash: hash };
}
