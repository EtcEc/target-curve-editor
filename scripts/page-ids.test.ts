import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

/** Each page and the scripts that look up elements on it. */
const PAGES: Record<string, string[]> = {
  'design.html': ['src/design/main.ts', 'src/bandsUi.ts', 'src/designUi.ts'],
  'correct.html': ['src/correct/main.ts'],
};

const LOOKUPS = [
  /getElementById\(\s*'([^']+)'\s*\)/g,
  /\bel(?:<[^>]*>)?\(\s*'([^']+)'\s*\)/g,
  /querySelector(?:All)?(?:<[^>]*>)?\(\s*'#([\w-]+)/g,
];

describe('page element ids', () => {
  for (const [page, scripts] of Object.entries(PAGES)) {
    it(`${page} has every id its scripts look up`, () => {
      const html = read(page);
      const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
      const missing: string[] = [];
      for (const script of scripts) {
        const source = read(script);
        for (const pattern of LOOKUPS) {
          for (const match of source.matchAll(pattern)) {
            if (!ids.has(match[1])) missing.push(`${script}: #${match[1]}`);
          }
        }
      }
      for (const match of html.matchAll(/data-for="([^"]+)"/g)) {
        if (!ids.has(match[1])) missing.push(`${page}: data-for="${match[1]}"`);
      }
      expect(missing).toEqual([]);
    });
  }
});
