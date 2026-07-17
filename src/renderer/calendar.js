(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JUNGLE_CALENDAR = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const DAY_MS = 24 * 60 * 60 * 1000;

  function parseDateKey(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) return null;
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function dateKey(date) {
    const value = new Date(date);
    return [value.getFullYear(), String(value.getMonth() + 1).padStart(2, '0'), String(value.getDate()).padStart(2, '0')].join('-');
  }

  function addDays(date, amount) {
    const value = new Date(date);
    value.setDate(value.getDate() + amount);
    value.setHours(0, 0, 0, 0);
    return value;
  }

  function dayDifference(left, right) {
    return Math.round((Date.UTC(left.getFullYear(), left.getMonth(), left.getDate()) - Date.UTC(right.getFullYear(), right.getMonth(), right.getDate())) / DAY_MS);
  }

  function validMonthDay(value) {
    const match = String(value || '').match(/^(\d{2})-(\d{2})$/);
    if (!match) return '';
    const date = new Date(2000, Number(match[1]) - 1, Number(match[2]));
    return date.getMonth() === Number(match[1]) - 1 && date.getDate() === Number(match[2]) ? String(value) : '';
  }

  function occursOn(event, date) {
    const target = new Date(date);
    target.setHours(0, 0, 0, 0);
    const end = parseDateKey(event?.repeatUntil);
    if (end && target > end) return false;
    const monthDay = validMonthDay(event?.monthDay || (event?.repeat === 'yearly' ? String(event?.date || '').slice(5) : ''));
    if (event?.repeat === 'yearly' && monthDay) return dateKey(target).slice(5) === monthDay;
    const start = parseDateKey(event?.date);
    if (!start || target < start) return false;
    const elapsed = dayDifference(target, start);
    switch (event?.repeat) {
      case 'daily': return true;
      case 'weekly': return elapsed % 7 === 0;
      case 'monthly': return target.getDate() === start.getDate();
      case 'yearly': return target.getMonth() === start.getMonth() && target.getDate() === start.getDate();
      default: return elapsed === 0;
    }
  }

  function listOccurrences(events, reference = new Date(), horizonDays = 90, limit = 200) {
    const today = new Date(reference);
    today.setHours(0, 0, 0, 0);
    const result = [];
    const safeEvents = Array.isArray(events) ? events : [];
    for (let offset = 0; offset <= horizonDays && result.length < limit; offset += 1) {
      const date = addDays(today, offset);
      safeEvents.forEach((event) => {
        if (result.length < limit && occursOn(event, date)) result.push({ event, date, key: dateKey(date), daysFromToday: offset });
      });
    }
    return result.sort((a, b) => a.date - b.date || String(a.event.time || '').localeCompare(String(b.event.time || '')) || String(a.event.title || '').localeCompare(String(b.event.title || '')));
  }

  function pageItems(items, pageSize, page = 0) {
    const source = Array.isArray(items) ? items : [];
    const size = Math.max(1, Math.floor(Number(pageSize) || 1));
    const pageCount = Math.max(1, Math.ceil(source.length / size));
    const index = ((Math.floor(Number(page) || 0) % pageCount) + pageCount) % pageCount;
    return { items: source.slice(index * size, index * size + size), page: index, pageCount, total: source.length };
  }

  function marqueeDuration(distance, pixelsPerSecond = 38) {
    const pixels = Math.max(0, Number(distance) || 0);
    const speed = Math.max(1, Number(pixelsPerSecond) || 38);
    return pixels > 0 ? Math.max(2200, Math.ceil(pixels / speed * 1000)) : 0;
  }

  return { parseDateKey, dateKey, addDays, validMonthDay, occursOn, listOccurrences, pageItems, marqueeDuration };
});
