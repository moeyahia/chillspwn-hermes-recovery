import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';

import {
  ffmpegAudioArgs,
  MediaPathError,
  resolveAllowedMediaFile,
} from './media-path.js';

function withMediaFixture(run) {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'hermes-wa-media-'));
  const allowedRoot = path.join(fixtureRoot, 'allowed');
  const outsideRoot = path.join(fixtureRoot, 'outside');
  mkdirSync(path.join(allowedRoot, 'nested'), { recursive: true });
  mkdirSync(outsideRoot);
  const allowedFile = path.join(allowedRoot, 'nested', 'report.pdf');
  const outsideFile = path.join(outsideRoot, 'secret.txt');
  writeFileSync(allowedFile, 'safe report');
  writeFileSync(outsideFile, 'not outbound media');

  try {
    run({ fixtureRoot, allowedRoot, outsideRoot, allowedFile, outsideFile });
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

function assertMediaError(fn, code) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof MediaPathError);
    assert.equal(error.code, code);
    return true;
  });
}

test('resolveAllowedMediaFile accepts a nested regular file and returns its canonical path', () => {
  withMediaFixture(({ allowedRoot, allowedFile }) => {
    assert.equal(resolveAllowedMediaFile(allowedFile, allowedRoot), allowedFile);
  });
});

test('resolveAllowedMediaFile fails closed when the allowed root is absent or relative', () => {
  withMediaFixture(({ allowedFile }) => {
    assertMediaError(() => resolveAllowedMediaFile(allowedFile, ''), 'MEDIA_ROOT_REQUIRED');
    assertMediaError(
      () => resolveAllowedMediaFile(allowedFile, 'relative/media'),
      'MEDIA_ROOT_NOT_ABSOLUTE',
    );
  });
});

test('resolveAllowedMediaFile rejects the filesystem root as too broad', () => {
  withMediaFixture(({ allowedFile }) => {
    const filesystemRoot = path.parse(allowedFile).root;
    assertMediaError(
      () => resolveAllowedMediaFile(allowedFile, filesystemRoot),
      'MEDIA_ROOT_TOO_BROAD',
    );
  });
});

test('resolveAllowedMediaFile rejects missing, non-directory, and symlink roots', () => {
  withMediaFixture(({ fixtureRoot, allowedRoot, allowedFile }) => {
    const rootFile = path.join(fixtureRoot, 'not-a-directory');
    const linkedRoot = path.join(fixtureRoot, 'linked-root');
    writeFileSync(rootFile, 'file');
    symlinkSync(allowedRoot, linkedRoot, 'dir');

    assertMediaError(
      () => resolveAllowedMediaFile(allowedFile, path.join(fixtureRoot, 'missing')),
      'MEDIA_ROOT_UNAVAILABLE',
    );
    assertMediaError(
      () => resolveAllowedMediaFile(allowedFile, rootFile),
      'MEDIA_ROOT_NOT_DIRECTORY',
    );
    assertMediaError(
      () => resolveAllowedMediaFile(path.join(linkedRoot, 'nested', 'report.pdf'), linkedRoot),
      'MEDIA_ROOT_SYMLINK',
    );
  });
});

test('resolveAllowedMediaFile requires an absolute candidate path', () => {
  withMediaFixture(({ allowedRoot }) => {
    assertMediaError(
      () => resolveAllowedMediaFile('nested/report.pdf', allowedRoot),
      'MEDIA_PATH_NOT_ABSOLUTE',
    );
  });
});

test('resolveAllowedMediaFile rejects traversal and sibling-prefix paths', () => {
  withMediaFixture(({ fixtureRoot, allowedRoot, outsideFile }) => {
    const prefixDirectory = `${allowedRoot}-copy`;
    mkdirSync(prefixDirectory);
    const prefixFile = path.join(prefixDirectory, 'report.pdf');
    writeFileSync(prefixFile, 'wrong root');

    assertMediaError(
      () => resolveAllowedMediaFile(outsideFile, allowedRoot),
      'MEDIA_PATH_OUTSIDE_ROOT',
    );
    assertMediaError(
      () => resolveAllowedMediaFile(path.join(allowedRoot, '..', 'outside', 'secret.txt'), allowedRoot),
      'MEDIA_PATH_OUTSIDE_ROOT',
    );
    assertMediaError(
      () => resolveAllowedMediaFile(prefixFile, allowedRoot),
      'MEDIA_PATH_OUTSIDE_ROOT',
    );
    assert.ok(prefixDirectory.startsWith(allowedRoot));
    assert.ok(prefixDirectory.startsWith(fixtureRoot));
  });
});

test('resolveAllowedMediaFile rejects direct and intermediate symlink escapes', () => {
  withMediaFixture(({ allowedRoot, outsideRoot, outsideFile }) => {
    const directLink = path.join(allowedRoot, 'linked-secret.txt');
    const directoryLink = path.join(allowedRoot, 'linked-directory');
    symlinkSync(outsideFile, directLink, 'file');
    symlinkSync(outsideRoot, directoryLink, 'dir');

    assertMediaError(
      () => resolveAllowedMediaFile(directLink, allowedRoot),
      'MEDIA_PATH_SYMLINK',
    );
    assertMediaError(
      () => resolveAllowedMediaFile(path.join(directoryLink, 'secret.txt'), allowedRoot),
      'MEDIA_PATH_OUTSIDE_ROOT',
    );
  });
});

test('resolveAllowedMediaFile rejects directories and missing candidates', () => {
  withMediaFixture(({ allowedRoot }) => {
    assertMediaError(
      () => resolveAllowedMediaFile(path.join(allowedRoot, 'nested'), allowedRoot),
      'MEDIA_PATH_NOT_REGULAR',
    );
    assertMediaError(
      () => resolveAllowedMediaFile(path.join(allowedRoot, 'missing.pdf'), allowedRoot),
      'MEDIA_PATH_UNAVAILABLE',
    );
  });
});

test('ffmpegAudioArgs preserves hostile-looking paths as single argv values', () => {
  const inputPath = '/safe/media/voice; touch injected.mp3';
  const outputPath = '/tmp/out $(touch injected).ogg';

  assert.deepEqual(ffmpegAudioArgs(inputPath, outputPath), [
    '-y',
    '-i', inputPath,
    '-ar', '48000',
    '-ac', '1',
    '-c:a', 'libopus',
    outputPath,
  ]);
});

test('bridge /send-media route wires containment validation and shell-free ffmpeg execution', () => {
  const bridgeSource = readFileSync(new URL('./bridge.js', import.meta.url), 'utf8');
  const routeStart = bridgeSource.indexOf("app.post('/send-media'");
  const routeEnd = bridgeSource.indexOf("app.post('/typing'", routeStart);
  assert.notEqual(routeStart, -1, 'expected /send-media route');
  assert.notEqual(routeEnd, -1, 'expected /typing route after /send-media');

  const routeSource = bridgeSource.slice(routeStart, routeEnd);
  const validationIndex = routeSource.indexOf('resolveAllowedMediaFile(');
  const readIndex = routeSource.indexOf('readFileSync(');

  assert.notEqual(validationIndex, -1, 'route must call resolveAllowedMediaFile');
  assert.notEqual(readIndex, -1, 'route must read the validated file');
  assert.ok(validationIndex < readIndex, 'media validation must happen before reading file bytes');
  assert.match(routeSource, /WHATSAPP_ALLOWED_MEDIA_ROOT/);
  assert.match(routeSource, /readFileSync\(validatedPath\)/);
  assert.match(routeSource, /execFileSync\(\s*['"]ffmpeg['"]\s*,\s*ffmpegAudioArgs\(/);
  assert.match(routeSource, /ffmpegAudioArgs\(validatedPath\s*,\s*tmpPath\)/);
  assert.doesNotMatch(routeSource, /\bexecSync\s*\(/);
});
