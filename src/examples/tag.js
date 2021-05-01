import * as SQLite from '../sqlite-api.js';

/**
 * Template tag builder. This function creates a tag with an API and
 * database from the same module, then the tag can be used like this:
 * ```
 * const sql = tag(sqlite3, db);
 * const results = await sql`
 *   SELECT 1 + 1;
 *   SELECT 6 * 7;
 * `;
 * ```
 * The returned Promise value contains an array of results for each
 * SQL statement that produces output. Each result is an object with
 * properties `columns` (array of names) and `rows` (array of array
 * of values).
 * @param {SQLite.SQLiteAPI} sqlite3 
 * @param {number} db
 * @returns {function(TemplateStringsArray, ...any): Promise<object[]>}
 */
 export function tag(sqlite3, db) {
  return async function(strings, ...values) {
    // Assemble the template string components.
    const interleaved = [];
    strings.forEach((s, i) => {
      interleaved.push(s, values[i]);
    });
    const sql = interleaved.join('');

    // Transfer the SQL to WASM memory. We set up a try-finally block
    // to ensure that the memory is always freed.
    const results = [];
    const str = sqlite3.str_new(db, sql);
    try {
      // Traverse and prepare the SQL, statement by statement.
      /** @type {object} */ let prepared = { sql: sqlite3.str_value(str) };
      while ((prepared = await sqlite3.prepare_v2(db, prepared.sql))) {
        // Another try-finally goes here to ensure that each prepared
        // statement is finalized.
        try {
          // Step through the rows produced by the statement.
          const rows = [];
          const columns = sqlite3.column_names(prepared.stmt)
          while (await sqlite3.step(prepared.stmt) === SQLite.SQLITE_ROW) {
            // Collect row elements. sqlite3.row is an API convenience
            // function (not in the C API) that extracts values for all
            // the columns of the row.
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