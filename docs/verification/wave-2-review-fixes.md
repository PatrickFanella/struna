# Wave 2 review corrections

Hosted review of #46/#48 found measurement-selection and plan-derived-link cases after the work PRs had been merged. This follow-up keeps those corrections separate from Coach approval.

- Measurement choices include native tab panes by stable tab ID. A selected resource that is no longer available falls back to the resource actually displayed in the picker; a clean pass cannot be silently attributed to a removed pane.
- Saving a plan-only link persists its link entry before downloading. The saved file keeps its source URL, short name and plan membership. Repeating Save reuses that copy; old link item URLs resolve to it.
- A link required by the plan does not offer a misleading Delete operation. The API returns a recoverable explanation; removing that plan reference belongs to Coach review. Ordinary non-plan links and saved files retain their management actions.
- Normal Next/Back and Record controls also wait for recording finalization, closing the same asynchronous gap fixed in End session.
- The personal smoke explicitly selects personal mode, scratch paths and unavailable provider binaries, and disables automatic guidance. It cannot inherit a live Studio/provider configuration.

Validation: the scratch stage matrix passed nine cases at `/tmp/struna-stage-tempo-AmMknH`. The Materials matrix passed 24 cases at `/tmp/struna-wave2-materials-followup`. The personal smoke saved a synthetic recording and scratch log, restored the 84 BPM record, applied 87 BPM after clean passes and retained it across stages (`/tmp/struna-wave2-personal2.log`). Unit tests include removed selections, native-tab identity, repeated plan-only saves and deletion recovery. No physical audio or native-device evidence is claimed.
