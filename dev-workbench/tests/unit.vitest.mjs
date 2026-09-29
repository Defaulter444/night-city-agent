import { test, expect } from 'vitest';
import { cleanMessage, motionDuration, manifestProblems } from '../lib.mjs';
test('normalizes user message', () => expect(cleanMessage('  Найт-Сити  ')).toBe('Найт-Сити'));
test('respects reduced motion', () => expect(motionDuration('cinematic', true)).toBe(0));
test('rejects blank message', () => expect(() => cleanMessage(' ')).toThrow());
test('accepts v12 manifest', () => expect(manifestProblems({id:'test',version:'1',compatibility:{minimum:'12'}})).toEqual([]));
