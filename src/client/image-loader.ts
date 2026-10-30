/**
 * Progressive Image Loader & Zero-CLS Skeleton Manager
 * Ensures smooth image fades, avoids skeleton flash on cached images,
 * and displays graceful fallback states on network or media errors.
 */

function setupProgressiveMedia() {
  const mediaContainers = document.querySelectorAll<HTMLElement>('.media-with-skeleton');

  mediaContainers.forEach((container) => {
    const img = container.querySelector('img');
    if (!img) return;

    // Check if the image has already finished loading (cached)
    if (img.complete) {
      if (img.naturalHeight > 0) {
        container.classList.add('is-loaded');
        container.classList.remove('is-failed');
      } else {
        container.classList.add('is-failed');
        container.classList.remove('is-loaded');
      }
      return;
    }

    // Otherwise attach event listeners
    const handleLoad = () => {
      container.classList.add('is-loaded');
      container.classList.remove('is-failed');
      img.removeEventListener('load', handleLoad);
      img.removeEventListener('error', handleError);
    };

    const handleError = () => {
      container.classList.add('is-failed');
      container.classList.remove('is-loaded');
      img.removeEventListener('load', handleLoad);
      img.removeEventListener('error', handleError);
    };

    img.addEventListener('load', handleLoad, { once: true });
    img.addEventListener('error', handleError, { once: true });
  });
}

// Initialize on initial page load and on Astro view transitions
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupProgressiveMedia);
} else {
  setupProgressiveMedia();
}

document.addEventListener('astro:page-load', setupProgressiveMedia);

export { setupProgressiveMedia };
