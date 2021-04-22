// @ts-ignore
import SQLiteFactory from '../dist/wa-sqlite-async.mjs';
import { Database } from './Database.js';

// This is so we only have one SQLite instance across all test files.
export const SQLiteReady = SQLiteFactory();

// Do any global initialization so tests don't need to repeat it.
SQLiteReady.then(SQLite => {
  Database.initialize(SQLite);
});

export { Database };