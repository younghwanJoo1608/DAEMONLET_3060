# Full-answer reading through Dots

One present call can retain the complete display answer while reading caller-authored conversational wording:

~~~json
{"text":"The complete original answer.","speechText":"The complete answer phrased for speaking.","speak":true,"speechMode":"complete"}
~~~

The caller must preserve every substantive point, qualification, number and warning. Ordinary prose punctuation should guide natural speech instead of being named. Code and mathematical notation must keep their meaning: for example, describe a comparison or increment when speaking it instead of blindly deleting operators. The app does not verify semantic equivalence. Omit speechText when the original is already suitable for speaking. Providing both fields adds request input text, but the app makes no additional OpenAI request or per-chunk language-model request. All synthesis uses the already configured local voice engine.

## Limits and completion

- Existing calls default to bounded mode: text up to 600 Unicode code points and durationMs from 1 to 30 seconds, default 12 seconds.
- Complete mode requires text and speak:true. Each of text and optional speechText accepts at most 6,000 UTF-16 code units. Invalid or oversized input is rejected without truncation. Both strings are normalized to NFC and trimmed; their content is otherwise retained.
- Voice preparation can take at most 15 minutes. Reading has a separate absolute limit of 10 minutes from the first trusted scheduled playback acknowledgement plus its validated queue delay.
- Each unique current audio scheduling acknowledgement refreshes a 60-second progress watchdog plus its validated queue delay (at most 6 seconds). Repeated, unclaimed or stale acknowledgements cannot refresh it. Progress cannot extend the absolute reading limit.
- Successful completion waits for actual playback completion. A limit or renderer/engine failure becomes a failed status and bounded error feedback. Even valid maximum-length input can exceed the finite reading limit.
- Muted calls show the original text for the ordinary durationMs budget and generate no audio. Complete mode never unmutes, enables voice or resumes a paused bridge.

The existing local utterance planner splits spoken text without loss, preferring 96 UTF-16 units and retaining hard limits of 400 units and 1,600 UTF-8 bytes per segment. Existing PCM backpressure remains: three producer credits, a queue bounded to six chunks/six seconds, and the existing 240 ms initial prebuffer. The original answer remains available in the expandable, scrollable bubble. Only speechText is synthesized when supplied.

## Ownership and status

New presentations replace existing bridge-owned output. Cancel, mute, pause, character/context changes, hidden Pet, local-chat ownership and app exit retain their existing cancellation rules. There is no request queue or delayed replay.

The read-only status tool takes an empty object and reports the latest sequence, phase, muted/paused/available gates and an allowlisted error. It exposes no answer text, reference transcript, paths, settings, credentials or history. Status polling is limited independently to four calls per second and cannot delay an immediate cancel or consume the presentation rate allowance. A present receipt means accepted/requested, not audible or completed.

## Updating a connected plugin

The app and bundled MCP adapter must both be rebuilt from this version. Adapter version 1.1.0 exposes present, cancel and status; present adds speechText and speechMode. Refresh the connected plugin's tool schema after updating the app so the caller can discover the new fields and tool. This source change does not install an app, restart an existing connection, alter a tunnel or change permissions.

## Verification

Contract tests cover legacy compatibility, full limits and Unicode, separate display/spoken text, more than 30 seconds of simulated playback, finite deadlines, unique acknowledgements, cancellation/replacement/ownership and text-free status. The isolated scripts/voice-qa/dot-build.mjs harness exercises the production bridge, service, native ICL worker and Web Audio with a private temporary profile and already approved local assets. It records real decoded PCM duration, first playback latency, completion, cancellation, replacement, failure recovery and whole-GPU memory samples. It refuses to start synthesis with insufficient GPU headroom and never stops unrelated applications.

An isolated Windows RTX 3060 Ti (8 GB, CC 8.6) Qwen 0.6B Q8 GGUF ICL run passed 19 checks. A single call with 854 display units and 949 spoken units produced 13 local segments and 419 chunks: 233.2 seconds of non-silent decoded PCM, all scheduled buffers ended, and status reported completed after 235.849 seconds. First PCM reached the application approximately 1.189 seconds after the request stage; the first validated playback schedule including the 240 ms prebuffer was 2.542 seconds. These are different measurements from the native first-chunk-ready interval of 529 ms.

The same run passed muted/no-audio and hidden-window rejection, cancellation during playback, replacement by a new answer, truthful renderer playback failure, recovery after preparation, and rejection while another surface owned presentation. Types and source checks passed, as did 296 relevant contract/regression tests. The QA bundle contained 70 source modules and no installed-app controller, tunnel or credential service.

Whole-GPU usage started at 3,212 MiB, peaked at 7,544 MiB, and ended at 2,691 MiB; the smallest reported free capacity was 481 MiB across 111 samples. These numbers include other applications and are not an isolated model allocation. Long-form operation succeeded, but concurrent GPU workloads can leave little headroom on an 8 GB device.

Observed renderer audio was mono 48 kHz, with the existing worker PCM16 transport and native 24 kHz synthesis/resampling. This run establishes local Qwen ICL delivery and lifecycle behavior, not VoxCPM2, other hardware, a maximum-length stress result, installed-app UI behavior, or subjective pronunciation/transcription accuracy. Two segments in the repeated synthetic input lasted 57.6 seconds; all input text reached the engine, but sample counts cannot establish that the model spoke every word once. Natural wording is caller-authored and must be reviewed for content preservation. No acoustic recording, automatic speech recognition or additional OpenAI call was used. The installed application, profiles and tunnel were untouched; installing a rebuilt app and refreshing the connected plugin schema remain separate deployment steps.
