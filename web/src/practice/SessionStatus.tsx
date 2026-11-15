import { useMetronome } from "../audio/useMetronome.ts";

/** State transitions only: elapsed seconds and individual beats never enter a live region. */
export function SessionStatus({ timerRunning, recording, take, saving, saved, error }: {
  timerRunning: boolean;
  recording: boolean;
  take: boolean;
  saving: boolean;
  saved: boolean;
  error: string;
}) {
  const click = useMetronome();
  return (
    <div className="sessionstatus" aria-label="Practice status">
      <p role="status" aria-atomic="true">Timer {timerRunning ? "running" : "paused"}</p>
      <p role="status" aria-atomic="true">Click {click.countingIn ? "count-in" : click.running ? "running" : "stopped"}</p>
      <p role="status" aria-atomic="true">{error || (saving ? "Saving take" : recording ? "Recording take" : take ? "Take ready to save" : saved ? "Take saved" : "Recorder ready")}</p>
    </div>
  );
}
