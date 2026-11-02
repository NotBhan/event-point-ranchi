import { clearCart } from './cart';
import { clearRequirements } from './requirements';

const LEGACY_PLAN_DRAFT_KEY = 'eventPointPlanDraft:v1';
const LEGACY_LOCAL_KEYS = [
  LEGACY_PLAN_DRAFT_KEY,
  'eventPointPlanDraft',
  'eventPointRequirements:v1',
  'royalEventCart:v2',
  'royalEventCart:v1',
];

const AUTH_FORM_PATHS = new Set([
  '/login',
  '/register',
  '/logout',
  '/accounts/login',
  '/accounts/register',
  '/accounts/logout',
  '/admin/login',
  '/admin/logout',
]);

function localStore(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function clearLegacyEnquiryStorage(): void {
  const store = localStore();
  if (!store) return;
  for (const key of LEGACY_LOCAL_KEYS) {
    try {
      store.removeItem(key);
    } catch {}
  }
}

/**
 * Clear every temporary or legacy enquiry value owned by the current tab.
 *
 * The plan form itself is in-memory only. This is used at authentication
 * boundaries (login, registration, logout) and after a successful enquiry.
 */
export function clearEnquiryBrowserState(): void {
  clearLegacyEnquiryStorage();
  clearRequirements();
  clearCart();
}

function isAuthForm(form: HTMLFormElement): boolean {
  try {
    const url = new URL(form.getAttribute('action') || form.action || window.location.href, window.location.href);
    return AUTH_FORM_PATHS.has(url.pathname.replace(/\/+$/, ''));
  } catch {
    return false;
  }
}

export function installEnquiryPrivacyGuards(): void {
  clearLegacyEnquiryStorage();

  document.addEventListener(
    'submit',
    (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || !isAuthForm(form)) return;
      // Guest selections must not survive a login, registration or logout.
      // The Plan form is submitted with fetch and has no auth action, so a
      // failed enquiry submission keeps the visitor's current input.
      clearEnquiryBrowserState();
    },
    true,
  );
}

if (typeof window !== 'undefined' && !(window as any).__enquiry_privacy_initialized) {
  (window as any).__enquiry_privacy_initialized = true;
  installEnquiryPrivacyGuards();
}
