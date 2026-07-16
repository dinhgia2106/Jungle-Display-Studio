(() => {
  const frames = new Set();
  const MAX_RETRIES = 5;

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

  function scheduleRetry(frame, delay = 12000) {
    clearRetry(frame);
    frame.__jungleRetryTimer = setTimeout(() => {
      if (!frame.isConnected || frame.dataset.youtubeLoaded === '1') {
        frames.delete(frame);
        return;
      }
      const attempt = Number(frame.dataset.youtubeAttempt || 0) + 1;
      frame.dataset.youtubeAttempt = String(attempt);
      if (attempt > MAX_RETRIES) return;
      const id = frame.dataset.youtubeId;
      frame.dataset.youtubeLoaded = '0';
      frame.src = embedUrl(id, Date.now() + '-' + attempt);
      scheduleRetry(frame, Math.min(30000, 10000 + attempt * 4000));
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
    frames.add(frame);
    frame.addEventListener('load', () => {
      frame.dataset.youtubeLoaded = '1';
      clearRetry(frame);
      setTimeout(() => frame.isConnected && requestPlayerEvents(frame), 250);
    });
    scheduleRetry(frame);
  }

  window.addEventListener('message', (event) => {
    let hostname = '';
    try { hostname = new URL(event.origin).hostname; } catch { return; }
    if (!/youtube(?:-nocookie)?\.com$/i.test(hostname)) return;
    const frame = [...frames].find((candidate) => candidate.isConnected && candidate.contentWindow === event.source);
    if (!frame) return;
    let data = event.data;
    try { if (typeof data === 'string') data = JSON.parse(data); } catch { return; }
    if (data?.event === 'onError') {
      frame.dataset.youtubeLoaded = '0';
      scheduleRetry(frame, 1500);
      return;
    }
    if (['onReady', 'infoDelivery', 'initialDelivery'].includes(data?.event)) {
      frame.dataset.youtubeReady = '1';
      clearRetry(frame);
      post(frame, { event: 'command', func: 'playVideo', args: [] });
    }
  });

  window.JUNGLE_YOUTUBE = Object.freeze({ embedUrl, watch });
})();