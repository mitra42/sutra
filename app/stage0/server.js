#!/usr/bin/env node
// Sutra stage 0: serves the test pages on this machine only. Throwaway.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const port = process.env.PORT || 8480;
const app = express();

app.use((req, res, next) => {
  // These two headers are what lets several tabs share one SQLite database (the "opfs" method).
  res.set('Cross-Origin-Opener-Policy', 'same-origin');
  res.set('Cross-Origin-Embedder-Policy', 'require-corp');
  // Always revalidate, so editing a file and reloading shows the change.
  res.set('Cache-Control', 'no-cache');
  next();
});
// SQLite's browser build, straight from node_modules: no build step.
app.use('/sqlite', express.static(path.join(dir, 'node_modules/@sqlite.org/sqlite-wasm/dist')));
app.use(express.static(path.join(dir, 'public')));

// 127.0.0.1 only: nothing else on the network can reach it.
app.listen(port, '127.0.0.1', () => {
  console.log(`Sutra stage 0 tests: http://localhost:${port}/`);
});
