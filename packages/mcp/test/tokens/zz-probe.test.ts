import { describe, it } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadProjectTokens } from '../../src/tokens/load.js';
import { analyzeProject } from '../../src/profile/profile.js';
import { joinTokens } from '../../src/join/token-map.js';
import { buildTokenValueIndex, annotateProjectTokens } from '../../src/tokens/token-index.js';

describe('probe3', () => {
  it('scss + mirrored css custom property in the same file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'p-'));
    await writeFile(join(dir, 'package.json'), JSON.stringify({ devDependencies: { sass: '^1' } }));
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(
      join(dir, 'src', '_tokens.scss'),
      '$brand: #6266F0;\n:root { --brand: #6266F0; }\n',
    );
    const loaded = await loadProjectTokens(dir, await analyzeProject(dir), undefined);
    console.log('TOKENS', JSON.stringify(loaded.tokens));
    const mappings = joinTokens(
      [{ name: 'Brand', value: '#6266F0', type: 'COLOR', collection: 'Colors' } as never],
      loaded.tokens,
      { threshold: 0.7 },
    );
    console.log('JOIN', JSON.stringify(mappings));
    const idx = buildTokenValueIndex(loaded.tokens);
    console.log('IDX', JSON.stringify(annotateProjectTokens({ nodes: [{ fills: ['#6266F0'] }] } as never, idx, false).projectTokens));
    await rm(dir, { recursive: true, force: true });
  });

  it('float token name-only with mirrored css var', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'p2-'));
    await writeFile(join(dir, 'package.json'), JSON.stringify({ devDependencies: { sass: '^1' } }));
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(
      join(dir, 'src', '_tokens.scss'),
      '$radius-lg: 8px;\n:root { --radius-lg: 8px; }\n',
    );
    const loaded = await loadProjectTokens(dir, await analyzeProject(dir), undefined);
    const mappings = joinTokens(
      [{ name: 'radius/lg', value: 8, type: 'FLOAT', collection: 'Radius' } as never],
      loaded.tokens,
      { threshold: 0.7 },
    );
    console.log('JOIN2', JSON.stringify(mappings));
    await rm(dir, { recursive: true, force: true });
  });
});
