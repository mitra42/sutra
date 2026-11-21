// Repeats, kept as a short code in the card's "repeat" field.
//   none
//   daily, weekly, monthly         counted from the day the task is done
//   3d, 2w, 6m                     every so many days, weeks or months, counted from the day done
//   mon, mon+thu, weekdays         on those days of the week
//   m1, m15, mlast                 on that day of each month (mlast: the last day)
// A calendar repeat moves to the first matching date after the day the task was done.

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const FIXED = { daily: [0, 1], weekly: [0, 7], monthly: [1, 0] };

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function addMonths(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

function lastDayOf(year, month) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function weekdaysOf(code) {
  if (code === 'weekdays') return [1, 2, 3, 4, 5];
  const parts = code.split('+');
  return parts.every((p) => DAYS.includes(p)) ? parts.map((p) => DAYS.indexOf(p)) : null;
}

function monthDayOf(code) {
  const m = /^m([1-9]|[12]\d|3[01]|last)$/.exec(code);
  return m ? m[1] : null;
}

export function isRepeat(code) {
  if (!code || code === 'none') return false;
  return !!(FIXED[code] || /^[1-9]\d{0,2}[dwm]$/.test(code) || weekdaysOf(code) || monthDayOf(code));
}

// The due date after a task with this repeat is done on `done`.
export function nextDate(code, done) {
  if (FIXED[code]) return FIXED[code][0] ? addMonths(done, FIXED[code][0]) : addDays(done, FIXED[code][1]);
  const every = /^([1-9]\d{0,2})([dwm])$/.exec(code);
  if (every) {
    const n = Number(every[1]);
    return every[2] === 'm' ? addMonths(done, n) : addDays(done, every[2] === 'w' ? 7 * n : n);
  }
  const weekdays = weekdaysOf(code);
  if (weekdays) {
    for (let i = 1; i <= 7; i += 1) {
      const day = addDays(done, i);
      if (weekdays.includes(new Date(`${day}T00:00:00Z`).getUTCDay())) return day;
    }
  }
  const monthDay = monthDayOf(code);
  if (monthDay) {
    const d = new Date(`${done}T00:00:00Z`);
    for (let i = 0; i < 3; i += 1) {
      const year = d.getUTCFullYear();
      const month = d.getUTCMonth() + i;
      const last = lastDayOf(year, month);
      // A day the month does not have (the 31st of June) falls on its last day.
      const day = monthDay === 'last' ? last : Math.min(Number(monthDay), last);
      const candidate = new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
      if (candidate > done) return candidate;
    }
  }
  return null;
}

// What a person types, as a code: "3 days", "2w", "mon thu", "Monday and Thursday", "weekdays",
// "1st", "15", "last". Returns null if it cannot be read.
export function parseRepeat(text) {
  const t = String(text || '').trim().toLowerCase().replace(/^every\s+/, '').replace(/^on\s+(the\s+)?/, '');
  if (!t) return null;
  if (t === 'none' || FIXED[t]) return t;
  if (t === 'day') return 'daily';
  if (t === 'week') return 'weekly';
  if (t === 'month') return 'monthly';
  const every = /^([1-9]\d{0,2})\s*(d|days?|w|weeks?|m|months?)$/.exec(t);
  if (every) return `${every[1]}${every[2][0]}`;
  if (/^week\s*days?$|^weekdays$/.test(t)) return 'weekdays';
  const days = t.split(/[\s,+&/]+|\band\b/).filter(Boolean).map((w) => DAYS.findIndex((d) => w.startsWith(d)));
  if (days.length && days.every((i) => i >= 0)) return [...new Set(days)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((i) => DAYS[i]).join('+');
  if (/^last(\s+day)?(\s+of(\s+(the|each))?\s+month)?$/.test(t)) return 'mlast';
  const day = /^([1-9]|[12]\d|3[01])(st|nd|rd|th)?(\s+of(\s+(the|each))?\s+month)?$/.exec(t);
  if (day) return `m${day[1]}`;
  return null;
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

// The code in words, for showing.
export function repeatWords(code) {
  if (!code || code === 'none') return 'none';
  if (FIXED[code]) return code;
  const every = /^(\d+)([dwm])$/.exec(code);
  if (every) {
    const unit = { d: 'day', w: 'week', m: 'month' }[every[2]];
    return every[1] === '1' ? `every ${unit}` : `every ${every[1]} ${unit}s`;
  }
  if (code === 'weekdays') return 'every weekday';
  const weekdays = weekdaysOf(code);
  if (weekdays) {
    const names = weekdays.map((i) => (weekdays.length > 2 ? DAY_NAMES[i].slice(0, 3) : DAY_NAMES[i]));
    return `every ${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]}`;
  }
  const monthDay = monthDayOf(code);
  if (monthDay) return monthDay === 'last' ? 'last day of the month' : `${ordinal(Number(monthDay))} of the month`;
  return code;
}
