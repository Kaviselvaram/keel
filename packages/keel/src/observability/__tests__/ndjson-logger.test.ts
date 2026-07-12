import { describe, expect, it } from 'vitest';
import type { Clock } from '../../shared/index.js';
import { createNdjsonLogger } from '../ndjson-logger.js';
import type { LineSink } from '../ndjson-logger.js';
import { isLevelEnabled, LOG_LEVELS, noopLogger } from '../logger.js';

const testClock: Clock = {
  now: () => new Date('2026-07-12T00:00:00.000Z'),
  epochMillis: () => Date.parse('2026-07-12T00:00:00.000Z'),
};

function collectingSink(): { sink: LineSink; lines: string[] } {
  const lines: string[] = [];
  return { sink: { write: (line) => void lines.push(line) }, lines };
}

describe('createNdjsonLogger', () => {
  it('writes one valid JSON object per line with ts, level, event', () => {
    const { sink, lines } = collectingSink();
    const logger = createNdjsonLogger({ sink, clock: testClock });
    logger.info('capture.seal.ok', { baselineId: 'B1' });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.endsWith('\n')).toBe(true);
    expect(JSON.parse(lines[0] as string)).toEqual({
      ts: '2026-07-12T00:00:00.000Z',
      level: 'info',
      event: 'capture.seal.ok',
      baselineId: 'B1',
    });
  });

  it('filters below the configured level', () => {
    const { sink, lines } = collectingSink();
    const logger = createNdjsonLogger({ sink, clock: testClock, level: 'warn' });
    logger.info('x.y.z');
    logger.debug('x.y.z');
    logger.trace('x.y.z');
    expect(lines).toHaveLength(0);
    logger.warn('x.y.z');
    logger.error('x.y.z');
    expect(lines).toHaveLength(2);
  });

  it('child() merges bindings so opId correlation works (C63)', () => {
    const { sink, lines } = collectingSink();
    const logger = createNdjsonLogger({ sink, clock: testClock }).child({ opId: 'OP1' });
    logger.child({ probeName: 'api' }).info('replay.probe.done', { ms: 12 });
    const record = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect(record['opId']).toBe('OP1');
    expect(record['probeName']).toBe('api');
    expect(record['ms']).toBe(12);
  });

  it('never propagates sink failures (logging is best-effort by contract)', () => {
    const throwingSink: LineSink = {
      write: () => {
        throw new Error('disk gone');
      },
    };
    const logger = createNdjsonLogger({ sink: throwingSink, clock: testClock });
    expect(() => logger.error('storage.write.failed')).not.toThrow();
  });

  it('degrades unserializable fields instead of throwing', () => {
    const { sink, lines } = collectingSink();
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    const logger = createNdjsonLogger({ sink, clock: testClock });
    expect(() => logger.info('x.y.z', { circular })).not.toThrow();
    const record = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect(record['keelLogError']).toBe('fields-unserializable');
    expect(record['event']).toBe('x.y.z');
  });
});

describe('level model', () => {
  it('orders error > warn > info > debug > trace', () => {
    expect(LOG_LEVELS).toEqual(['error', 'warn', 'info', 'debug', 'trace']);
    expect(isLevelEnabled('info', 'error')).toBe(true);
    expect(isLevelEnabled('info', 'debug')).toBe(false);
    expect(isLevelEnabled('trace', 'trace')).toBe(true);
  });

  it('noopLogger swallows everything and children itself', () => {
    expect(() => noopLogger.error('x.y.z')).not.toThrow();
    expect(noopLogger.child({ opId: 'x' })).toBe(noopLogger);
  });
});
