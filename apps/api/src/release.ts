import fs from 'node:fs';

export interface ReleaseVersion {
  commit: string;
  version: string;
  target: string;
}

export function readReleaseVersion(): ReleaseVersion {
  try {
    const value: unknown = JSON.parse(
      fs.readFileSync(new URL('./build-version.json', import.meta.url), 'utf8'),
    );
    if (typeof value !== 'object' || value === null)
      throw new Error('Invalid version');
    const data = value as Record<string, unknown>;
    if (
      typeof data['commit'] !== 'string' ||
      !/^[a-f0-9]{40}$/.test(data['commit']) ||
      data['version'] !== '0.1.0' ||
      data['target'] !== 'windows-x64'
    )
      throw new Error('Invalid version');
    return { commit: data['commit'], version: '0.1.0', target: 'windows-x64' };
  } catch {
    return { commit: 'unversioned', version: '0.1.0', target: 'development' };
  }
}
