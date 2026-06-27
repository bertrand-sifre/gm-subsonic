/**
 * Enveloppe de réponse Subsonic + sérialisation XML **et** JSON (`?f=json`) à
 * partir d'une même structure `SNode`. Convention Subsonic :
 *  - les scalaires deviennent des ATTRIBUTS (XML) / propriétés (JSON) ;
 *  - un enfant unique (`objects`) → élément/objet ;
 *  - un enfant répétable (`lists`) → éléments répétés (XML) / tableau (JSON).
 */

import type { Context } from 'hono';

type Scalar = string | number | boolean | undefined;

export interface SNode {
  attrs?: Record<string, Scalar>;
  objects?: Record<string, SNode>;
  lists?: Record<string, SNode[]>;
  text?: string;
}

const API_VERSION = '1.16.1';
const SERVER_TYPE = 'vdm-subsonic';
const SERVER_VERSION = '0.1.0';

function escapeXml(v: string): string {
  return v.replace(/[<>&"']/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c === '"' ? '&quot;' : '&apos;'
  );
}

function nodeToXml(name: string, n: SNode): string {
  const attrs = Object.entries(n.attrs ?? {})
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${escapeXml(String(v))}"`)
    .join('');
  let inner = '';
  for (const [k, child] of Object.entries(n.objects ?? {})) inner += nodeToXml(k, child);
  for (const [k, arr] of Object.entries(n.lists ?? {})) for (const c of arr) inner += nodeToXml(k, c);
  if (n.text != null) inner += escapeXml(n.text);
  return inner ? `<${name}${attrs}>${inner}</${name}>` : `<${name}${attrs}/>`;
}

function nodeToJson(n: SNode): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(n.attrs ?? {})) if (v !== undefined) o[k] = v;
  for (const [k, child] of Object.entries(n.objects ?? {})) o[k] = nodeToJson(child);
  for (const [k, arr] of Object.entries(n.lists ?? {})) o[k] = arr.map(nodeToJson);
  if (n.text != null) o.value = n.text;
  return o;
}

/** Réponse OK, avec un payload optionnel nommé (ex. `artists`, `album`). */
export function ok(c: Context, payloadName?: string, payload?: SNode): Response {
  return send(c, 'ok', payloadName, payload);
}

/** Réponse d'erreur Subsonic (codes : 10 param manquant, 70 introuvable, 0 générique). */
export function failed(c: Context, code: number, message: string): Response {
  return send(c, 'failed', 'error', { attrs: { code, message } });
}

function send(c: Context, status: 'ok' | 'failed', payloadName?: string, payload?: SNode): Response {
  const base = {
    status,
    version: API_VERSION,
    type: SERVER_TYPE,
    serverVersion: SERVER_VERSION,
    openSubsonic: true as const,
  };

  if (c.req.query('f') === 'json') {
    const inner: Record<string, unknown> = { ...base };
    if (payloadName && payload) inner[payloadName] = nodeToJson(payload);
    return c.json({ 'subsonic-response': inner });
  }

  const root: SNode = { attrs: { xmlns: 'http://subsonic.org/restapi', ...base } };
  if (payloadName && payload) root.objects = { [payloadName]: payload };
  const xml = '<?xml version="1.0" encoding="UTF-8"?>' + nodeToXml('subsonic-response', root);
  return c.body(xml, 200, { 'Content-Type': 'application/xml; charset=UTF-8' });
}
