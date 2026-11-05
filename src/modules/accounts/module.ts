import { defineModule } from '../../core/define-module';
import { endSession, refreshSession, requireCustomer, startSession } from '../../core/auth';
import { setError, setSuccess } from '../../core/flash';
import { getString, isEmail, redirect, safeNext } from '../../core/http';
import LoginPage from './pages/LoginPage.astro';
import MyBookingsPage from './pages/MyBookingsPage.astro';
import ProfilePage from './pages/ProfilePage.astro';
import AccountPage from './pages/AccountPage.astro';
import ForgotPasswordPage from './pages/ForgotPasswordPage.astro';
import RegisterPage from './pages/RegisterPage.astro';
import { handlePublicLogin } from './login';
import {
  changePassword,
  ensureCustomerForUser,
  registerCustomer,
  updateOwnProfile,
} from './service';
import { findUserById, updateUserName } from '../../core/operational/service';
import { RATE_LIMITS, checkRateLimit, rateLimitKey } from '../../core/rate-limit';
import { loadCustomerBookings } from '../bookings/service';

export default defineModule({
  id: 'accounts',
  label: 'Accounts',
  order: 80,
  routes: [
    {
      path: '/login',
      component: LoginPage,
      handle: handlePublicLogin,
    },
    {
      path: '/register',
      component: RegisterPage,
      handle: async (ctx) => {
        const nextParam = ctx.url.searchParams.get('next') ?? '';

        if (ctx.auth.user) return redirect(safeNext(nextParam, '/'));

        if (ctx.request.method === 'POST') {
          const limit = checkRateLimit(rateLimitKey(ctx.request, 'register'), RATE_LIMITS.register);
          if (!limit.allowed) {
            return {
              props: {
                error: `Too many registration attempts. Please try again in ${limit.retryAfterSeconds} seconds.`,
                next: nextParam,
                values: { name: '', username: '', email: '', phone: '' },
              },
              status: 429,
            };
          }

          const result = await registerCustomer({
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

          const user = await findUserById(result.userId);
          if (user) startSession(ctx.cookies, user.id, user.password_hash);
          setSuccess(ctx.cookies, 'Your account is ready. Welcome to Event Point Ranchi!');
          return redirect(safeNext(getString(ctx.form, 'next') || nextParam, '/'));
        }

        return { props: { error: null, next: nextParam, values: { name: '', username: '', email: '', phone: '' } } };
      },
    },
    {
      path: '/account',
      component: AccountPage,
      handle: async (ctx) => {
        const denied = requireCustomer(ctx);
        if (denied) return denied;

        const user = ctx.auth.user!;

        if (ctx.request.method === 'POST') {
          const updated = await updateOwnProfile(user.id, {
            name: getString(ctx.form, 'name'),
            email: getString(ctx.form, 'email'),
            phone: getString(ctx.form, 'phone'),
            address: getString(ctx.form, 'address'),
          });
          if (!updated.ok) {
            setError(ctx.cookies, updated.error);
            return redirect('/account');
          }
          await updateUserName(user.id, getString(ctx.form, 'name').split(' ')[0] ?? user.firstName, getString(ctx.form, 'email') || null);
          setSuccess(ctx.cookies, 'Your details were updated.');
          return redirect('/account');
        }

        const customer = await ensureCustomerForUser(user.id, {
          name: user.firstName,
          email: user.email ?? '',
        });
        const bookings = await loadCustomerBookings(user.id);

        return {
          props: {
            user: { id: user.id, username: user.username, firstName: user.firstName, email: user.email },
            customer: {
              name: customer.name,
              phone: customer.phone,
              email: customer.email,
              address: customer.address,
            },
            bookings,
          },
        };
      },
    },
    {
      path: '/forgot-password',
      component: ForgotPasswordPage,
      handle: async (ctx) => {
        // No email provider is configured, so a reset link cannot be delivered.
        // The page states that dependency instead of pretending to send one, and
        // the response never reveals whether the address is registered.
        return { props: { submitted: ctx.request.method === 'POST' } };
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

          const updated = await updateOwnProfile(user.id, { name, email, phone, address });
          if (!updated.ok) {
            setError(ctx.cookies, updated.error);
            return redirect('/profile');
          }
          await updateUserName(user.id, name.split(' ')[0] ?? name, email || null);


          setSuccess(ctx.cookies, 'Profile updated.');
          return redirect('/profile');
        }

        const customer = await ensureCustomerForUser(user.id, { name: user.firstName, email: user.email ?? '' });
        const recentBookings = (await loadCustomerBookings(user.id)).slice(0, 5);

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
      handle: async (ctx) => {
        const denied = requireCustomer(ctx);
        if (denied) return denied;
        return { props: { bookings: await loadCustomerBookings(ctx.auth.user!.id) } };
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
