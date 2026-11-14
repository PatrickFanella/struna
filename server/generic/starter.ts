import type { Level, Plan, PlanPhase, PlanSession, PlanStage, Profile } from "./types.ts";

/**
 * Starter plans: what the app writes when the player finishes the setup form and no plan
 * exists yet. They follow ordinary teaching order for each level and are meant to be
 * replaced or adjusted by the coach, who also handles left-handed players and limits.
 */

type StageDef = { key: string; title: string; task: string; weight: number; short?: true; quick?: true };
type Starter = { id: string; title: string; goal: string; stages: StageDef[]; phases: PlanPhase[]; next: string; extras: string[] };

const TUNE: StageDef = { key: "tune", title: "Tune up", task: "Open the tuner and tune every string, thickest to thinnest. Tune again if anything sounds off later.", weight: 1, short: true, quick: true };

const STARTERS: Record<Level, Starter> = {
  new: {
    id: "starter-first-steps",
    title: "First steps on guitar",
    goal: "Hold the guitar comfortably, play clear notes and four easy chords, and play one simple song from start to finish.",
    stages: [
      TUNE,
      { key: "warmup", title: "Warm up your hands", task: "Shake your hands loose, then press and pluck a few notes slowly. Nothing should hurt; stop and rest if it does.", weight: 2 },
      { key: "new", title: "One new thing", task: "Work on the one new thing for this phase, slowly. A clear sound matters more than speed.", weight: 4, short: true, quick: true },
      { key: "song", title: "Play a song or riff", task: "Play the tune for this phase from start to finish. Keep going when you make a mistake.", weight: 4, short: true },
      { key: "next", title: "Write down what to do next", task: "Say in one sentence what went well and what to start with next time.", weight: 1, short: true, quick: true },
    ],
    phases: [
      {
        title: "Getting comfortable",
        sessions: 4,
        summary: "Hold the guitar, make single notes ring clearly, and play a first tune on one string.",
        focus: {
          warmup: "Sit up with the guitar resting on your leg and your shoulders down. The strings are numbered 1 (thinnest) to 6 (thickest). Pluck each string once and let it ring.",
          new: "On string 1, press just behind the first metal bar (a fret) with the tip of your first finger and pluck. Then fret 2 with your second finger, fret 3 with your third, fret 4 with your little finger. If a note buzzes, move the fingertip closer to the metal bar.",
          song: "Ode to Joy on string 1. The numbers are frets; 0 means the string with no finger on it: 4 4 5 7, 7 5 4 2, 0 0 2 4, 4 2 2. Use one finger and go as slowly as you need.",
        },
      },
      {
        title: "First chords",
        sessions: 6,
        summary: "Learn two chords, E minor and A minor, and strum them so every string rings.",
        focus: {
          warmup: "Play frets 1, 2, 3, 4 on string 1 with one finger each, then the same on string 2.",
          new: "A chord is several notes played together. E minor: second finger on string 5 at fret 2, third finger on string 4 at fret 2, strum all six strings. A minor: first finger on string 2 at fret 1, second finger on string 4 at fret 2, third finger on string 3 at fret 2, strum from string 5 down. Pluck the strings one at a time and fix any that sound dead.",
          song: "Strum E minor four times slowly, then A minor four times, and repeat. Count 1, 2, 3, 4 out loud as you strum.",
        },
      },
      {
        title: "Changing chords in time",
        sessions: 6,
        summary: "Move between chords without stopping, and add D major.",
        focus: {
          warmup: "Make the E minor shape, lift your fingers a little, and put them back. Ten times, slowly.",
          new: "D major: first finger on string 3 at fret 2, second finger on string 1 at fret 2, third finger on string 2 at fret 3, strum from string 4 down. Then count how many clean changes you can make between two chords in one minute, and write the number down.",
          song: "Four strums each: E minor, A minor, D, D. Keep your strumming hand moving at the same speed even when the other hand is late.",
        },
      },
      {
        title: "Your first song",
        sessions: 6,
        summary: "Add G major and play a whole song with the chords you know.",
        focus: {
          warmup: "One minute of changes between the two chords you find hardest.",
          new: "G major: second finger on string 6 at fret 3, first finger on string 5 at fret 2, third finger on string 1 at fret 3, strum all six strings. Practise moving from G to D and from G to E minor.",
          song: "Pick a song that uses G, D, E minor and A minor (ask the coach for one you like) and play it all the way through, slowly, with one strum per beat.",
        },
      },
    ],
    next: "Tune the guitar with the tuner. Then press string 1 (the thinnest) just behind the first metal bar with your first finger and pluck it until it rings clearly five times in a row.",
    extras: ["Listen to a song you want to play and tap the beat with your foot.", "Five minutes of making any sounds you like on the guitar."],
  },

  beginner: {
    id: "starter-solid-basics",
    title: "Solid basics",
    goal: "Change between the open chords in time, strum steady rhythms, and play two whole songs.",
    stages: [
      TUNE,
      { key: "warmup", title: "Warm up", task: "Play something easy and slow to loosen both hands. Check that your shoulders and thumb are relaxed.", weight: 2 },
      { key: "chords", title: "Chords and changes", task: "Work on this phase's chords. Check that every string rings, then practise the changes slowly.", weight: 4, short: true, quick: true },
      { key: "rhythm", title: "Rhythm with a beat", task: "Play this phase's strumming or picking with the metronome. Only speed up when it feels easy.", weight: 3 },
      { key: "song", title: "Play a song", task: "Play your current song from start to finish without stopping for mistakes.", weight: 4, short: true },
      { key: "next", title: "Write down what to do next", task: "Note one thing that improved and the first thing to do next time.", weight: 1, short: true, quick: true },
    ],
    phases: [
      {
        title: "Clean open chords",
        sessions: 5,
        summary: "Make G, C, D, A, E, A minor and E minor ring on every string, and time your changes.",
        focus: {
          chords: "Take two chords per session. Pluck the strings one at a time and fix any that buzz or sound dead. Then count clean changes between the two in one minute and write the number down.",
          rhythm: "Metronome at 60. One downward strum on each click, four per chord, changing chord exactly on the click.",
          song: "Choose a song with three or four of these chords. Play one strum per beat and keep going.",
        },
      },
      {
        title: "Steady strumming",
        sessions: 6,
        summary: "Keep the strumming hand moving evenly and learn one down-up pattern.",
        focus: {
          chords: "One-minute changes on your two slowest pairs. Try to beat last session's number by one or two.",
          rhythm: "Count 1 and 2 and 3 and 4 and. Strum down on the numbers and up on the ands, with the hand moving all the time. Then leave some strums out: down, down-up, up-down-up. Start at 60 and add 5 when it is steady for a minute.",
          song: "Use the new pattern in your song. If the changes fall apart, go back to one strum per beat for that part.",
        },
      },
      {
        title: "Songs from start to finish",
        sessions: 6,
        summary: "Play two whole songs along with a steady beat.",
        focus: {
          chords: "Practise only the hardest change in each song, back and forth, eight times.",
          rhythm: "Play the song's chords with the metronome a little slower than the recording.",
          song: "Play the first song all the way through, then start the second. Record one attempt and listen for where the beat wobbles.",
        },
      },
      {
        title: "First barre chord and a riff",
        sessions: 6,
        summary: "Start F major and learn a scale shape you can make riffs from.",
        focus: {
          chords: "Small F: first finger flat across strings 1 and 2 at fret 1, second finger on string 3 at fret 2, third finger on string 4 at fret 3. Hold for a few seconds, rest, repeat. A barre takes weeks; short tries every session work better than long ones.",
          rhythm: "A minor pentatonic scale at fret 5: frets 5 and 8 on strings 6, 2 and 1; frets 5 and 7 on strings 5, 4 and 3. Play it up and down with one note per click at 60.",
          song: "Keep one song going, and make up a short riff from the scale shape to play between verses.",
        },
      },
    ],
    next: "Tune, then play each chord you know one string at a time and write down which chords have a string that does not ring.",
    extras: ["Play along with a favourite recording, even if you only catch the first beat of each bar.", "Learn the names of the six open strings: E, A, D, G, B, E."],
  },

  intermediate: {
    id: "starter-fluent-playing",
    title: "Fluent rhythm and first solos",
    goal: "Play barre chords in time, improvise with the pentatonic scale, find notes on the neck, and finish one complete piece.",
    stages: [
      TUNE,
      { key: "warmup", title: "Warm up", task: "Two or three minutes of slow, relaxed playing: chromatic fingers, easy chord changes or a scale you know.", weight: 2 },
      { key: "technique", title: "Technique with the metronome", task: "Work on this phase's technique in short loops. Find a tempo where it is clean three times in a row before going faster.", weight: 4, short: true, quick: true },
      { key: "repertoire", title: "Repertoire", task: "Work on your current piece: fix the hardest two bars first, then play a longer section in time.", weight: 5, short: true },
      { key: "improv", title: "Improvise or use your ears", task: "Make music without the page: improvise over a backing track or drone, or work out a short phrase from a recording by ear.", weight: 3 },
      { key: "next", title: "Record and note the next step", task: "Record one short take when it is useful, then write the tempo you reached and what to start with next time.", weight: 1, short: true, quick: true },
    ],
    phases: [
      {
        title: "Barre chords and tight time",
        sessions: 6,
        summary: "Play E-shape and A-shape barre chords, major and minor, and lock in with the click.",
        focus: {
          technique: "E-shape barre chords on string 6 and A-shape on string 5. Change between two of them every bar at 60 to 70, then set the click to half speed and hear it as beats 2 and 4.",
          repertoire: "Choose a song that needs barre chords. Play the chord chart with one simple strumming pattern all the way through.",
          improv: "Mute the strings and strum sixteenth notes with the click, accenting different beats. Then play the song's rhythm part from memory.",
        },
      },
      {
        title: "Pentatonic vocabulary",
        sessions: 6,
        summary: "Turn the minor pentatonic scale into phrases with bends, slides and hammer-ons.",
        focus: {
          technique: "Minor pentatonic, first two positions. Practise whole-step bends on string 3 and check each against the fretted note two frets up. Add slides, hammer-ons and pull-offs.",
          repertoire: "Learn three short licks from a solo you like, slowly and exactly, including the bends and the rhythm.",
          improv: "Improvise over a slow blues or one-chord backing track using four notes only. Leave space; repeat an idea before changing it.",
        },
      },
      {
        title: "Know the neck",
        sessions: 6,
        summary: "Name the notes on strings 6 and 5 and play the major scale and small chord shapes.",
        focus: {
          technique: "One position of the major scale, saying the note names aloud, with the metronome. Then major and minor triads on strings 1 to 3 in their three shapes.",
          repertoire: "Find where the chords of your piece sit as triads higher up the neck, and play the song with those.",
          improv: "Pick a note name and find it on strings 6 and 5 as fast as you can. Then sing a short phrase and find it on the guitar.",
        },
      },
      {
        title: "Play a whole piece",
        sessions: 6,
        summary: "Finish one song with its solo, or one fingerstyle piece, and record it.",
        focus: {
          technique: "Take the hardest passage of the piece. Loop two bars at a clean tempo and raise it by 4 BPM after three clean passes.",
          repertoire: "Play the whole piece in time at a tempo you can hold, without stopping. Record a full take at least once a week.",
          improv: "Change something in the piece: a different ending for the solo, a new strumming pattern, another key.",
        },
      },
    ],
    next: "Tune, then play an F major and a B minor barre chord one string at a time and note which strings do not ring. Set the metronome to 60 and change between them once per bar.",
    extras: ["Listen to one song closely and write down its sections: intro, verse, chorus, solo.", "Play along with a recording you like for ten minutes."],
  },

  advanced: {
    id: "starter-deliberate-practice",
    title: "Deliberate practice cycle",
    goal: "Pick one technical limit, one piece and one area of vocabulary; measure them, raise them, and finish with recorded takes.",
    stages: [
      TUNE,
      { key: "warmup", title: "Prepare the motion", task: "A relaxed, slow version of today's hardest motion. Check for tension in the shoulders, forearms and thumb.", weight: 2 },
      { key: "technique", title: "Technique with the metronome", task: "Short loops of the exact fragment that fails. Raise the tempo only after three clean passes in a row; note the clean tempo.", weight: 4, short: true, quick: true },
      { key: "repertoire", title: "Repertoire", task: "Work on the current piece in sections, at a tempo where the time and tone hold up.", weight: 5, short: true },
      { key: "improv", title: "Improvise or transcribe", task: "Use the vocabulary you are building in real time over changes, or transcribe a phrase by ear and play it back.", weight: 3 },
      { key: "review", title: "Record and review", task: "Record one representative take, listen once, and write one instruction for the next session.", weight: 2, short: true, quick: true },
    ],
    phases: [
      {
        title: "Baseline and targets",
        sessions: 4,
        summary: "Record where you are and choose exactly what this cycle will change.",
        focus: {
          technique: "Find the technical limit that holds your playing back most. Isolate a two-bar example and find the fastest tempo at which it is clean three times running.",
          repertoire: "Choose one piece that is a stretch but reachable. Record a rough full take as the baseline.",
          improv: "Choose one vocabulary area: a set of changes, a scale colour, a rhythmic idea or a player to study. Record two choruses as the baseline.",
          review: "Label today's take as the baseline and write down the clean tempos you found.",
        },
      },
      {
        title: "Build",
        sessions: 8,
        summary: "Raise the clean tempo in small steps and collect new vocabulary.",
        focus: {
          technique: "Work the fragment at the last clean tempo, then 4 to 6 BPM higher. If it fails twice, drop back and change the fingering or picking, not the effort.",
          repertoire: "Take the piece in sections. Start each session with the weakest section, not the beginning.",
          improv: "Transcribe one short phrase a week by ear, learn it in two positions, and write your own variation.",
        },
      },
      {
        title: "Connect",
        sessions: 6,
        summary: "Put the fragments back into music and vary them.",
        focus: {
          technique: "Play the fragment inside its surrounding bars. Vary the rhythm, the dynamics and the position.",
          repertoire: "Join the sections. Play the transitions on their own, then longer and longer stretches in time.",
          improv: "Use the new phrases over a backing track or with a metronome on 2 and 4. Aim to place each one on purpose.",
        },
      },
      {
        title: "Perform and review",
        sessions: 4,
        summary: "Record complete takes and compare them with the baseline.",
        focus: {
          technique: "A short check of the fragment at its best clean tempo. No new material.",
          repertoire: "Full takes of the piece without stopping, as if for an audience. Record each one.",
          improv: "Two recorded choruses using this cycle's vocabulary.",
          review: "Compare with the baseline recording. Write what changed, what did not, and what the next cycle should target.",
        },
      },
    ],
    next: "Tune, then record two minutes of the piece or passage you most want to improve. Listen back once and write down the single weakest thing you hear.",
    extras: ["Play with other people or along with a recording, with no goal but the music.", "Listen to a player you admire and write down one thing they do that you do not."],
  },
};

/** Share `total` minutes between the stages by weight; every stage gets at least one. */
function allocate(stages: StageDef[], total: number): PlanStage[] {
  const spare = total - stages.length;
  const weight = stages.reduce((a, s) => a + s.weight, 0);
  const shares = stages.map((s) => (spare * s.weight) / weight);
  const minutes = shares.map((x) => 1 + Math.floor(x));
  let left = total - minutes.reduce((a, m) => a + m, 0);
  const byRemainder = shares.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of byRemainder) {
    if (left <= 0) break;
    minutes[i]!++;
    left--;
  }
  return stages.map((s, i) => ({ key: s.key, title: s.title, minutes: minutes[i]!, task: s.task }));
}

/** Two or three session kinds around the usual session length, longest first. */
export function sessionSizes(minutesPerSession: number): { full: number; short: number | null; quick: number } {
  const full = Math.min(180, Math.max(5, Math.round(minutesPerSession)));
  const quick = full >= 30 ? 10 : full >= 15 ? 5 : Math.max(3, Math.round(full / 2));
  const short = full >= 20 ? Math.max(10, Math.floor(full / 10) * 5) : null;
  return { full, short, quick };
}

export function starterPlan(profile: Profile, today: string): Plan {
  const s = STARTERS[profile.level] ?? STARTERS.beginner;
  const size = sessionSizes(profile.minutesPerSession);
  const shortSet = s.stages.filter((st) => st.short);
  const sessions: PlanSession[] = [{ id: "full", label: "Full session", stages: allocate(size.full >= 10 ? s.stages : shortSet, size.full) }];
  if (size.short) sessions.push({ id: "short", label: "Short session", stages: allocate(shortSet, size.short) });
  sessions.push({ id: "quick", label: "Quick session", stages: allocate(s.stages.filter((st) => st.quick), size.quick) });
  const keys = new Set(sessions.flatMap((k) => k.stages.map((st) => st.key)));
  return {
    version: 1,
    id: s.id,
    title: s.title,
    goal: s.goal,
    started: today,
    // A very short "full" kind drops stages; a focus line for a stage no kind has would not validate.
    phases: s.phases.map((p) => ({ ...p, focus: Object.fromEntries(Object.entries(p.focus).filter(([k]) => keys.has(k))) })),
    sessions,
    materials: [],
    next: s.next,
    extras: [...s.extras],
  };
}
