// W1.6: scan ALL Git history (all refs) for sensitive-data patterns. Prints COUNTS and file paths only. Never prints matched values.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import readline from 'node:readline';
const repo = process.argv[2];
const h8 = (s) =>
  crypto.createHash('sha256').update(s.toLowerCase()).digest('hex').slice(0, 8);

const cred = [
  ['google_api_key', /AIza[0-9A-Za-z_\-]{35}/],
  ['github_pat', /\b(ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,})/],
  ['slack_token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['aws_access_key', /\bAKIA[0-9A-Z]{16}\b/],
  ['private_key_block', /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['brevo_key', /\bxkeysib-[a-f0-9]{20,}/],
  ['google_client_secret', /\bGOCSPX-[A-Za-z0-9_\-]{20,}/],
  ['openai_style_key', /\bsk-[A-Za-z0-9]{32,}/],
];
const assign =
  /(PASSWORD|PASSWD|SECRET|API_?KEY|TOKEN|PRIVATE_?KEY)[A-Z_]*\s*[:=]\s*['"]?([A-Za-z0-9+\/_\-=.]{16,})['"]?/i;
const benign =
  /process\.env|\$\{|<|example|test|synthetic|fake|dummy|changeme|placeholder|redacted|xxxx|\*\*\*|sample|your_|password123/i;
const driveKey =
  /"(drive_root_folder_id|spreadsheet_id|owner_uid|google_account_email)"/;
const emailRe =
  /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;

const cat = (f) =>
  /^tests?\//.test(f)
    ? 'tests'
    : /^docs\//.test(f)
      ? 'docs'
      : /^\.data\//.test(f)
        ? '.data'
        : /^AGENTS\.md$/.test(f)
          ? 'AGENTS.md'
          : /^scripts\//.test(f)
            ? 'scripts'
            : /^(apps|packages)\//.test(f)
              ? 'app-source'
              : 'other';
const out = {
  commits: 0,
  emails: {
    distinct_gmail: new Set(),
    distinct_other: new Set(),
    added_lines_with_gmail_by_category: {},
    files_with_gmail: {},
  },
  drive_keys_files: {},
  cred_format_hits: [],
  assignment_like_files: {},
  sensitive_named_files_added: [],
};
let commit = '',
  file = '';
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
    '--format=@@COMMIT %h',
    '--',
    '.',
    ':(exclude)package-lock.json',
  ],
  { stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 30 },
);
const rl = readline.createInterface({ input: git.stdout, crlfDelay: Infinity });
rl.on('line', (line) => {
  if (line.startsWith('@@COMMIT ')) {
    commit = line.slice(9);
    out.commits++;
    return;
  }
  if (line.startsWith('+++ ')) {
    file = line.slice(4).replace(/^b\//, '');
    return;
  }
  if (!line.startsWith('+') || line.startsWith('+++')) return;
  const L = line.slice(1);
  if (L.length > 4000) return;
  let m;
  emailRe.lastIndex = 0;
  let hadGmail = false;
  while ((m = emailRe.exec(L))) {
    const dom = m[1].toLowerCase();
    if (dom === 'gmail.com') {
      out.emails.distinct_gmail.add(h8(m[0]));
      hadGmail = true;
    } else if (
      !/^(example|localhost|test|invalid|anty\.local|isolated\.example)/.test(
        dom,
      ) &&
      !/\.(test|invalid|example|local)$/.test(dom) &&
      dom !== 'example.com' &&
      dom !== 'users.noreply.github.com'
    )
      out.emails.distinct_other.add(h8(m[0]));
  }
  if (hadGmail) {
    const c = cat(file);
    out.emails.added_lines_with_gmail_by_category[c] =
      (out.emails.added_lines_with_gmail_by_category[c] || 0) + 1;
    out.emails.files_with_gmail[file] =
      (out.emails.files_with_gmail[file] || 0) + 1;
  }
  if (driveKey.test(L))
    out.drive_keys_files[file] = (out.drive_keys_files[file] || 0) + 1;
  for (const [k, re] of cred)
    if (re.test(L)) {
      const synthetic = /synthetic|fake|dummy|test|example/i.test(L);
      out.cred_format_hits.push({
        kind: k,
        file,
        commit,
        looks_synthetic: synthetic,
      });
    }
  const a = assign.exec(L);
  if (a && !benign.test(L) && !/^\s*(\/\/|\*|#)/.test(L))
    out.assignment_like_files[file] =
      (out.assignment_like_files[file] || 0) + 1;
});
rl.on('close', () => {
  const nameScan = spawn(
    'git',
    [
      '-C',
      repo,
      'log',
      '--all',
      '--diff-filter=A',
      '--name-only',
      '--format=@@C %h',
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  let buf = '';
  nameScan.stdout.on('data', (d) => (buf += d));
  nameScan.on('close', () => {
    let c = '';
    const seen = new Set();
    for (const l of buf.split('\n')) {
      if (l.startsWith('@@C ')) {
        c = l.slice(4);
        continue;
      }
      if (
        /(^|\/)(\.env(\..*)?|.*\.(pem|key|p12|pfx|dpapi|kdbx)|pgpass(\.conf)?|.*credentials?.*\.json|id_rsa.*)$/i.test(
          l,
        ) &&
        !/\.example$|\.sample$/i.test(l) &&
        !seen.has(l)
      ) {
        seen.add(l);
        out.sensitive_named_files_added.push({ file: l, commit: c });
      }
      if (/(^|\/)(secrets?|test-secrets)\//i.test(l) && !seen.has(l)) {
        seen.add(l);
        out.sensitive_named_files_added.push({ file: l, commit: c });
      }
    }
    const top = (o, n = 12) =>
      Object.entries(o)
        .sort((x, y) => y[1] - x[1])
        .slice(0, n)
        .map(([f, v]) => `${f} (${v})`);
    console.log(
      JSON.stringify(
        {
          commits_scanned: out.commits,
          gmail: {
            distinct_addresses_ever_added: out.emails.distinct_gmail.size,
            added_lines_by_category:
              out.emails.added_lines_with_gmail_by_category,
            files_top: top(out.emails.files_with_gmail),
          },
          other_real_looking_email_domains_distinct:
            out.emails.distinct_other.size,
          drive_or_owner_id_keys_in_files: top(out.drive_keys_files),
          credential_format_hits: out.cred_format_hits.slice(0, 40),
          credential_format_hits_total: out.cred_format_hits.length,
          credential_format_hits_not_synthetic: out.cred_format_hits.filter(
            (h) => !h.looks_synthetic,
          ).length,
          assignment_like_literal_candidates_files: top(
            out.assignment_like_files,
            15,
          ),
          sensitive_named_files_ever_added: out.sensitive_named_files_added,
        },
        null,
        1,
      ),
    );
  });
});
