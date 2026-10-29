import { defineModule } from '../../core/define-module';
import { endSession, refreshSession, requireCustomer, startSession } from '../../core/auth';
import { one, run } from '../../core/db';
import { setError, setSuccess } from '../../core/flash';
import { getString, isEmail, redirect, safeNext } from '../../core/http';
import LoginPage from './pages/LoginPage.astro';
import MyBookingsPage from './pages/MyBookingsPage.astro';
import ProfilePage from './pages/ProfilePage.astro';
import RegisterPage from './pages/RegisterPage.astro';
import { authenticate, changePassword, ensureCustomerForUser, registerCustomer, type UserRow } from './service';
import { loadCustomerBookings } from '../bookings/service';

function userById(id: number): UserRow | undefined {
  return one<UserRow>('SELECT * FROM users WHERE id = ?', [id]);
}

export default defineModule({
  id: 'accounts',
  label: 'Accounts',
  order: 80,
  routes: [
    {
      path: '/login',
      component: LoginPage,
      handle: async (ctx) => {
        const nextParam = ctx.url.searchParams.get('next') ?? '';

        if (ctx.auth.user) return redirect(safeNext(nextParam, '/'));

        if (ctx.request.method === 'POST') {
          const login = getString(ctx.form, 'username');
          const password = getString(ctx.form, 'password');
          const user = await authenticate(login, password);

          if (!user) {
            return { props: { error: 'Invalid username/email or password.', next: nextParam, username: login } };
          }

          startSession(ctx.cookies, user.id, user.password_hash);
          setSuccess(ctx.cookies, `Welcome back, ${user.first_name || user.username}!`);
          const target = getString(ctx.form, 'next') || nextParam;
          const fallback = user.role === 'customer' ? '/' : '/admin';
          return redirect(safeNext(target, fallback));
        }

        return { props: { error: null, next: nextParam, username: '' } };
      },
    },
    {
      path: '/register',
      component: RegisterPage,
      handle: async (ctx) => {
        const nextParam = ctx.url.searchParams.get('next') ?? '';

        if (ctx.auth.user) return redirect(safeNext(nextParam, '/'));

        if (ctx.request.method === 'POST') {
          const result = registerCustomer({
            name: getString(ctx.form, 'name'),
            username: getString(ctx.form, 'username'),
            email: getString(ctx.form, 'email'),
            phone: getString(ctx.form, 'phone'),
            password: getString(ctx.form, 'password'),
            confirmPassword: getString(ctx.form, 'confirm_password'),
          });

          if (!result.ok) {
            return { props: { error: result.error, next: nextParam, values: { name: getString(ctx.form, 'name'), username: getString(ctx.form, 'username'), email: getString(ctx.form, 'email'), phone: getString(ctx.form, 'phone') } } };
          }

          const user = userById(result.userId);
          if (user) startSession(ctx.cookies, user.id, user.password_hash);
          setSuccess(ctx.cookies, 'Your account is ready. Welcome to Event Point Ranchi!');
          return redirect(safeNext(getString(ctx.form, 'next') || nextParam, '/'));
        }

        return { props: { error: null, next: nextParam, values: { name: '', username: '', email: '', phone: '' } } };
      },
    },
    {
      path: '/logout',
      component: LoginPage,
      handle: async (ctx) => {
        endSession(ctx.cookies);
        setSuccess(ctx.cookies, 'You have been logged out.');
        return redirect('/');
      },
    },
    {
      path: '/profile',
      component: ProfilePage,
      handle: async (ctx) => {
        const denied = requireCustomer(ctx);
        if (denied) return denied;

        const user = ctx.auth.user!;

        if (ctx.request.method === 'POST') {
          const name = getString(ctx.form, 'name');
          const email = getString(ctx.form, 'email');
          const phone = getString(ctx.form, 'phone');
          const address = getString(ctx.form, 'address');

          if (!name) {
            setError(ctx.cookies, 'Please enter your full name.');
            return redirect('/profile');
          }
          if (email && !isEmail(email)) {
            setError(ctx.cookies, 'Please enter a valid email address.');
            return redirect('/profile');
          }

          const customer = ensureCustomerForUser(user.id, { name: user.firstName, email: user.email });
          run('UPDATE customers SET name = ?, email = ?, phone = ?, address = ? WHERE id = ?', [
            name,
            email,
            phone,
            address,
            customer.id,
          ]);
          run('UPDATE users SET first_name = ?, email = ? WHERE id = ?', [name.split(' ')[0] ?? name, email || null, user.id]);

          setSuccess(ctx.cookies, 'Profile updated.');
          return redirect('/profile');
        }

        const customer = ensureCustomerForUser(user.id, { name: user.firstName, email: user.email });
        const recentBookings = loadCustomerBookings(user.id).slice(0, 5);

        return { props: { customer, recentBookings, user } };
      },
    },
    {
      path: '/change-password',
      component: ProfilePage,
      handle: async (ctx) => {
        const denied = requireCustomer(ctx);
        if (denied) return denied;

        if (ctx.request.method !== 'POST') return redirect('/profile');

        const result = await changePassword(
          ctx.auth.user!.id,
          getString(ctx.form, 'current_password'),
          getString(ctx.form, 'new_password'),
          getString(ctx.form, 'confirm_password'),
        );

        if (!result.ok) {
          setError(ctx.cookies, result.error);
          return redirect('/profile');
        }

        refreshSession(ctx.cookies, ctx.auth.user!.id, result.passwordHash);
        setSuccess(ctx.cookies, 'Password updated successfully.');
        return redirect('/profile');
      },
    },
    {
      path: '/my-bookings',
      component: MyBookingsPage,
      handle: (ctx) => {
        const denied = requireCustomer(ctx);
        if (denied) return denied;
        return { props: { bookings: loadCustomerBookings(ctx.auth.user!.id) } };
      },
    },
    // Legacy Django paths kept alive so old links and bookmarks keep working.
    { path: '/accounts/login', component: LoginPage, handle: () => redirect('/login') },
    { path: '/accounts/register', component: RegisterPage, handle: () => redirect('/register') },
    { path: '/accounts/profile', component: ProfilePage, handle: () => redirect('/profile') },
    { path: '/accounts/my-bookings', component: MyBookingsPage, handle: () => redirect('/my-bookings') },
    {
      path: '/accounts/logout',
      component: LoginPage,
      handle: async (ctx) => {
        endSession(ctx.cookies);
        return redirect('/');
      },
    },
  ],
});
