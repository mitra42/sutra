// The same small interface as core/node-db.js, over SQLite running in the browser, so the shared
// core runs here unchanged. Must be used from a worker.

export async function openBrowserDb(sqlite3InitModule, name) {
  const sqlite3 = await sqlite3InitModule();
  let db;
  let method;
  if (sqlite3.oo1.OpfsDb) {
    // Several tabs can share it. Needs the two isolation headers the server sends.
    db = new sqlite3.oo1.OpfsDb(`/${name}.db`);
    method = 'opfs';
  } else {
    // One tab at a time. What the iPhone uses (stage 0).
    const pool = await sqlite3.installOpfsSAHPoolVfs({ name });
    db = new pool.OpfsSAHPoolDb(`/${name}.db`);
    method = 'sahpool';
  }
  // Another tab may be writing: wait for it rather than fail.
  db.exec('PRAGMA busy_timeout = 8000');
  let depth = 0;

  const clean = (params) => params.map((p) => (p === undefined ? null : p));
  const all = (sql, params = []) => db.exec({
    sql, bind: params.length ? clean(params) : undefined, rowMode: 'object', returnValue: 'resultRows',
  });

  return {
    method,
    exec: (sql) => { db.exec(sql); },
    run: (sql, params = []) => {
      db.exec({ sql, bind: params.length ? clean(params) : undefined });
      return {};
    },
    all,
    allOnce: all,
    get: (sql, params = []) => all(sql, params)[0],
    function: (fname, fn, options = {}) => db.createFunction({
      name: fname, arity: -1, deterministic: !!options.deterministic, xFunc: (ctx, ...args) => fn(...args),
    }),
    transaction(fn) {
      if (depth > 0) return fn();
      // IMMEDIATE takes the write lock at the start, so two tabs cannot each begin and then block
      // one another half way through.
      db.exec('BEGIN IMMEDIATE');
      depth += 1;
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      } finally {
        depth -= 1;
      }
    },
  };
}
