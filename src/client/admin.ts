const shell = document.getElementById('adminShell');
document.querySelector('[data-admin-toggle]')?.addEventListener('click', () => {
  shell?.classList.toggle('sidebar-open');
});

document.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-confirm]');
  if (target) {
    const message = target.dataset.confirm || 'Are you sure?';
    if (!window.confirm(message)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }
});

document.querySelectorAll<HTMLInputElement>('input[type="file"]').forEach((input) => {
  input.addEventListener('change', () => {
    const label = input.closest('.field')?.querySelector<HTMLElement>('[data-file-name]');
    if (label) label.textContent = input.files?.[0]?.name ?? 'No file chosen';
  });
});

document.querySelectorAll<HTMLSelectElement>('[data-auto-submit]').forEach((select) => {
  select.addEventListener('change', () => select.form?.submit());
});
