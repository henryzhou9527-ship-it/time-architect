import { describe, it, expect } from 'vitest';
import { extractCommand, commandPayload } from '../command-parser';

describe('extractCommand', () => {
  it('extracts slash command', () => expect(extractCommand('/goal IELTS')).toBe('/goal'));
  it('normalizes /command to /commands', () => expect(extractCommand('/command')).toBe('/commands'));
  it('returns empty for no command', () => expect(extractCommand('hello world')).toBe(''));
  it('is case insensitive', () => expect(extractCommand('/Build-Week')).toBe('/build-week'));
});

describe('commandPayload', () => {
  it('extracts payload after command', () => expect(commandPayload('/goal IELTS 7分')).toBe('IELTS 7分'));
  it('returns empty for bare command', () => expect(commandPayload('/help')).toBe(''));
  it('returns full text when no command', () => expect(commandPayload('hello')).toBe('hello'));
});
