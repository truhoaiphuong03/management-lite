// Classify e-mail addresses that appear in Git history (all refs). Prints COUNTS and file paths only - never an address or domain.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import readline from 'node:readline';

const repo = process.argv[2];
const h8 = (s) =>
  crypto
    .createHash('sha256')
    .update(s.toLowerCase())
    .digest('hex')
    .slice(0, 10);
const emailRe =
  /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;
const publicProviders =
  /^(gmail\.com|googlemail\.com|outlook\.com|hotmail\.com|live\.com|yahoo\.[a-z.]+|icloud\.com|me\.com|proton\.me|protonmail\.com|zalo\.me)$/;
const reservedDomains =
  /(^|\.)(example\.(com|org|net|test)|example|test|invalid|localhost|local)$|^isolated\.example\.test$|users\.noreply\.github\.com$/;
const fixtureLocal =
  /(test|demo|sample|fake|dummy|qa|staff|owner|admin|user\d*|employee|nv\d+|noreply|no-reply|a@|b@)/i;

const cat = (f) =>
  /^\.data\//.test(f)
    ? 'data-export'
    : /^tests?\//.test(f)
      ? 'tests'
      : /^docs\//.test(f)
        ? 'docs'
        : /^AGENTS\.md$/.test(f)
          ? 'AGENTS.md'
          : /^scripts\//.test(f)
            ? 'scripts'
            : /^(apps|packages)\//.test(f)
              ? 'app-source'
              : 'other';

const addr = new Map(); // hash -> { gmail:boolean, domainClass, cats:Set, files:Set, localFixture:boolean }
let file = '';
const git = spawn(
  'git',
  [
    '-C',
    repo,
    'log',
    '--all',
    '-p',
    '-U0',
    '--no-color',
    '--no-ext-diff',
    '--format=@@C %h',
    '--',
    '.',
    ':(exclude)package-lock.json',
  ],
  { stdio: ['ignore', 'pipe', 'inherit'] },
);
const rl = readline.createInterface({ input: git.stdout, crlfDelay: Infinity });
rl.on('line', (line) => {
  if (line.startsWith('+++ ')) {
    file = line.slice(4).replace(/^b\//, '');
    return;
  }
  if (!line.startsWith('+') || line.startsWith('+++') || line.length > 4000)
    return;
  let m;
  emailRe.lastIndex = 0;
  while ((m = emailRe.exec(line))) {
    const dom = m[1].toLowerCase();
    const full = m[0];
    const key = h8(full);
    let e = addr.get(key);
    if (!e) {
      e = {
        domainClass: reservedDomains.test(dom)
          ? 'reserved'
          : publicProviders.test(dom)
            ? dom === 'gmail.com' || dom === 'googlemail.com'
              ? 'gmail'
              : 'public-provider'
            : 'custom-domain',
        cats: new Set(),
        files: new Set(),
        localFixture: fixtureLocal.test(full.split('@')[0] + '@'),
      };
      addr.set(key, e);
    }
    e.cats.add(cat(file));
    e.files.add(file);
  }
});
rl.on('close', () => {
  const classify = (e) => {
    if (e.domainClass === 'reserved') return 'FIXTURE_RESERVED_DOMAIN';
    if (e.cats.has('data-export')) return 'REAL_CONFIRMED_IN_DATA_EXPORT';
    const nonTest = [...e.cats].filter((c) => c !== 'tests');
    if (nonTest.length === 0)
      return e.localFixture
        ? 'FIXTURE_LIKELY_TEST_ONLY'
        : 'AMBIGUOUS_TEST_ONLY';
    return e.localFixture
      ? 'AMBIGUOUS_FIXTURE_NAME_IN_SOURCE_OR_DOCS'
      : 'REAL_LIKELY_IN_SOURCE_OR_DOCS';
  };
  const byClass = {};
  const filesByClass = {};
  const domainMix = {};
  for (const e of addr.values()) {
    const c = classify(e);
    byClass[c] = (byClass[c] || 0) + 1;
    domainMix[e.domainClass] = (domainMix[e.domainClass] || 0) + 1;
    filesByClass[c] = filesByClass[c] || new Set();
    for (const f of e.files) filesByClass[c].add(f);
  }
  const out = {
    distinct_addresses_total: addr.size,
    by_domain_class: domainMix,
    by_classification: byClass,
    files_by_classification: Object.fromEntries(
      Object.entries(filesByClass).map(([k, v]) => [k, [...v].sort()]),
    ),
    note: 'No address or domain is printed. REAL_* = treat as personal data; FIXTURE_* = test data; AMBIGUOUS_* = Owner must decide.',
  };
  console.log(JSON.stringify(out, null, 1));
});
