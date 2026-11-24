// BR-17: references to model items in links and stored layouts.
//
// A model replaced with a new version of its file (API 2.3.0) keeps its XMI
// identifiers, but its items may get new database ids. Links and stored
// layouts therefore name an item by its XMI identifier where it has one, and
// by its id otherwise. A token of digits only is an id: an XMI identifier is an
// xs:ID (NCName), which cannot start with a digit, and one made through the API
// that consists of digits is written as the id instead.
//
// Tokens sit inside lists and fields separated by '.', '~', '_' and '!', so
// everything but letters, digits and '-' is written as '*' and two hex digits
// per UTF-8 byte. Archi's identifiers ("id-3f2a…") stay as they are.
//
// BR-18: a folder without an identifier (Archi exports none) is named by its
// path of labels from the top: '@', then the labels, escaped, joined by ':'
// ("@Application:ERP*20domain").

const KEEP = /^[A-Za-z0-9-]$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** True for a token that is a database id. */
export const isId = token => /^\d+$/.test(String(token));

/** An XMI identifier as a link token. */
export function escapeRef(xmi) {
  let out = '';
  for (const ch of String(xmi)) {
    if (KEEP.test(ch)) out += ch;
    else for (const b of encoder.encode(ch)) out += `*${b.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

/** A link token back to the XMI identifier it stands for. */
export function unescapeRef(token) {
  const s = String(token);
  if (!s.includes('*')) return s;
  const bytes = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '*' && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) { bytes.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 2; }
    else bytes.push(...encoder.encode(s[i]));
  }
  return decoder.decode(new Uint8Array(bytes));
}

/** The token for an item: its escaped XMI identifier, or its id when it has none (or one of digits only). */
export function tokenFor(id, xmiIdentifier) {
  return xmiIdentifier && !isId(xmiIdentifier) ? escapeRef(xmiIdentifier) : String(id);
}

/** True for a token that is a folder path (BR-18). */
export const isPath = token => String(token).startsWith('@');

/** The token of a folder path, from its labels (top first). */
export const pathToken = labels => `@${labels.map(escapeRef).join(':')}`;

/** The labels of a folder path token. */
export const labelsOf = token => String(token).slice(1).split(':').map(unescapeRef);
