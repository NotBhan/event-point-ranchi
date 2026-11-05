import { isEmail } from '../../core/http';
import { hashPassword, verifyPassword } from '../../core/password';
import type { Role } from '../../core/types';
import {
  registerCustomerAccount,
  findUserByLogin as neonFindUserByLogin,
  authenticate as neonAuthenticate,
  findUserById as neonFindUserById,
  ensureCustomerForUser as neonEnsureCustomerForUser,
  updateUserPassword as neonUpdateUserPassword,
  updateCustomerProfile,
} from '../../core/operational/service';

export interface UserRow {
  id: number;
  username: string;
  email: string | null;
  first_name: string;
  role: Role;
  is_active: number | boolean;
  password_hash: string;
}

export const PUBLIC_LOGIN_ACCOUNT_NOT_FOUND =
  'Account not found. Please check your username or create a customer account.';
export const PUBLIC_LOGIN_INVALID_PASSWORD = 'Invalid username/email or password.';

export type CustomerLoginResult =
  | { kind: 'success'; user: UserRow }
  | { kind: 'invalid-password' }
  | { kind: 'account-not-found' };

const DUMMY_PASSWORD_HASH = hashPassword('not-a-public-account-password');

function consumePasswordCheck(password: string, hash: string): boolean {
  return verifyPassword(password, hash);
}

/**
 * Public login only authenticates customer accounts.
 *
 * Staff and nonexistent usernames deliberately collapse into the same
 * account-not-found result. Password hashing is still performed for every
 * lookup, including unknown usernames, to avoid an obvious early-return timing
 * difference.
 */
export async function authenticateCustomer(login: string, password: string): Promise<CustomerLoginResult> {
  const user = await findUserByLogin(login);
  if (!user) {
    consumePasswordCheck(password, DUMMY_PASSWORD_HASH);
    return { kind: 'account-not-found' };
  }

  const passwordValid = consumePasswordCheck(password, user.password_hash);
  if (user.role !== 'customer') return { kind: 'account-not-found' };
  if (!passwordValid) return { kind: 'invalid-password' };
  return { kind: 'success', user };
}

export async function findUserByLogin(login: string): Promise<UserRow | undefined> {
  const user = await neonFindUserByLogin(login);
  return user as UserRow | undefined;
}

export interface CustomerRow {
  id: number;
  user_id: number | null;
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
}

export async function ensureCustomerForUser(userId: number, defaults: Partial<CustomerRow> = {}): Promise<CustomerRow> {
  // Customers are operational records and live in Neon, alongside bookings.
  const customer = await neonEnsureCustomerForUser(userId, defaults);
  return customer as unknown as CustomerRow;
}

export interface RegisterInput {
  name: string;
  username: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
}

/** Password policy: at least 8 characters with a letter and a digit. */
export function validatePassword(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters long.';
  if (!/[A-Za-z]/.test(password)) return 'Password must include at least one letter.';
  if (!/[0-9]/.test(password)) return 'Password must include at least one number.';
  if (password.length > 200) return 'Password is too long.';
  return null;
}

export function normalisePhone(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  const national = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  return /^[6-9]\d{9}$/.test(national) ? national : null;
}

export async function registerCustomer(
  input: RegisterInput,
): Promise<{ ok: true; userId: number } | { ok: false; error: string }> {
  const name = input.name.trim();
  const username = input.username.trim();
  const email = input.email.trim().toLowerCase();

  if (name.length < 2) return { ok: false, error: 'Please enter your full name.' };
  if (!username) return { ok: false, error: 'Please choose a username.' };
  if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(username)) {
    return { ok: false, error: 'Username must be 3–30 characters (letters, numbers, dot, dash, underscore).' };
  }
  if (!isEmail(email)) return { ok: false, error: 'Please enter a valid email address.' };

  const phone = normalisePhone(input.phone);
  if (!phone) return { ok: false, error: 'Enter a valid 10-digit Indian mobile number.' };

  const passwordError = validatePassword(input.password);
  if (passwordError) return { ok: false, error: passwordError };
  if (input.password !== input.confirmPassword) return { ok: false, error: 'Passwords do not match.' };

  const result = await registerCustomerAccount({
    username,
    email,
    passwordHash: hashPassword(input.password),
    firstName: name.split(' ')[0] || username,
    name,
    phone,
    linkByPhone: true,
  });

  if (!result.ok) {
    return {
      ok: false,
      error:
        result.error === 'username_taken'
          ? 'That username is already taken.'
          : 'That email address is already registered.',
    };
  }

  return { ok: true, userId: result.userId };
}

export async function authenticate(login: string, password: string): Promise<UserRow | null> {
  const user = await neonAuthenticate(login, password);
  return user as UserRow | null;
}

export async function changePassword(userId: number, currentPassword: string, newPassword: string, confirmPassword: string) {
  const user = await neonFindUserById(userId);
  if (!user) return { ok: false as const, error: 'Account not found.' };
  if (!verifyPassword(currentPassword, user.password_hash)) {
    return { ok: false as const, error: 'Your current password is incorrect.' };
  }
  const policyError = validatePassword(newPassword);
  if (policyError) return { ok: false as const, error: policyError };
  if (newPassword !== confirmPassword) return { ok: false as const, error: 'New passwords do not match.' };

  const hash = hashPassword(newPassword);
  await neonUpdateUserPassword(userId, hash);
  return { ok: true as const, passwordHash: hash };
}

/** Updates the signed-in customer's own record. Never trusts a browser id. */
export async function updateOwnProfile(
  userId: number,
  data: { name: string; email: string; phone: string; address: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const name = data.name.trim();
  const email = data.email.trim().toLowerCase();
  const phone = normalisePhone(data.phone);

  if (name.length < 2) return { ok: false, error: 'Please enter your full name.' };
  if (email && !isEmail(email)) return { ok: false, error: 'Please enter a valid email address.' };
  if (!phone) return { ok: false, error: 'Enter a valid 10-digit Indian mobile number.' };

  const updated = await updateCustomerProfile(userId, { name, email, phone, address: data.address.trim() });
  if (!updated) return { ok: false, error: 'We could not update your profile. Please contact support.' };
  return { ok: true };
}
