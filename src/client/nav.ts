const DESKTOP_BREAKPOINT = 1024;
let lastFocused: HTMLElement | null = null;

function primaryNav(): HTMLElement | null {
  return document.getElementById('primaryNav');
}

function menuIsOpen(): boolean {
  return Boolean(document.getElementById('siteHeader')?.classList.contains('menu-open'));
}

function syncNavAccessibility(open: boolean): void {
  const nav = primaryNav();
  if (!nav) return;

  if (window.innerWidth <= DESKTOP_BREAKPOINT) {
    if (open) {
      nav.removeAttribute('inert');
      nav.removeAttribute('aria-hidden');
      nav.setAttribute('role', 'dialog');
      nav.setAttribute('aria-modal', 'true');
    } else {
      nav.setAttribute('inert', '');
      nav.setAttribute('aria-hidden', 'true');
      nav.removeAttribute('role');
      nav.removeAttribute('aria-modal');
    }
  } else {
    nav.removeAttribute('inert');
    nav.removeAttribute('aria-hidden');
    nav.removeAttribute('role');
    nav.removeAttribute('aria-modal');
  }
}

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.offsetParent !== null);
}

function setMenu(open: boolean, restoreFocus = false): void {
  const header = document.getElementById('siteHeader');
  const navToggle = document.querySelector<HTMLButtonElement>('[data-nav-toggle]');
  if (!header) return;

  if (open && !menuIsOpen()) {
    const active = document.activeElement;
    lastFocused =
      active instanceof HTMLElement && active !== document.body ? active : (navToggle ?? null);
  }

  header.classList.toggle('menu-open', open);
  navToggle?.setAttribute('aria-expanded', String(open));
  navToggle?.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  document.body.classList.toggle('no-scroll', open);
  syncNavAccessibility(open);

  if (open) {
    const nav = primaryNav();
    const close = nav?.querySelector<HTMLButtonElement>('[data-nav-close]');
    close?.focus({ preventScroll: true });
    return;
  }

  if (restoreFocus && lastFocused && document.contains(lastFocused)) {
    lastFocused.focus({ preventScroll: true });
  }
  lastFocused = null;
}

if (!(window as any).__nav_initialized) {
  (window as any).__nav_initialized = true;

  // Cover history restores and programmatic ClientRouter navigations too: the
  // Plan wizard must always start from a fresh server-rendered document.
  document.addEventListener('astro:before-preparation', (event) => {
    const to = (event as unknown as { to?: URL }).to;
    if (!to) return;
    const targetPath = to.pathname.replace(/\/+$/, '');
    const currentPath = window.location.pathname.replace(/\/+$/, '');
    if (targetPath === '/plan' && currentPath !== '/plan') {
      event.preventDefault();
      window.location.assign(to.href);
    }
  });

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    // The plan wizard binds to a specific form instance and does not re-run
    // when ClientRouter swaps in a second /plan page. Force a document load so
    // the wizard initializes and the server can render the current profile.
    const planLink = target.closest<HTMLAnchorElement>('a[href]');
    if (planLink && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      const href = planLink.getAttribute('href') ?? '';
      if (href && !planLink.hasAttribute('data-astro-reload')) {
        try {
          const targetUrl = new URL(planLink.href, window.location.href);
          const targetPath = targetUrl.pathname.replace(/\/+$/, '');
          const currentPath = window.location.pathname.replace(/\/+$/, '');
          const opensSameTab = !planLink.target || planLink.target === '_self';
          if (
            targetUrl.origin === window.location.origin &&
            targetPath === '/plan' &&
            currentPath !== '/plan' &&
            opensSameTab
          ) {
            event.preventDefault();
            event.stopPropagation();
            window.location.assign(targetUrl.href);
            return;
          }
        } catch {
          // A malformed href should fall through to the normal link handler.
        }
      }
    }

    const toggle = target.closest<HTMLButtonElement>('[data-nav-toggle]');
    if (toggle) {
      setMenu(!menuIsOpen());
      return;
    }

    if (target.closest('[data-nav-close]')) {
      setMenu(false, true);
      return;
    }

    if (target.closest('.nav-menu a')) {
      setMenu(false);
    }

    const userToggle = target.closest<HTMLButtonElement>('[data-user-toggle]');
    const userMenu = document.querySelector<HTMLElement>('[data-user-menu]');
    if (userToggle && userMenu) {
      event.stopPropagation();
      const open = !userMenu.classList.contains('open');
      userMenu.classList.toggle('open', open);
      userToggle.setAttribute('aria-expanded', String(open));
      return;
    }

    if (userMenu && !userMenu.contains(target)) {
      userMenu.classList.remove('open');
      document.querySelector('[data-user-toggle]')?.setAttribute('aria-expanded', 'false');
    }

    const toastClose = target.closest<HTMLButtonElement>('[data-toast-close]');
    if (toastClose) {
      const toast = toastClose.closest<HTMLElement>('[data-toast]');
      if (toast) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-6px)';
        toast.style.transition = 'opacity .18s ease, transform .18s ease';
        window.setTimeout(() => toast.remove(), 190);
      }
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      const wasOpen = menuIsOpen();
      setMenu(false, wasOpen);
      const userMenu = document.querySelector<HTMLElement>('[data-user-menu]');
      userMenu?.classList.remove('open');
      document.querySelector('[data-user-toggle]')?.setAttribute('aria-expanded', 'false');
      return;
    }

    if (event.key !== 'Tab' || !menuIsOpen()) return;
    const nav = primaryNav();
    if (!nav) return;

    const items = focusables(nav);
    if (items.length === 0) return;

    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;

    if (event.shiftKey && (active === first || !nav.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > DESKTOP_BREAKPOINT) {
      setMenu(false);
    } else {
      syncNavAccessibility(menuIsOpen());
    }
  });

  syncNavAccessibility(false);
}

function initToasts() {
  document.querySelectorAll<HTMLElement>('[data-toast]').forEach((toast) => {
    if (toast.dataset.initialized) return;
    toast.dataset.initialized = 'true';
    const dismiss = () => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-6px)';
      toast.style.transition = 'opacity .18s ease, transform .18s ease';
      window.setTimeout(() => toast.remove(), 190);
    };
    window.setTimeout(dismiss, 7000);
  });
}

initToasts();
document.addEventListener('astro:page-load', () => {
  setMenu(false);
  syncNavAccessibility(false);
  initToasts();
});
