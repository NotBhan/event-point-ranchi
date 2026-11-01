import { searchRanchiPlaces } from '../core/venues/ranchi';

/**
 * Accessible combobox for the venue field. Suggestions assist typing; the
 * customer can always submit a venue that is not in the list.
 */
function init(): void {
  const input = document.querySelector<HTMLInputElement>('#venueLocation');
  if (!input) return;

  const list = document.createElement('ul');
  list.id = 'venueSuggestions';
  list.className = 'venue-suggestions';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  input.insertAdjacentElement('afterend', list);

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', list.id);
  input.setAttribute('autocomplete', 'off');

  let items: string[] = [];
  let active = -1;

  const close = (): void => {
    list.hidden = true;
    list.innerHTML = '';
    items = [];
    active = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };

  const highlight = (index: number): void => {
    active = index;
    [...list.children].forEach((child, i) => {
      const option = child as HTMLElement;
      const selected = i === index;
      option.setAttribute('aria-selected', selected ? 'true' : 'false');
      option.classList.toggle('is-active', selected);
    });
    if (items[index]) input.setAttribute('aria-activedescendant', `venue-option-${index}`);
    else input.removeAttribute('aria-activedescendant');
  };

  const choose = (name: string): void => {
    input.value = name;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    close();
    input.focus();
  };

  const render = (): void => {
    const suggestions = searchRanchiPlaces(input.value);
    items = suggestions.map((s) => s.name);

    if (suggestions.length === 0) {
      close();
      return;
    }

    list.innerHTML = '';
    suggestions.forEach((suggestion, index) => {
      const option = document.createElement('li');
      option.id = `venue-option-${index}`;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      option.dataset.value = suggestion.name;
      option.innerHTML = `<span class="venue-suggestion-name"></span><span class="venue-suggestion-kind"></span>`;
      option.querySelector('.venue-suggestion-name')!.textContent = suggestion.name;
      option.querySelector('.venue-suggestion-kind')!.textContent =
        suggestion.kind === 'venue' ? 'Venue' : 'Area';
      option.addEventListener('mousedown', (event) => {
        event.preventDefault();
        choose(suggestion.name);
      });
      list.append(option);
    });

    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    highlight(-1);
  };

  input.addEventListener('input', render);

  input.addEventListener('keydown', (event) => {
    if (list.hidden) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      highlight((active + 1) % items.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      highlight(active <= 0 ? items.length - 1 : active - 1);
    } else if (event.key === 'Enter' && active >= 0) {
      event.preventDefault();
      choose(items[active]);
    } else if (event.key === 'Escape') {
      close();
    }
  });

  input.addEventListener('blur', () => {
    window.setTimeout(close, 120);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
