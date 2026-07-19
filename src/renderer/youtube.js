(() => {
  const INITIAL_RETRY_DELAY = 12000;
  const MAX_RETRY_DELAY = 300000;

  function embedUrl(id, retryToken = '') {
    const params = new URLSearchParams({
      autoplay: '1',
      mute: '1',
      loop: '1',
      playlist: id,
      controls: '0',
      rel: '0',
      playsinline: '1',
      enablejsapi: '1',
      origin: 'https://localhost',
      widget_referrer: 'https://localhost/'
    });
    if (retryToken) params.set('jungle_retry', String(retryToken));
    return 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(id) + '?' + params.toString();
  }

  function post(frame, payload) {
    try {
      frame.contentWindow?.postMessage(JSON.stringify(payload), 'https://www.youtube-nocookie.com');
    } catch {
      // The watchdog will retry if the player never acknowledges the message.
    }
  }

  function clearRetry(frame) {
    if (frame.__jungleRetryTimer) clearTimeout(frame.__jungleRetryTimer);
    frame.__jungleRetryTimer = null;
  }

  function markHealthy(frame) {
    frame.dataset.youtubeReady = '1';
    frame.dataset.youtubeLoaded = '1';
    frame.dataset.youtubeAttempt = '0';
    clearRetry(frame);
    post(frame, { event: 'command', func: 'playVideo', args: [] });
  }

  function retryDelay(attempt) {
    if (attempt <= 5) return 10000 + attempt * 4000;
    return Math.min(MAX_RETRY_DELAY, 60000 * (2 ** Math.min(3, attempt - 6)));
  }

  function scheduleRetry(frame, delay = INITIAL_RETRY_DELAY) {
    clearRetry(frame);
    frame.__jungleRetryTimer = setTimeout(() => {
      frame.__jungleRetryTimer = null;
      if (!frame.isConnected || frame.dataset.youtubeLoaded === '1') {
        return;
      }
      const attempt = Number(frame.dataset.youtubeAttempt || 0) + 1;
      frame.dataset.youtubeAttempt = String(attempt);
      const id = frame.dataset.youtubeId;
      frame.dataset.youtubeLoaded = '0';
      frame.dataset.youtubeReady = '0';
      frame.dataset.youtubeErrored = '0';
      frame.dataset.youtubeReloading = '1';
      frame.src = embedUrl(id, Date.now() + '-' + attempt);
      scheduleRetry(frame, retryDelay(attempt));
    }, delay);
  }

  function requestPlayerEvents(frame) {
    post(frame, { event: 'listening', id: frame.id });
    post(frame, { event: 'command', func: 'mute', args: [] });
    post(frame, { event: 'command', func: 'playVideo', args: [] });
  }

  function watch(container) {
    const frame = container?.querySelector?.('iframe[data-youtube-id]');
    if (!frame || frame.__jungleWatched) return;
    frame.__jungleWatched = true;
    frame.id ||= 'jungle-youtube-' + Math.random().toString(36).slice(2);
    frame.dataset.youtubeErrored = '0';
    frame.dataset.youtubeReloading = '0';
    frame.addEventListener('load', () => {
      frame.dataset.youtubeReloading = '0';
      // A completed iframe navigation is stable unless the Player API reports
      // an explicit error. Do not periodically reload a video that is playing.
      if (frame.dataset.youtubeErrored !== '1') {
        markHealthy(frame);
      } else {
        frame.dataset.youtubeLoaded = '0';
        frame.dataset.youtubeReady = '0';
      }
      setTimeout(() => frame.isConnected && requestPlayerEvents(frame), 250);
    });
    scheduleRetry(frame);
  }

  function unwatch(container) {
    const watchedFrames = [];
    if (container?.matches?.('iframe[data-youtube-id]')) watchedFrames.push(container);
    container?.querySelectorAll?.('iframe[data-youtube-id]').forEach((frame) => watchedFrames.push(frame));
    watchedFrames.forEach((frame) => {
      clearRetry(frame);
      frame.__jungleWatched = false;
    });
  }

  window.addEventListener('message', (event) => {
    let hostname = '';
    try { hostname = new URL(event.origin).hostname; } catch { return; }
    if (!/youtube(?:-nocookie)?\.com$/i.test(hostname)) return;
    const frame = [...document.querySelectorAll('iframe[data-youtube-id]')]
      .find((candidate) => candidate.contentWindow === event.source);
    if (!frame) return;
    let data = event.data;
    try { if (typeof data === 'string') data = JSON.parse(data); } catch { return; }
    if (data?.event === 'onError') {
      frame.dataset.youtubeLoaded = '0';
      frame.dataset.youtubeReady = '0';
      frame.dataset.youtubeErrored = '1';
      scheduleRetry(frame, 1500);
      return;
    }
    if (['onReady', 'infoDelivery', 'initialDelivery'].includes(data?.event)) {
      // An errored player can continue emitting delivery messages. They are
      // stale health signals and must not cancel the recovery reload.
      if (frame.dataset.youtubeErrored === '1') return;
      markHealthy(frame);
    }
  });

  window.JUNGLE_YOUTUBE = Object.freeze({ embedUrl, watch, unwatch });
})();
