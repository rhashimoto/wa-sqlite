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
 * @param {SQLiteAPI} sqlite3 
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

    // Loop over the SQL statements. sqlite3.statements is an API
    // convenience function (not in the C API) that iterates over
    // compiled statements, automatically managing resources.
    const results = [];
    for await (const stmt of sqlite3.statements(db, sql)) {
      const rows = [];
      const columns = sqlite3.column_names(stmt);
      while (await sqlite3.step(stmt) === SQLite.SQLITE_ROW) {
        // Collect row elements. sqlite3.row is an API convenience
        // function (not in the C API) that extracts values for all
        // the columns of the row.
        const row = sqlite3.row(stmt);
        rows.push(row);
      }
      if (columns.length) {
        results.push({ columns, rows });
      }
    }
    return results;
  }
}