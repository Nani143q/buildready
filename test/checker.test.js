'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkProject } = require('../src/checker.js');

const projectRoot = path.resolve(__dirname, '..');
const passingFixture = path.join(projectRoot, 'fixtures', 'passing-project');
const missingFixture = path.join(projectRoot, 'fixtures', 'missing-required');
const cliPath = path.join(projectRoot, 'src', 'cli.js');

function assertResultShape(result) {
  assert.ok(result && typeof result === 'object');
  assert.equal(typeof result.projectPath, 'string');
  assert.ok(Array.isArray(result.checks));
  assert.equal(typeof result.passedCount, 'number');
  assert.equal(typeof result.totalCount, 'number');
  assert.equal(typeof result.passed, 'boolean');
  assert.ok(result.checks.length > 0, 'a project should have at least one readiness check');

  for (const check of result.checks) {
    assert.equal(typeof check.id, 'string');
    assert.ok(check.id.length > 0);
    assert.equal(typeof check.label, 'string');
    assert.ok(check.label.length > 0);
    assert.equal(typeof check.passed, 'boolean');
    assert.ok(Object.hasOwn(check, 'details'));
  }

  assert.equal(result.totalCount, result.checks.length);
  assert.equal(
    result.passedCount,
    result.checks.filter((check) => check.passed).length,
  );
  assert.equal(result.passed, result.passedCount === result.totalCount);
}

test('passes a complete project fixture and reports consistent check counts', () => {
  const result = checkProject(passingFixture);

  assertResultShape(result);
  assert.equal(result.projectPath, passingFixture);
  assert.equal(result.passed, true);
  assert.equal(result.passedCount, result.totalCount);
});

test('fails a project with missing required files and explains failed checks', () => {
  const result = checkProject(missingFixture);

  assertResultShape(result);
  assert.equal(result.projectPath, missingFixture);
  assert.equal(result.passed, false);
  assert.ok(result.passedCount < result.totalCount);

  const failedChecks = result.checks.filter((check) => !check.passed);
  assert.ok(failedChecks.length > 0);
  assert.ok(
    failedChecks.some((check) => {
      if (typeof check.details === 'string') return check.details.trim().length > 0;
      return check.details !== null && check.details !== undefined;
    }),
    'failed checks should include details about the missing requirement',
  );
});

test('flags a machine-specific absolute path in a text file', () => {
  const temporaryProject = fs.mkdtempSync(path.join(os.tmpdir(), 'buildready-absolute-path-'));
  try {
    fs.mkdirSync(path.join(temporaryProject, '.git'));
    fs.writeFileSync(path.join(temporaryProject, 'package-lock.json'), '{}\n');
    fs.writeFileSync(path.join(temporaryProject, '.nvmrc'), '22.14.0\n');
    fs.writeFileSync(path.join(temporaryProject, 'Dockerfile'), 'FROM node:22.14.0-slim\n');
    fs.writeFileSync(
      path.join(temporaryProject, 'package.json'),
      '{"scripts":{"test":"node --test"}}\n',
    );
    fs.writeFileSync(path.join(temporaryProject, 'README.md'), '# Fixture\n');
    fs.writeFileSync(path.join(temporaryProject, '.env.example'), '# No secrets\n');
    const windowsPath = ['C:', 'Users', 'demo', 'project'].join('\\\\');
    fs.writeFileSync(path.join(temporaryProject, 'notes.txt'), `Local path: ${windowsPath}\n`);

    const result = checkProject(temporaryProject);
    const absolutePathCheck = result.checks.find((check) => check.id === 'absolute-paths');

    assert.ok(absolutePathCheck);
    assert.equal(absolutePathCheck.passed, false);
    assert.match(absolutePathCheck.details, /absolute machine paths/i);
  } finally {
    fs.rmSync(temporaryProject, { recursive: true, force: true });
  }
});

test('fails cleanly for a fake absolute project path', () => {
  const fakePath = path.join(projectRoot, 'fixtures', 'does-not-exist', 'project');
  const result = checkProject(fakePath);

  assertResultShape(result);
  assert.equal(result.projectPath, fakePath);
  assert.equal(result.passed, false);
  assert.ok(result.checks.some((check) => !check.passed));
});

test('CLI emits JSON and uses exit status to report a passing project', () => {
  const run = spawnSync(process.execPath, [cliPath, passingFixture, '--json'], {
    cwd: projectRoot,
    encoding: 'utf8',
  });

  assert.equal(run.error, undefined, run.error?.message);
  assert.equal(run.status, 0, run.stderr);

  const result = JSON.parse(run.stdout);
  assertResultShape(result);
  assert.equal(result.projectPath, passingFixture);
  assert.equal(result.passed, true);
});

test('CLI returns a non-zero exit status for a failing project', () => {
  const run = spawnSync(process.execPath, [cliPath, missingFixture, '--json'], {
    cwd: projectRoot,
    encoding: 'utf8',
  });

  assert.equal(run.error, undefined, run.error?.message);
  assert.notEqual(run.status, 0, run.stderr);

  const output = run.stdout.trim();
  if (output) {
    const result = JSON.parse(output);
    assertResultShape(result);
    assert.equal(result.passed, false);
  }
});
