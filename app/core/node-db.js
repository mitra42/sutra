// The shared core talks to SQLite through this small interface, so the same core runs on Node's
// built-in SQLite here and on the browser build of SQLite in the PWA.
import { DatabaseSync } from 'node:sqlite';

export function openNodeDb(path = ':memory:') {
  const raw = new DatabaseSync(path);
  const prepared = new Map();
  let depth = 0;

  function statement(sql, keep) {
    if (!keep) return raw.prepare(sql);
    let s = prepared.get(sql);
    if (!s) {
      s = raw.prepare(sql);
      prepared.set(sql, s);
    }
    return s;
  }

  return {
    exec: (sql) => raw.exec(sql),
    run: (sql, params = []) => statement(sql, true).run(...params),
    all: (sql, params = []) => statement(sql, true).all(...params),
    get: (sql, params = []) => statement(sql, true).get(...params),
    // For SQL built from a user's query: not kept, or every saved search would stay in memory.
    allOnce: (sql, params = []) => statement(sql, false).all(...params),
    function: (name, fn, options = {}) => raw.function(name, { deterministic: !!options.deterministic, varargs: true }, fn),
    transaction(fn) {
      if (depth > 0) return fn();
      raw.exec('BEGIN');
      depth += 1;
      try {
        const result = fn();
        raw.exec('COMMIT');
        return result;
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      } finally {
        depth -= 1;
      }
    },
    close: () => raw.close(),
  };
}
