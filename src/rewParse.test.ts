import { describe, it, expect } from 'vitest';
import { parseRewText, RewParseError } from './rewParse';

const BAND = '10, 60\n1000, 70\n20000, 65';

describe('parseRewText', () => {
  it('parses two comma-separated columns', () => {
    const m = parseRewText(BAND);
    expect(m.freq).toEqual([10, 1000, 20000]);
    expect(m.spl).toEqual([60, 70, 65]);
  });

  it('ignores a third (phase) column and extra columns', () => {
    const m = parseRewText('10, 60, -161.4\n1000, 70, 12.5\n20000, 65, -88.4');
    expect(m.freq).toEqual([10, 1000, 20000]);
    expect(m.spl).toEqual([60, 70, 65]);
  });

  it('accepts tabs, spaces and CRLF line endings', () => {
    expect(parseRewText('10\t60\n1000\t70\n20000\t65').spl).toEqual([60, 70, 65]);
    expect(parseRewText('10 60\n1000 70\n20000 65').spl).toEqual([60, 70, 65]);
    expect(parseRewText(BAND.replace(/\n/g, '\r\n')).spl).toEqual([60, 70, 65]);
  });

  it('skips comment lines, header lines and blank lines', () => {
    const text =
      '* Measurement data\n* Freq(Hz), SPL(dB), Phase(degrees)\nFreq(Hz), SPL(dB)\n\n10, 60\n\n1000, 70\n20000, 65\n';
    const m = parseRewText(text);
    expect(m.freq).toEqual([10, 1000, 20000]);
  });

  it('drops non-positive frequencies', () => {
    const m = parseRewText('0, 55\n10, 60\n1000, 70\n20000, 65');
    expect(m.freq).toEqual([10, 1000, 20000]);
  });

  it('parses exponent notation', () => {
    const m = parseRewText('1e1, 6e1\n1e3, 7e1\n2e4, 6.5e1');
    expect(m.freq).toEqual([10, 1000, 20000]);
    expect(m.spl).toEqual([60, 70, 65]);
  });

  it('rejects text with too few data points, naming the file', () => {
    expect(() => parseRewText('hello\nworld', 'L3.txt')).toThrow(RewParseError);
    expect(() => parseRewText('hello\nworld', 'L3.txt')).toThrow(/L3\.txt/);
  });

  it('rejects frequencies that are not ascending', () => {
    expect(() => parseRewText('10, 60\n1000, 70\n500, 65\n20000, 64', 'R1.txt')).toThrow(/ascending/);
  });

  it('rejects a measurement that does not reach down to 20 Hz', () => {
    expect(() => parseRewText('100, 60\n1000, 70\n20000, 65', 'C1.txt')).toThrow(/cover 20 Hz to 20 kHz/);
  });

  it('rejects a measurement that does not reach up to 20 kHz', () => {
    expect(() => parseRewText('10, 60\n1000, 70\n10000, 65', 'C2.txt')).toThrow(/cover 20 Hz to 20 kHz/);
  });
});
