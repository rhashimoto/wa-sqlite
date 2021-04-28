import * as SQLite from './sqlite-api.js';

/**
 * Template tag builder. This function creates a tag with an API and
 * database from the same module, then the tag can be used like this:
 * ```
 * const sql = tag(sqlite3, db);
 * const results = await sql`SELECT 1 + 1; SELECT 6 * 7;`;
 * ```
 * The returned Promise value contains an array of results for each
 * SQL statement that produces output.
 * @param {SQLite.SQLiteAPI} sqlite3 
 * @param {number} db
 * @returns {function(TemplateStringsArray, ...any): Promise<object>}
 */
 export function tag(sqlite3, db) {
  return async function(strings, ...values) {
    let interleaved = [];
    strings.forEach((s, i) => {
      interleaved.push(s, values[i]);
    });

    // Transfer the SQL to WASM memory. We set up a try-finally block
    // to ensure that the memory is always freed.
    let results = [];
    const str = sqlite3.str_new(db, interleaved.join(''));
    try {
      // Initialize the prepared statement state that will evolve
      // as we progress through the SQL.
      /** @type {*} */ let prepared = { sql: sqlite3.str_value(str) };
      while (true) {
        // Prepare the next statement. Another try-finally goes here
        // to ensure that each prepared statement is finalized.
        if (!(prepared = await sqlite3.prepare_v2(db, prepared.sql))) {
          break;
        }
        try {
          // Step through the rows.
          const rows = [];
          const columns = sqlite3.column_names(prepared.stmt)
          while (await sqlite3.step(prepared.stmt) === SQLite.SQLITE_ROW) {
            // Collect row elements.
            const row = sqlite3.row(prepared.stmt);
            rows.push(row);
          }
          if (columns.length) {
            results.push({ columns, rows });
          }
        } finally {
          sqlite3.finalize(prepared.stmt);
        }
      }
    } finally {
      sqlite3.str_finish(str);
    }
    return results;
  }
}