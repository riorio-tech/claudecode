import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { logger } from '../lib/logger.js';

describe('logger', () => {
  it('exports step, info, success, warn, error methods', () => {
    assert.equal(typeof logger.step, 'function');
    assert.equal(typeof logger.info, 'function');
    assert.equal(typeof logger.success, 'function');
    assert.equal(typeof logger.warn, 'function');
    assert.equal(typeof logger.error, 'function');
  });

  it('step does not throw', () => {
    assert.doesNotThrow(() => logger.step(1, 'Stage 1'));
  });

  it('info does not throw', () => {
    assert.doesNotThrow(() => logger.info('hello'));
  });

  it('success does not throw', () => {
    assert.doesNotThrow(() => logger.success('done'));
  });

  it('warn does not throw', () => {
    assert.doesNotThrow(() => logger.warn('careful'));
  });

  it('error does not throw', () => {
    assert.doesNotThrow(() => logger.error('boom'));
  });

  it('info output contains the message', () => {
    const calls = [];
    const orig = console.log;
    console.log = (...args) => calls.push(args.join(''));
    logger.info('hello world');
    console.log = orig;
    assert.ok(calls.length > 0, 'console.log should have been called');
    assert.ok(calls[0].includes('hello world'), `Expected "hello world" in: ${calls[0]}`);
  });

  it('success output contains the message', () => {
    const calls = [];
    const orig = console.log;
    console.log = (...args) => calls.push(args.join(''));
    logger.success('all done');
    console.log = orig;
    assert.ok(calls[0].includes('all done'), `Expected "all done" in: ${calls[0]}`);
  });

  it('step output contains step number and name', () => {
    const calls = [];
    const orig = console.log;
    console.log = (...args) => calls.push(args.join(''));
    logger.step(3, 'analyze');
    console.log = orig;
    assert.ok(calls[0].includes('3'), `Expected "3" in: ${calls[0]}`);
    assert.ok(calls[0].includes('analyze'), `Expected "analyze" in: ${calls[0]}`);
  });

  it('warn output contains the message', () => {
    const warnCalls = [];
    const orig = console.warn;
    console.warn = (...args) => warnCalls.push(args.join(''));
    logger.warn('careful');
    console.warn = orig;
    assert.ok(warnCalls[0].includes('careful'), `Expected "careful" in: ${warnCalls[0]}`);
  });

  it('error output contains the message', () => {
    const errCalls = [];
    const orig = console.error;
    console.error = (...args) => errCalls.push(args.join(''));
    logger.error('boom');
    console.error = orig;
    assert.ok(errCalls[0].includes('boom'), `Expected "boom" in: ${errCalls[0]}`);
  });
});
