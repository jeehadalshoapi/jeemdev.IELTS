import { describe, expect, it } from 'vitest';
import { speechLines, speechPartIds, type Part } from '../src';

describe('speechLines: a transcript ready to be read aloud', () => {
  it('splits by speaker, keeps the speaker for following lines, drops stage directions and markdown', () => {
    const lines = speechLines('Narrator: You will hear a conversation.\n\n**Receptionist:** Good morning, Hotel Bella. [phone rings]\nHow can I help?\nMan: I want to book a room.');
    expect(lines).toEqual([
      { speaker: 'Narrator', text: 'You will hear a conversation.' },
      { speaker: 'Receptionist', text: 'Good morning, Hotel Bella.' },
      { speaker: 'Receptionist', text: 'How can I help?' },
      { speaker: 'Man', text: 'I want to book a room.' }
    ]);
  });

  it('does not take "Time:" or "Address:" lines for speakers, and handles text without labels', () => {
    expect(speechLines('Time: 5 pm on Friday')).toEqual([{ speaker: null, text: 'Time: 5 pm on Friday' }]);
    expect(speechLines('Just one voice here.')).toEqual([{ speaker: null, text: 'Just one voice here.' }]);
  });

  it('cuts long turns into chunks a browser voice can say in one go', () => {
    const long = `Tom: ${'This is a fairly long sentence about the museum and its opening hours. '.repeat(8)}`;
    const lines = speechLines(long);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every(l => l.text.length <= 220 && l.speaker === 'Tom')).toBe(true);
    expect(lines.map(l => l.text).join(' ')).toBe(long.slice(5).trim());
  });
});

describe('speechPartIds: which listening parts are read aloud', () => {
  const part = (id: string, extra: Partial<Part> = {}) => ({ id, title: id, questionGroups: [], ...extra }) as unknown as Part;
  const listening = () => 'listening';
  it('parts without a recording, until a recording starts (it plays on through later parts)', () => {
    expect(speechPartIds([part('p1'), part('p2')], listening)).toEqual(['p1', 'p2']);
    expect(speechPartIds([part('p1'), part('p2', { audioUrl: 'https://x.test/a.mp3' }), part('p3')], listening)).toEqual(['p1']);
    expect(speechPartIds([part('p1', { skill: 'reading' }), part('p2', { skill: 'listening' })], p => p.skill)).toEqual(['p2']);
  });
});
