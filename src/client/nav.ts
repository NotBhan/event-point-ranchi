function setMenu(open: boolean): void {
  const header = document.getElementById('siteHeader');
  const navToggle = document.querySelector<HTMLButtonElement>('[data-nav-toggle]');
  if (!header) return;
  header.classList.toggle('menu-open', open);
  navToggle?.setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('no-scroll', open);
}

document.addEventListener('click', (event) => {
  const target = event.target as HTMLElement | null;
  if (!target) return;

  const toggle = target.closest<HTMLButtonElement>('[data-nav-toggle]');
  if (toggle) {
    const header = document.getElementById('siteHeader');
    setMenu(!header?.classList.contains('menu-open'));
    return;
  }

  if (target.closest('[data-nav-close]') || target.closest('.nav-menu a')) {
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
  if (event.key !== 'Escape') return;
  setMenu(false);
  const userMenu = document.querySelector<HTMLElement>('[data-user-menu]');
  userMenu?.classList.remove('open');
  document.querySelector('[data-user-toggle]')?.setAttribute('aria-expanded', 'false');
});

window.addEventListener('resize', () => {
  if (window.innerWidth > 1024) {
    setMenu(false);
  }
});

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
  initToasts();
});
