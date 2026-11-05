import {
  popularRanchiPlaces,
  searchRanchiPlaces,
  type VenueSuggestion,
} from '../core/venues/ranchi';
import { mergeVenueSuggestions } from '../core/venues/map-search';

/**
 * Accessible combobox for the venue field. Curated localities answer
 * immediately; a debounced server proxy adds map results from OpenStreetMap.
 * The customer can always submit a venue that is not in the list.
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

  let items: VenueSuggestion[] = [];
  let active = -1;
  let mapTimer: ReturnType<typeof setTimeout> | null = null;
  let mapController: AbortController | null = null;
  let requestVersion = 0;
  let suppressRender = false;

  const close = (): void => {
    requestVersion += 1;
    if (mapTimer) {
      clearTimeout(mapTimer);
      mapTimer = null;
    }
    mapController?.abort();
    mapController = null;
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
    suppressRender = true;
    input.value = name;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    close();
  };

  const paint = (suggestions: VenueSuggestion[]): void => {
    items = suggestions;
    if (suggestions.length === 0) {
      list.hidden = true;
      list.innerHTML = '';
      active = -1;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      return;
    }

    list.innerHTML = '';
    suggestions.forEach((suggestion, index) => {
      const option = document.createElement('li');
      option.id = `venue-option-${index}`;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      option.dataset.value = suggestion.name;
      option.innerHTML = '<span class="venue-suggestion-name"></span><span class="venue-suggestion-kind"></span>';
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

  const render = (): void => {
    if (suppressRender) {
      suppressRender = false;
      return;
    }

    const query = input.value.trim();
    const local = query.length === 0
      ? popularRanchiPlaces(8)
      : query.length >= 2
        ? searchRanchiPlaces(query, 8)
        : [];

    paint(local);
    requestVersion += 1;
    if (mapTimer) {
      clearTimeout(mapTimer);
      mapTimer = null;
    }
    mapController?.abort();
    mapController = null;

    if (query.length < 2) return;

    const version = requestVersion;
    const controller = new AbortController();
    mapController = controller;
    mapTimer = setTimeout(async () => {
      mapTimer = null;
      try {
        const response = await fetch(`/api/places?q=${encodeURIComponent(query)}`, {
          headers: { accept: 'application/json' },
          signal: controller.signal,
        });
        if (!response.ok) return;
        const payload = (await response.json()) as { suggestions?: unknown };
        if (version !== requestVersion) return;
        const mapped = Array.isArray(payload.suggestions)
          ? payload.suggestions.filter(
              (entry): entry is VenueSuggestion =>
                Boolean(entry) &&
                typeof entry === 'object' &&
                typeof (entry as VenueSuggestion).name === 'string' &&
                ((entry as VenueSuggestion).kind === 'area' || (entry as VenueSuggestion).kind === 'venue'),
            )
          : [];
        if (mapped.length > 0) paint(mergeVenueSuggestions(local, mapped, 10));
      } catch {
        // Local fuzzy suggestions remain available when the map service is unreachable.
      }
    }, 180);
  };

  input.addEventListener('input', render);
  input.addEventListener('focus', () => {
    if (list.hidden) render();
  });

  input.addEventListener('keydown', (event) => {
    if (list.hidden) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      highlight((active + 1) % items.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      highlight((active <= 0 ? items.length - 1 : active - 1));
    } else if (event.key === 'Enter' && active >= 0) {
      event.preventDefault();
      choose(items[active].name);
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
