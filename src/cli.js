#!/usr/bin/env node
'use strict';

const { checkProject } = require('./checker');
const fs = require('node:fs');
const path = require('node:path');

const HELP_FLAGS = new Set(['--help', '-h']);

function usage() {
  return 'Usage: node src/cli.js <project-path> [--json]';
}

function helpText() {
  return [
    usage(),
    'Check whether a project is ready to build.',
    '',
    'Options:',
    '  --json       Emit the report as machine-readable JSON.',
    '  --help, -h   Show this help message.',
    '',
    'Examples:',
    '  node src/cli.js --help',
    '  node src/cli.js .',
    '  node src/cli.js . --json',
  ].join('\n');
}

function parseArguments(args) {
  let json = false;
  let projectPath;

  for (const argument of args) {
    if (argument === '--json') {
      if (json) {
        throw new Error('The --json option may only be provided once.');
      }
      json = true;
    } else if (argument.startsWith('-')) {
      throw new Error(`Unknown option: ${argument}`);
    } else if (projectPath) {
      throw new Error('Only one project path may be provided.');
    } else {
      projectPath = argument;
    }
  }

  if (!projectPath) {
    throw new Error('A project path is required.');
  }
  return { projectPath, json };
}

function formatHumanReport(result) {
  const lines = [
    `BuildReady report for ${result.projectPath}`,
    `${result.passedCount}/${result.totalCount} checks passed`,
    '',
  ];

  for (const check of result.checks) {
    lines.push(`${check.passed ? 'PASS' : 'FAIL'}  ${check.label}`);
    lines.push(`       ${check.details}`);
  }
  lines.push('');
  lines.push(result.passed ? 'Result: READY' : 'Result: NOT READY');
  return lines.join('\n');
}

function isProjectDirectory(projectPath) {
  try {
    return fs.statSync(path.resolve(projectPath)).isDirectory();
  } catch {
    return false;
  }
}

function main(args = process.argv.slice(2)) {
  if (args.some((argument) => HELP_FLAGS.has(argument))) {
    process.stdout.write(`${helpText()}\n`);
    return 0;
  }

  let options;
  try {
    options = parseArguments(args);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    return 2;
  }

  if (!isProjectDirectory(options.projectPath)) {
    const resolvedPath = path.resolve(options.projectPath);
    const message = `Project path does not exist or is not a directory: ${resolvedPath}`;
    if (options.json) {
      process.stderr.write(`${JSON.stringify({ error: message })}\n`);
    } else {
      process.stderr.write(`BuildReady: ${message}\n${usage()}\n`);
    }
    return 2;
  }

  let result;
  try {
    result = checkProject(options.projectPath);
  } catch (error) {
    if (options.json) {
      process.stderr.write(`${JSON.stringify({ error: error.message })}\n`);
    } else {
      process.stderr.write(`BuildReady: ${error.message}\n${usage()}\n`);
    }
    return 2;
  }

  process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : `${formatHumanReport(result)}\n`);
  return result.passed ? 0 : 1;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = { main, parseArguments, formatHumanReport };
