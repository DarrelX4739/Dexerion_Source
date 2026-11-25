// Timer sounds: the four fixed-loop lo-fi pieces, played headlessly through
// LofiPlayer (lofi-player.js). Bodies are kept identical to the standalone
// demos so either side can be synced by copy.
'use strict';
const LOFI_SONGS = {
drizzlo: {
  title: 'Drizzlo',
  mood: 'Rain on the window, one warm lamp on. Unrushed Rhodes over a brushed groove — made for reading past midnight.',
  key: 'F major', bpm: 70, swing: 56,
  tone: 2900, vinyl: 0.5, rain: 0.8, attack: 0.03, delayMix: 0.24,
  chords: [
    ['F3', 'A3', 'C4', 'E4'],
    ['E3', 'G3', 'B3', 'D4'],
    ['D3', 'F3', 'A3', 'C4'],
    ['C3', 'E3', 'G3', 'B3']
  ],
  chordNames: ['Fmaj7', 'Em7', 'Dm7', 'Cmaj7'],
  progression: 'Fmaj7 – Em7 – Dm7 – Cmaj7',
  chordHits: [0, 11],
  bass: ['F2', 'E2', 'D2', 'C2'],
  bassHits: [{ s: 0, len: 12 }, { s: 11, len: 4 }],
  kick: { 0: 1, 7: 0.8, 10: 0.9 },
  snare: { 4: 0.5, 12: 0.55 },
  hat: { 0: 0.9, 2: 0.45, 4: 0.7, 6: 0.45, 8: 0.9, 10: 0.5, 12: 0.7, 14: 0.55 },
  openHat: [14],
  melody: [
    { b: 0, s: 0, n: 'A4', l: 6 }, { b: 0, s: 8, n: 'C5', l: 4 }, { b: 0, s: 12, n: 'A4', l: 3 },
    { b: 1, s: 0, n: 'G4', l: 6 }, { b: 1, s: 8, n: 'D5', l: 6 },
    { b: 2, s: 0, n: 'C5', l: 4 }, { b: 2, s: 4, n: 'A4', l: 3 }, { b: 2, s: 10, n: 'F4', l: 5 },
    { b: 3, s: 0, n: 'E4', l: 6 }, { b: 3, s: 8, n: 'G4', l: 4 },
    { b: 4, s: 0, n: 'C5', l: 6 }, { b: 4, s: 8, n: 'A4', l: 3 }, { b: 4, s: 12, n: 'G4', l: 3 },
    { b: 5, s: 0, n: 'B4', l: 4 }, { b: 5, s: 6, n: 'A4', l: 3 }, { b: 5, s: 10, n: 'G4', l: 5 },
    { b: 6, s: 0, n: 'A4', l: 6 }, { b: 6, s: 8, n: 'F4', l: 3 }, { b: 6, s: 12, n: 'E4', l: 3 },
    { b: 7, s: 0, n: 'G4', l: 10 }, { b: 7, s: 12, n: 'E4', l: 3 }
  ],
  accent: '#4f7a6a'
},
cuphaze: {
  title: 'Cuphaze',
  mood: 'First cup, vinyl already spinning. Jazzy ninths and a lopsided boom-bap — the steam keeps its own time.',
  key: 'C major', bpm: 82, swing: 62,
  tone: 3400, vinyl: 0.7, attack: 0.02, delayMix: 0.2,
  chords: [
    ['C3', 'E3', 'G3', 'B3', 'D4'],
    ['A2', 'C#3', 'E3', 'G3'],
    ['D3', 'F3', 'A3', 'C4', 'E4'],
    ['G2', 'B2', 'F3', 'E4']
  ],
  chordNames: ['Cmaj9', 'A7', 'Dm9', 'G13'],
  progression: 'Cmaj9 – A7 – Dm9 – G13',
  chordHits: [0, 10],
  bass: ['C2', 'A1', 'D2', 'G1'],
  bassHits: [{ s: 0, len: 9 }, { s: 10, len: 5 }],
  kick: { 0: 1, 7: 0.85, 10: 0.9 },
  snare: { 4: 0.6, 12: 0.65, 15: 0.18 },
  hat: { 0: 1.0, 2: 0.55, 4: 0.8, 6: 0.55, 8: 0.9, 10: 0.6, 11: 0.35, 12: 0.8, 14: 0.6 },
  openHat: [],
  melody: [
    { b: 0, s: 0, n: 'E4', l: 4 }, { b: 0, s: 4, n: 'G4', l: 3 },
    { b: 0, s: 8, n: 'A4', l: 4 }, { b: 0, s: 12, n: 'G4', l: 2 },
    { b: 1, s: 0, n: 'G4', l: 3 }, { b: 1, s: 4, n: 'E4', l: 3 },
    { b: 1, s: 8, n: 'A4', l: 3 }, { b: 1, s: 12, n: 'G4', l: 3 },
    { b: 2, s: 0, n: 'A4', l: 4 }, { b: 2, s: 6, n: 'F4', l: 3 }, { b: 2, s: 10, n: 'E4', l: 4 },
    { b: 3, s: 0, n: 'D5', l: 3 }, { b: 3, s: 4, n: 'B4', l: 3 },
    { b: 3, s: 8, n: 'A4', l: 3 }, { b: 3, s: 12, n: 'G4', l: 3 },
    { b: 4, s: 0, n: 'G4', l: 6 }, { b: 4, s: 8, n: 'E4', l: 3 }, { b: 4, s: 12, n: 'D4', l: 3 },
    { b: 5, s: 0, n: 'E4', l: 4 }, { b: 5, s: 6, n: 'G4', l: 3 }, { b: 5, s: 10, n: 'A4', l: 4 },
    { b: 6, s: 0, n: 'C5', l: 6 }, { b: 6, s: 8, n: 'A4', l: 3 }, { b: 6, s: 12, n: 'F4', l: 3 },
    { b: 7, s: 0, n: 'B4', l: 4 }, { b: 7, s: 6, n: 'D5', l: 3 }, { b: 7, s: 10, n: 'E5', l: 5 }
  ],
  accent: '#b3541e'
},
nodland: {
  title: 'Nodland',
  mood: 'Half-asleep with the tape still rolling. Wide-eyed ninths that bloom slowly and a music box answering from the next room.',
  key: 'A minor', bpm: 64, swing: 54,
  tone: 2400, vinyl: 0.35, attack: 0.09, chordLen: 1.0, delayMix: 0.3,
  chords: [
    ['A2', 'E3', 'G3', 'B3', 'C4'],
    ['C3', 'E3', 'G3', 'A3'],
    ['E3', 'G3', 'B3', 'D4'],
    ['B2', 'D3', 'E3', 'A3']
  ],
  chordNames: ['Am9', 'Fmaj9', 'Cmaj9', 'G6/9'],
  progression: 'Am9 – Fmaj9 – Cmaj9 – G6/9',
  chordHits: [0],
  bass: ['A1', 'F2', 'C2', 'G2'],
  bassHits: [{ s: 0, len: 15 }],
  kick: { 0: 0.9 },
  snare: { 8: 0.3 },
  hat: { 0: 0.4, 2: 0.18, 4: 0.3, 6: 0.18, 8: 0.35, 10: 0.18, 12: 0.3, 14: 0.18 },
  openHat: [],
  melody: [
    { b: 0, s: 0, n: 'E5', l: 8 }, { b: 0, s: 10, n: 'C6', l: 5 },
    { b: 1, s: 0, n: 'A5', l: 6 }, { b: 1, s: 8, n: 'G5', l: 6 },
    { b: 2, s: 0, n: 'G5', l: 4 }, { b: 2, s: 6, n: 'E5', l: 4 }, { b: 2, s: 12, n: 'D5', l: 3 },
    { b: 3, s: 0, n: 'D5', l: 8 }, { b: 3, s: 10, n: 'B4', l: 5 },
    { b: 4, s: 0, n: 'C6', l: 6 }, { b: 4, s: 8, n: 'A5', l: 3 }, { b: 4, s: 12, n: 'G5', l: 3 },
    { b: 5, s: 0, n: 'A5', l: 10 }, { b: 5, s: 12, n: 'G5', l: 3 },
    { b: 6, s: 0, n: 'G5', l: 6 }, { b: 6, s: 8, n: 'E5', l: 4 }, { b: 6, s: 12, n: 'D5', l: 3 },
    { b: 7, s: 0, n: 'B4', l: 8 }, { b: 7, s: 10, n: 'A4', l: 5 }
  ],
  accent: '#6a5f9e'
},
glidelo: {
  title: 'Glidelo',
  mood: 'Last bus, window seat, streetlights strobing. The keys breathe with the engine — sub bass up through the floor.',
  key: 'D minor', bpm: 76, swing: 58, duck: true,
  tone: 3100, vinyl: 0.4, attack: 0.02, delayMix: 0.26,
  chords: [
    ['D3', 'F3', 'A3', 'C4', 'E4'],
    ['Bb2', 'D3', 'G3', 'A3'],
    ['A2', 'C3', 'E3', 'G3'],
    ['F3', 'G3', 'Bb3', 'D4']
  ],
  chordNames: ['Dm9', 'Bbmaj13', 'Fmaj9', 'C9sus'],
  progression: 'Dm9 – Bbmaj13 – Fmaj9 – C9sus',
  chordHits: [0, 10],
  bass: ['D2', 'Bb1', 'F2', 'C2'],
  bassHits: [{ s: 0, len: 6 }, { s: 7, len: 3, semis: 12 }, { s: 10, len: 5 }],
  kick: { 0: 1, 8: 0.9 },
  snare: { 4: 0.55, 12: 0.6 },
  hat: { 0: 0.85, 1: 0.3, 2: 0.5, 3: 0.3, 4: 0.7, 6: 0.5, 8: 0.85, 10: 0.5, 11: 0.35, 12: 0.7, 14: 0.55, 15: 0.3 },
  openHat: [14],
  melody: [
    { b: 0, s: 0, n: 'A4', l: 4 }, { b: 0, s: 4, n: 'C5', l: 3 }, { b: 0, s: 8, n: 'D5', l: 6 },
    { b: 1, s: 0, n: 'C5', l: 3 }, { b: 1, s: 4, n: 'Bb4', l: 3 }, { b: 1, s: 8, n: 'A4', l: 6 },
    { b: 2, s: 0, n: 'A4', l: 4 }, { b: 2, s: 6, n: 'G4', l: 3 }, { b: 2, s: 10, n: 'A4', l: 4 },
    { b: 3, s: 0, n: 'G4', l: 6 }, { b: 3, s: 8, n: 'F4', l: 3 }, { b: 3, s: 12, n: 'D4', l: 3 },
    { b: 4, s: 0, n: 'D5', l: 6 }, { b: 4, s: 8, n: 'C5', l: 3 }, { b: 4, s: 12, n: 'A4', l: 3 },
    { b: 5, s: 0, n: 'D5', l: 4 }, { b: 5, s: 6, n: 'C5', l: 3 }, { b: 5, s: 10, n: 'Bb4', l: 5 },
    { b: 6, s: 0, n: 'C5', l: 6 }, { b: 6, s: 8, n: 'A4', l: 3 }, { b: 6, s: 12, n: 'G4', l: 3 },
    { b: 7, s: 0, n: 'A4', l: 4 }, { b: 7, s: 6, n: 'G4', l: 3 }, { b: 7, s: 10, n: 'F4', l: 5 }
  ],
  accent: '#2f5d8a'
}
};
