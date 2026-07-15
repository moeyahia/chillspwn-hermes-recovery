import path from 'node:path';
import { lstatSync, realpathSync, statSync } from 'node:fs';

export class MediaPathError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MediaPathError';
    this.code = code;
  }
}

function isContainedPath(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function lstatOrThrow(targetPath, code, message) {
  try {
    return lstatSync(targetPath);
  } catch {
    throw new MediaPathError(code, message);
  }
}

function realpathOrThrow(targetPath, code, message) {
  try {
    return realpathSync(targetPath);
  } catch {
    throw new MediaPathError(code, message);
  }
}

/**
 * Resolve a caller-supplied media file under an explicitly configured root.
 *
 * Both lexical and canonical containment are required. The separate checks
 * reject traversal/prefix tricks as well as symlinked intermediate paths.
 * The returned canonical path is safe to pass to readFileSync/execFileSync
 * after this validation.
 */
export function resolveAllowedMediaFile(requestedPath, allowedRoot) {
  if (typeof allowedRoot !== 'string' || allowedRoot.trim() === '') {
    throw new MediaPathError(
      'MEDIA_ROOT_REQUIRED',
      'WHATSAPP_ALLOWED_MEDIA_ROOT must be configured to send media',
    );
  }

  if (!path.isAbsolute(allowedRoot)) {
    throw new MediaPathError(
      'MEDIA_ROOT_NOT_ABSOLUTE',
      'WHATSAPP_ALLOWED_MEDIA_ROOT must be an absolute path',
    );
  }

  const rootPath = path.normalize(allowedRoot);
  if (path.parse(rootPath).root === rootPath) {
    throw new MediaPathError(
      'MEDIA_ROOT_TOO_BROAD',
      'WHATSAPP_ALLOWED_MEDIA_ROOT must not be the filesystem root',
    );
  }
  const rootStat = lstatOrThrow(
    rootPath,
    'MEDIA_ROOT_UNAVAILABLE',
    'WHATSAPP_ALLOWED_MEDIA_ROOT must reference an existing directory',
  );
  if (rootStat.isSymbolicLink()) {
    throw new MediaPathError(
      'MEDIA_ROOT_SYMLINK',
      'WHATSAPP_ALLOWED_MEDIA_ROOT must not be a symbolic link',
    );
  }
  if (!rootStat.isDirectory()) {
    throw new MediaPathError(
      'MEDIA_ROOT_NOT_DIRECTORY',
      'WHATSAPP_ALLOWED_MEDIA_ROOT must reference a directory',
    );
  }

  if (typeof requestedPath !== 'string' || requestedPath.trim() === '') {
    throw new MediaPathError('MEDIA_PATH_REQUIRED', 'filePath is required');
  }
  if (!path.isAbsolute(requestedPath)) {
    throw new MediaPathError(
      'MEDIA_PATH_NOT_ABSOLUTE',
      'filePath must be an absolute path',
    );
  }

  const candidatePath = path.normalize(requestedPath);
  if (!isContainedPath(rootPath, candidatePath)) {
    throw new MediaPathError(
      'MEDIA_PATH_OUTSIDE_ROOT',
      'filePath is outside WHATSAPP_ALLOWED_MEDIA_ROOT',
    );
  }

  const candidateLstat = lstatOrThrow(
    candidatePath,
    'MEDIA_PATH_UNAVAILABLE',
    'filePath does not reference an existing file',
  );
  if (candidateLstat.isSymbolicLink()) {
    throw new MediaPathError(
      'MEDIA_PATH_SYMLINK',
      'filePath must not be a symbolic link',
    );
  }
  if (!candidateLstat.isFile()) {
    throw new MediaPathError(
      'MEDIA_PATH_NOT_REGULAR',
      'filePath must reference a regular file',
    );
  }

  const realRoot = realpathOrThrow(
    rootPath,
    'MEDIA_ROOT_UNAVAILABLE',
    'WHATSAPP_ALLOWED_MEDIA_ROOT could not be resolved',
  );
  const realCandidate = realpathOrThrow(
    candidatePath,
    'MEDIA_PATH_UNAVAILABLE',
    'filePath could not be resolved',
  );
  if (!isContainedPath(realRoot, realCandidate)) {
    throw new MediaPathError(
      'MEDIA_PATH_OUTSIDE_ROOT',
      'filePath resolves outside WHATSAPP_ALLOWED_MEDIA_ROOT',
    );
  }

  let canonicalStat;
  try {
    canonicalStat = statSync(realCandidate);
  } catch {
    throw new MediaPathError(
      'MEDIA_PATH_UNAVAILABLE',
      'filePath does not reference an available file',
    );
  }
  if (!canonicalStat.isFile()) {
    throw new MediaPathError(
      'MEDIA_PATH_NOT_REGULAR',
      'filePath must reference a regular file',
    );
  }

  return realCandidate;
}

/**
 * Build ffmpeg arguments as an argv vector. Callers must use execFile/spawn,
 * never concatenate these values into a shell command.
 */
export function ffmpegAudioArgs(inputPath, outputPath) {
  return [
    '-y',
    '-i', inputPath,
    '-ar', '48000',
    '-ac', '1',
    '-c:a', 'libopus',
    outputPath,
  ];
}
