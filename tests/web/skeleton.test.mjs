import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { AppSkeleton } from '../../dist/packages/ui/src/components/AppSkeleton.js';

test('AppSkeleton: renders text variant with accessible attributes and custom dimensions', () => {
  const html = renderToString(
    React.createElement(AppSkeleton, {
      variant: 'text',
      width: '180px',
      height: '20px',
      testId: 'test-skeleton',
    }),
  );

  assert.ok(html.includes('data-testid="test-skeleton"'));
  assert.ok(html.includes('aria-hidden="true"'));
  assert.ok(html.includes('role="presentation"'));
  assert.ok(html.includes('width:180px'));
  assert.ok(html.includes('height:20px'));
  assert.ok(html.includes('border-radius:4px'));
});

test('AppSkeleton: renders circle and rect variants with appropriate border-radius', () => {
  const circleHtml = renderToString(
    React.createElement(AppSkeleton, {
      variant: 'circle',
      width: 48,
    }),
  );
  assert.ok(circleHtml.includes('border-radius:50%'));
  assert.ok(circleHtml.includes('width:48px'));

  const rectHtml = renderToString(
    React.createElement(AppSkeleton, {
      variant: 'rect',
      height: 60,
    }),
  );
  assert.ok(rectHtml.includes('border-radius:8px'));
  assert.ok(rectHtml.includes('height:60px'));
});

test('AppSkeleton: verifies skeleton-shimmer keyframes and prefers-reduced-motion support', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const rootDir = resolve(__dirname, '../..');

  // 1. Verify @keyframes skeleton-shimmer in tokens.css
  const tokensCss = readFileSync(
    resolve(rootDir, 'packages/ui/src/tokens.css'),
    'utf8',
  );
  assert.ok(
    tokensCss.includes('@keyframes skeleton-shimmer'),
    'tokens.css must define @keyframes skeleton-shimmer',
  );
  assert.ok(
    tokensCss.includes('background-position: 200% 0'),
    'tokens.css must define start position for skeleton-shimmer',
  );
  assert.ok(
    tokensCss.includes('background-position: -200% 0'),
    'tokens.css must define end position for skeleton-shimmer',
  );

  // 2. Verify AppSkeleton default render has shimmer animation
  const html = renderToString(
    React.createElement(AppSkeleton, {
      variant: 'text',
      testId: 'shimmer-skeleton',
    }),
  );
  assert.ok(
    html.includes('animation:skeleton-shimmer 1.6s ease-in-out infinite'),
    'AppSkeleton must apply skeleton-shimmer animation',
  );

  // 3. Verify AppSkeleton component handles prefers-reduced-motion
  const skeletonSrc = readFileSync(
    resolve(rootDir, 'packages/ui/src/components/AppSkeleton.tsx'),
    'utf8',
  );
  assert.ok(
    skeletonSrc.includes('prefers-reduced-motion: reduce'),
    'AppSkeleton must query prefers-reduced-motion',
  );
  assert.ok(
    skeletonSrc.includes("? 'none'") &&
      skeletonSrc.includes('skeleton-shimmer 1.6s ease-in-out infinite'),
    'AppSkeleton must disable animation when prefersReducedMotion is true',
  );
});
