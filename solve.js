// A fast drop-in replacement for csv-reader 1.0.0, written for
// make.fun's csv-reader-speed-01. run(input) returns exactly the answer
// csv-reader 1.0.0 returns for every input — {columns, rows, errors} —
// under csv-reader's own broken-row policy:
//
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters
//     is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is
//     not doubled ("" inside it is one quote; each CRLF or lone CR
//     inside it is read as LF); what follows its closing quote, up to
//     the next comma or line break, is appended as it stands
//     (quote_junk, when anything was appended); a quote that never
//     closes is a literal character and the text after it is read
//     again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields
//     stay strings, never trimmed or converted;
//   - columns is the first record when header is true, else null;
//     rows holds the records after it (every record when header is
//     false), each padded with "" (short_row) or cut (long_row) to
//     the first record's width;
//   - each error is {code, line, row} in the order met: line the
//     1-based line its record starts on (every LF, CRLF and lone CR
//     inside quotes counted), row its record's index in rows, null
//     for the header.
//
// Where the speed comes from: the reference reads one character at a
// time and builds every field one character at a time. This reader
// never builds a field character by character. An unquoted field is
// found by one scan for the next comma or line break and taken with a
// single slice; a quoted field is found by jumping between the few
// characters that matter inside quotes (the next quote, the next CR)
// with indexOf, again sliced whole. Only a field that actually holds
// a dropped stray CR or an escaped quote pays for joining segments.
// The field readers report through three registers (fVal, fEnd,
// fQuoted) instead of allocating a result object per field.

/** How the field just read ended: 0 at a comma, 1 at a line break, 2 at the end of the text. */
const ENDED_COMMA = 0;
const ENDED_BREAK = 1;
const ENDED_END = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (n !== 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in
  // rows it takes (null: the header). Every error of the record is
  // reported against these two, however far into the record it sits.
  let recordLine = 1;
  let recordRow = null;

  // Registers for the field just read.
  let fVal = '';
  let fEnd = ENDED_END;
  let fQuoted = false;
  // Characters the last unquoted reading kept, not counting any
  // initial value it was handed: quote_junk is met only when the junk
  // after a closing quote kept at least one character.
  let uAdded = 0;

  // Reads unquoted characters from pos onto `init`, up to the next
  // comma or line break: a CR not followed by LF is dropped
  // (stray_cr). Sets fVal and fEnd, and uAdded to the number of
  // characters kept past `init`.
  function readUnquoted(init) {
    let parts = null; // segments kept so far, once a stray CR splits the field
    let seg = pos; // where the current unbroken segment starts
    let i = pos;
    uAdded = 0;
    for (;;) {
      while (i < n) {
        const cc = text.charCodeAt(i);
        if (cc === 44 || cc === 10 || cc === 13) break; // , \n \r
        i += 1;
      }
      if (i >= n) {
        uAdded += n - seg;
        fVal = parts === null ? init + text.slice(seg, n) : init + parts.join('') + text.slice(seg, n);
        pos = n;
        fEnd = ENDED_END;
        return;
      }
      const cc = text.charCodeAt(i);
      if (cc === 44) {
        uAdded += i - seg;
        fVal = parts === null ? init + text.slice(seg, i) : init + parts.join('') + text.slice(seg, i);
        pos = i + 1;
        fEnd = ENDED_COMMA;
        return;
      }
      if (cc === 10) {
        uAdded += i - seg;
        fVal = parts === null ? init + text.slice(seg, i) : init + parts.join('') + text.slice(seg, i);
        pos = i + 1;
        line += 1;
        fEnd = ENDED_BREAK;
        return;
      }
      // cc is a CR: a CRLF ends the field, a lone CR is dropped.
      if (text.charCodeAt(i + 1) === 10) {
        uAdded += i - seg;
        fVal = parts === null ? init + text.slice(seg, i) : init + parts.join('') + text.slice(seg, i);
        pos = i + 2;
        line += 1;
        fEnd = ENDED_BREAK;
        return;
      }
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      if (parts === null) parts = [];
      parts.push(text.slice(seg, i));
      uAdded += i - seg;
      i += 1;
      seg = i;
    }
  }

  // Reads a quoted field whose opening quote is at pos. Sets fVal and
  // fEnd. A quote that never closes makes the opening quote a literal
  // character and hands the rest back to the unquoted reader.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let parts = null; // segments kept so far, once an escape or a CR splits the field
    let seg = open + 1; // where the current unbroken segment starts
    let p = open + 1;
    for (;;) {
      const iQuote = text.indexOf('"', p);
      const iCr = text.indexOf('\r', p);
      let i = -1;
      let isQuote = false;
      if (iQuote !== -1) {
        i = iQuote;
        isQuote = true;
      }
      if (iCr !== -1 && (i === -1 || iCr < i)) {
        i = iCr;
        isQuote = false;
      }
      if (i === -1) {
        // No closing quote anywhere: the quote is a literal character
        // and the text after it is read again as unquoted. The line
        // count rewinds to the line the quote opened on, as the
        // reference's does, so the re-read counts its breaks afresh.
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        readUnquoted('"');
        return;
      }
      // LFs inside the segment are content, but each one still moves
      // the line count for the records that follow.
      let lf = text.indexOf('\n', p);
      while (lf !== -1 && lf < i) {
        line += 1;
        lf = text.indexOf('\n', lf + 1);
      }
      if (isQuote) {
        if (text.charCodeAt(i + 1) === 34) {
          // A doubled quote: one literal quote in the value.
          if (parts === null) parts = [];
          parts.push(text.slice(seg, i), '"');
          p = i + 2;
          seg = p;
          continue;
        }
        // The closing quote.
        fVal = parts === null ? text.slice(seg, i) : parts.join('') + text.slice(seg, i);
        pos = i + 1;
        if (pos >= n) {
          fEnd = ENDED_END;
          return;
        }
        const c = text.charCodeAt(pos);
        if (c === 44) {
          pos += 1;
          fEnd = ENDED_COMMA;
          return;
        }
        if (c === 10) {
          pos += 1;
          line += 1;
          fEnd = ENDED_BREAK;
          return;
        }
        if (c === 13 && text.charCodeAt(pos + 1) === 10) {
          pos += 2;
          line += 1;
          fEnd = ENDED_BREAK;
          return;
        }
        // What follows the closing quote is appended as it stands,
        // up to the next comma or line break.
        readUnquoted(fVal);
        if (uAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
        return;
      }
      // A CR inside quotes: CRLF and a lone CR are each read as one LF.
      if (parts === null) parts = [];
      parts.push(text.slice(seg, i), '\n');
      line += 1;
      p = text.charCodeAt(i + 1) === 10 ? i + 2 : i + 1;
      seg = p;
    }
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const cc = text.charCodeAt(pos);
      if (cc === 10) {
        pos += 1;
        line += 1;
      } else if (cc === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    for (;;) {
      fQuoted = text.charCodeAt(pos) === 34;
      if (fQuoted) readQuoted();
      else readUnquoted('');
      fields.push(fVal);
      if (fEnd !== ENDED_COMMA) break;
    }

    // A line that held only stray CRs is left with no characters: no
    // record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !fQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      const extra = fields.slice(width);
      fields.length = width;
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
