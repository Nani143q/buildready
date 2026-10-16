'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_TEXT_FILE_BYTES = 1024 * 1024;
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules']);

const LOCKFILE_NAMES = [
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'bun.lockb',
  'Cargo.lock',
  'Pipfile.lock',
  'poetry.lock',
  'uv.lock',
  'composer.lock',
  'Gemfile.lock',
  'go.sum',
  'packages.lock.json',
  'project.assets.json',
  'mix.lock',
  'pubspec.lock',
  'Podfile.lock',
  'gradle.lockfile',
];

const RUNTIME_PIN_FILES = ['.nvmrc', '.node-version', 'runtime.txt', '.tool-versions', 'mise.toml'];

const CHECK_LABELS = [
  ['git-repository', 'Git repository present'],
  ['dependency-lockfile', 'Dependency lockfile present'],
  ['pinned-runtime', 'Runtime is pinned'],
  ['dockerfile', 'Dockerfile present'],
  ['test-command', 'Real test command configured'],
  ['readme', 'README present'],
  ['env-example', '.env.example present'],
  ['absolute-paths', 'No common absolute machine paths'],
];

function isRegularFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function readTextFile(filePath, maxBytes = MAX_TEXT_FILE_BYTES) {
  let stats;
  try {
    stats = fs.statSync(filePath);
  } catch {
    return null;
  }

  if (!stats.isFile() || stats.size > maxBytes) {
    return null;
  }

  let buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch {
    return null;
  }

  // A NUL byte is a reliable and inexpensive binary-file signal for the
  // source/configuration files this checker is intended to inspect.
  if (buffer.includes(0)) {
    return null;
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
}

function checkGitRepository(projectPath) {
  const gitPath = path.join(projectPath, '.git');
  try {
    const stats = fs.statSync(gitPath);
    return {
      passed: stats.isDirectory() || stats.isFile(),
      details: stats.isDirectory() || stats.isFile()
        ? 'Found a .git directory or worktree file.'
        : 'The .git entry is not a directory or file.',
    };
  } catch {
    return { passed: false, details: 'No .git directory or worktree file was found.' };
  }
}

function checkLockfile(projectPath) {
  let emptyLockfile = null;
  for (const lockfile of LOCKFILE_NAMES) {
    const lockfilePath = path.join(projectPath, lockfile);
    if (!isRegularFile(lockfilePath)) {
      continue;
    }

    let size = 0;
    try {
      size = fs.statSync(lockfilePath).size;
    } catch {
      continue;
    }
    if (size > 0) {
      return { passed: true, details: `Found ${lockfile}.` };
    }
    emptyLockfile = lockfile;
  }

  if (emptyLockfile) {
    return { passed: false, details: `${emptyLockfile} is empty.` };
  }

  if (!emptyLockfile) {
    return {
      passed: false,
      details: `No recognized dependency lockfile found (looked for ${LOCKFILE_NAMES.slice(0, 5).join(', ')}, and other common lockfiles).`,
    };
  }
}

function isRuntimePin(value) {
  return /^v?\d+(?:\.\d+){0,2}$/.test(String(value).trim());
}

function pinnedVersionFromFile(projectPath, fileName) {
  const contents = readTextFile(path.join(projectPath, fileName), 64 * 1024);
  if (!contents) {
    return null;
  }

  if (fileName === '.tool-versions') {
    for (const line of contents.split(/\r?\n/)) {
      const match = /^\s*(?:nodejs|node|python|ruby|go|java)\s+(\S+)/i.exec(line);
      if (match && isRuntimePin(match[1])) {
        return `${match[1]} in ${fileName}`;
      }
    }
    return null;
  }

  if (fileName === 'mise.toml') {
    const match = /^\s*(?:node|nodejs|python|ruby|go|java)\s*=\s*["']([^"']+)["']/im.exec(contents);
    return match && isRuntimePin(match[1]) ? `${match[1]} in ${fileName}` : null;
  }

  const firstLine = contents.split(/\r?\n/, 1)[0].trim();
  return isRuntimePin(firstLine) ? `${firstLine} in ${fileName}` : null;
}

function pinnedVersionFromPackageJson(projectPath) {
  const packageJsonPath = path.join(projectPath, 'package.json');
  const contents = readTextFile(packageJsonPath, 256 * 1024);
  if (!contents) {
    return null;
  }

  let packageJson;
  try {
    packageJson = JSON.parse(contents);
  } catch {
    return null;
  }

  const nodeVersion = packageJson && packageJson.engines && packageJson.engines.node;
  return isRuntimePin(nodeVersion) ? `${nodeVersion} in package.json engines.node` : null;
}

function pinnedVersionFromDockerfile(projectPath) {
  const contents = readTextFile(path.join(projectPath, 'Dockerfile'));
  if (!contents) {
    return null;
  }

  for (const line of contents.split(/\r?\n/)) {
    const match = /^\s*FROM\s+[^\s:@]+:([^\s@]+)(?:@sha256:[0-9a-f]+)?/i.exec(line);
    if (match) {
      const version = /^(v?\d+(?:\.\d+){0,2})(?:[-_][A-Za-z0-9._-]+)?$/.exec(match[1]);
      if (version) {
        return `${version[1]} in Dockerfile`;
      }
    }
    if (/^\s*FROM\s+[^\s]+@sha256:[0-9a-f]+/i.test(line)) {
      return 'digest-pinned image in Dockerfile';
    }
  }
  return null;
}

function checkRuntimePin(projectPath) {
  for (const fileName of RUNTIME_PIN_FILES) {
    const pin = pinnedVersionFromFile(projectPath, fileName);
    if (pin) {
      return { passed: true, details: `Found a pinned runtime: ${pin}.` };
    }
  }

  const packagePin = pinnedVersionFromPackageJson(projectPath);
  if (packagePin) {
    return { passed: true, details: `Found a pinned runtime: ${packagePin}.` };
  }

  const dockerPin = pinnedVersionFromDockerfile(projectPath);
  if (dockerPin) {
    return { passed: true, details: `Found a pinned runtime: ${dockerPin}.` };
  }

  return {
    passed: false,
    details: 'No exact runtime pin found in .nvmrc, .node-version, runtime.txt, .tool-versions, mise.toml, package.json engines, or Dockerfile.',
  };
}

function checkDockerfile(projectPath) {
  return isRegularFile(path.join(projectPath, 'Dockerfile'))
    ? { passed: true, details: 'Found Dockerfile.' }
    : { passed: false, details: 'No Dockerfile was found at the project root.' };
}

function isPlaceholderTestCommand(command) {
  const normalized = String(command).trim().toLowerCase();
  if (!normalized || normalized === ':' || normalized === 'true' || normalized === 'false') {
    return true;
  }
  if (normalized.includes('no test specified')) {
    return true;
  }

  const commands = normalized.split(/\s*(?:&&|\|\||;)\s*/).filter(Boolean);
  const onlyNoOpCommands = commands.length > 0 && commands.every((part) => (
    /^(?:echo|printf|true|false|:|exit\s+\d+)\b/.test(part)
  ));
  if (onlyNoOpCommands) {
    return true;
  }
  return false;
}

function checkPackageJsonTestCommand(projectPath) {
  const contents = readTextFile(path.join(projectPath, 'package.json'), 256 * 1024);
  if (!contents) {
    return null;
  }

  let packageJson;
  try {
    packageJson = JSON.parse(contents);
  } catch {
    return null;
  }

  const command = packageJson && packageJson.scripts && packageJson.scripts.test;
  if (typeof command !== 'string' || isPlaceholderTestCommand(command)) {
    return null;
  }

  return command.trim();
}

function checkMakefileTestCommand(projectPath) {
  for (const fileName of ['Makefile', 'makefile', 'GNUmakefile']) {
    const contents = readTextFile(path.join(projectPath, fileName), 256 * 1024);
    if (!contents) {
      continue;
    }

    const lines = contents.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (!/^\s*test\s*:\s*(?:[^#]*)?$/.test(lines[index])) {
        continue;
      }
      const recipe = [];
      for (let next = index + 1; next < lines.length && /^\s+/.test(lines[next]); next += 1) {
        recipe.push(lines[next].trim());
      }
      const command = recipe.filter(Boolean).join(' && ');
      if (command && !isPlaceholderTestCommand(command)) {
        return `${fileName}: ${command}`;
      }
    }
  }
  return null;
}

function checkTestCommand(projectPath) {
  const packageCommand = checkPackageJsonTestCommand(projectPath);
  if (packageCommand) {
    return { passed: true, details: `Found package.json test command: ${packageCommand}` };
  }

  const makeCommand = checkMakefileTestCommand(projectPath);
  if (makeCommand) {
    return { passed: true, details: `Found test command: ${makeCommand}` };
  }

  return {
    passed: false,
    details: 'No non-placeholder test command found in package.json or a Makefile.',
  };
}

function checkReadme(projectPath) {
  let entries;
  try {
    entries = fs.readdirSync(projectPath, { withFileTypes: true });
  } catch {
    return { passed: false, details: 'Could not read the project root.' };
  }

  const readme = entries.find((entry) => entry.isFile() && /^readme(?:\.|$)/i.test(entry.name));
  return readme
    ? { passed: true, details: `Found ${readme.name}.` }
    : { passed: false, details: 'No README file was found at the project root.' };
}

function checkEnvExample(projectPath) {
  return isRegularFile(path.join(projectPath, '.env.example'))
    ? { passed: true, details: 'Found .env.example.' }
    : { passed: false, details: 'No .env.example file was found at the project root.' };
}

function isLikelyBinary(buffer) {
  if (buffer.includes(0)) {
    return true;
  }

  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return false;
  } catch {
    return true;
  }
}

function findAbsolutePathMatches(contents) {
  const matches = new Set();
  const withoutUrls = contents.replace(/\bhttps?:\/\/[^\s"'`<>]+/gi, '');
  const patterns = [
    /(?:^|[\s"'`(=:[,{])([A-Za-z]:[\\/][^\s"'`),;<>]+)/gm,
    /(?:^|[\s"'`(=:[,{])(\\\\[A-Za-z0-9._-]+[\\/][^\s"'`),;<>]+)/gm,
    /(?:^|[\s"'`(=:[,{])(\/(?:Users|home|root|tmp|var|opt|mnt|media|Volumes|workspace|workspaces|srv|private|etc|[A-Za-z]\/Users)(?:[\\/][^\s"'`),;<>]+)+)/gim,
  ];

  for (const pattern of patterns) {
    for (const match of withoutUrls.matchAll(pattern)) {
      if (match[1]) {
        matches.add(match[1]);
      }
    }
  }
  return [...matches];
}

function scanTextFiles(projectPath) {
  const findings = [];

  function visit(directory) {
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) {
        continue;
      }

      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      let stats;
      try {
        stats = fs.statSync(absolutePath);
      } catch {
        continue;
      }
      if (stats.size > MAX_TEXT_FILE_BYTES) {
        continue;
      }

      let buffer;
      try {
        buffer = fs.readFileSync(absolutePath);
      } catch {
        continue;
      }
      if (isLikelyBinary(buffer)) {
        continue;
      }

      let contents;
      try {
        contents = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      } catch {
        continue;
      }

      const matches = findAbsolutePathMatches(contents);
      if (matches.length === 0) {
        continue;
      }

      const relativePath = path.relative(projectPath, absolutePath) || entry.name;
      const lineNumbers = [];
      const lines = contents.split(/\r?\n/);
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        if (findAbsolutePathMatches(lines[lineIndex]).length > 0) {
          lineNumbers.push(lineIndex + 1);
        }
      }
      findings.push({ file: relativePath, matches, lines: lineNumbers });
    }
  }

  visit(projectPath);
  return findings;
}

function checkAbsolutePaths(projectPath) {
  const findings = scanTextFiles(projectPath);
  if (findings.length === 0) {
    return {
      passed: true,
      details: `Scanned text files (skipping .git, node_modules, binary files, and files over ${MAX_TEXT_FILE_BYTES} bytes); no common absolute machine paths found.`,
    };
  }

  const summary = findings.map((finding) => {
    const lineSuffix = finding.lines.length > 0 ? `:${finding.lines.join(',')}` : '';
    return `${finding.file}${lineSuffix} (${finding.matches.slice(0, 3).join(', ')})`;
  }).join('; ');
  return {
    passed: false,
    details: `Found common absolute machine paths: ${summary}`,
  };
}

function assertProjectDirectory(projectPath) {
  if (typeof projectPath !== 'string' || projectPath.trim() === '') {
    throw new TypeError('projectPath must be a non-empty path string.');
  }

  const resolvedPath = path.resolve(projectPath);
  let stats;
  try {
    stats = fs.statSync(resolvedPath);
  } catch {
    throw new Error(`Project path does not exist: ${resolvedPath}`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`Project path is not a directory: ${resolvedPath}`);
  }
  return resolvedPath;
}

function invalidProjectResult(projectPath, details) {
  const checks = CHECK_LABELS.map(([id, label]) => ({
    id,
    label,
    passed: false,
    details,
  }));
  return {
    projectPath,
    checks,
    passedCount: 0,
    totalCount: checks.length,
    passed: false,
  };
}

function checkProject(projectPath) {
  let resolvedPath;
  try {
    resolvedPath = assertProjectDirectory(projectPath);
  } catch (error) {
    return invalidProjectResult(projectPath, error.message);
  }

  const checks = [
    { id: 'git-repository', label: 'Git repository present', ...checkGitRepository(resolvedPath) },
    { id: 'dependency-lockfile', label: 'Dependency lockfile present', ...checkLockfile(resolvedPath) },
    { id: 'pinned-runtime', label: 'Runtime is pinned', ...checkRuntimePin(resolvedPath) },
    { id: 'dockerfile', label: 'Dockerfile present', ...checkDockerfile(resolvedPath) },
    { id: 'test-command', label: 'Real test command configured', ...checkTestCommand(resolvedPath) },
    { id: 'readme', label: 'README present', ...checkReadme(resolvedPath) },
    { id: 'env-example', label: '.env.example present', ...checkEnvExample(resolvedPath) },
    { id: 'absolute-paths', label: 'No common absolute machine paths', ...checkAbsolutePaths(resolvedPath) },
  ];

  const passedCount = checks.filter((check) => check.passed).length;
  return {
    projectPath,
    checks,
    passedCount,
    totalCount: checks.length,
    passed: passedCount === checks.length,
  };
}

module.exports = { checkProject };
