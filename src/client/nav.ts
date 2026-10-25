const header = document.getElementById('siteHeader');
const navToggle = document.querySelector<HTMLButtonElement>('[data-nav-toggle]');
const userMenu = document.querySelector<HTMLElement>('[data-user-menu]');
const userToggle = document.querySelector<HTMLButtonElement>('[data-user-toggle]');

function setMenu(open: boolean): void {
  if (!header) return;
  header.classList.toggle('menu-open', open);
  navToggle?.setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('no-scroll', open);
}

navToggle?.addEventListener('click', () => {
  setMenu(!header?.classList.contains('menu-open'));
});

document.querySelectorAll('[data-nav-close], .nav-menu a').forEach((element) => {
  element.addEventListener('click', () => setMenu(false));
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  setMenu(false);
  userMenu?.classList.remove('open');
});

userToggle?.addEventListener('click', (event) => {
  event.stopPropagation();
  const open = !userMenu?.classList.contains('open');
  userMenu?.classList.toggle('open', open);
  userToggle.setAttribute('aria-expanded', String(open));
});

document.addEventListener('click', (event) => {
  if (!userMenu) return;
  if (!userMenu.contains(event.target as Node)) {
    userMenu.classList.remove('open');
    userToggle?.setAttribute('aria-expanded', 'false');
  }
});

document.querySelectorAll<HTMLElement>('[data-toast]').forEach((toast) => {
  const dismiss = () => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-6px)';
    toast.style.transition = 'opacity .18s ease, transform .18s ease';
    window.setTimeout(() => toast.remove(), 190);
  };

  toast.querySelector('[data-toast-close]')?.addEventListener('click', dismiss);
  window.setTimeout(dismiss, 7000);
});
