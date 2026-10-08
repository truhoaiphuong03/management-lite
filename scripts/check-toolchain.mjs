import { readFileSync } from 'node:fs';
const { engines } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url)),
);
if (
  process.versions.node !== engines.node ||
  !process.env.npm_config_user_agent?.startsWith(`npm/${engines.npm} `)
) {
  throw new Error(
    `Use Node ${engines.node} and npm ${engines.npm}; global upgrades are not required.`,
  );
}
console.log(`Toolchain PASS: Node ${engines.node}, npm ${engines.npm}`);
