# Qwen Q8 CUDA SM86 candidate

Status: **native build, ABI and isolated CUDA worker inference passed on an
RTX 3060 Ti 8GB on 2026-10-04**. See the measured scope below. The source runtime
catalog and both worker policies now pin the exact tested candidate bytes, and
the source UI distinguishes Qwen SM86/SM89 support from Vox SM89 support. Native
archives remain external build outputs. The installed app was not changed.
Both x-vector and ICL worker inference passed. Isolated ICL UI/IPC and native
Web Audio playback also passed. A local unsigned installer later passed static payload verification; the owner
reported installed-app voice output. Perceptual quality and complete desktop,
install/uninstall and clean-host acceptance remain separate. See the
[fork packaging evidence](daemonlet-3060-identity.md).

The target retains Qwen 0.6B Base Q8 + codec Q8, ABI 5, WAV x-vector/ICL cloning,
existing streaming and cancellation contracts, exact Python/package versions,
and full DLL/model hashing. It does not use the legacy Torch engine. Vox and
Vulkan binaries are not rebuilt by this workflow.

## Measured candidate

One native build used the fixed inputs below. The actual `ggml-cuda.dll` contains
144 SM86 and 144 SM89 ELF device-code entries. All five DLLs passed AMD64 PE
checks. The C ABI smoke executable exited 0; a separately compiled C11 probe
matched ABI 5, all four structure sizes and all 42 field offsets in the worker
policy. Dependency inspection found the expected ggml, CUDA 13 cuBLAS and
Microsoft runtime imports. The copied managed runtime loaded these DLLs without
adding dependencies to the installed app.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `qwen-cuda-sm86-sm89-a223d6db26d1.zip` | 74,573,726 | `0106862dc48d025855352c8b797c9d1b81471330adf1481eb099fe331daf192a` |
| `ggml-cuda.dll` | 87,540,736 | `a223d6db26d15431335592cb4e9442bafaf07f66d4258c195683723ec8300335` |

The generated catalog SHA-256 is
`700b89f333b6217a91a3158a7367b8500a67723e28db392c247b3d5a43d9a50a`.
Other DLL hashes, commands and tool versions are in the external build receipt.
The builder's `BUILT_NOT_GPU_VALIDATED` result and candidate provenance describe
its build-only stage; separate ABI/GPU reports supply the subsequent evidence.
They are not admission overrides. The source catalog now pins this candidate;
the later local installer used these same content pins.

The isolated application worker used its managed Python 3.11.15 and packages,
the existing Q8 talker/codec after full 1,283,766,112-byte weight verification,
and an authorized reference WAV in x-vector mode. Readiness reported CUDA0,
RTX 3060 Ti, CC8.6, Driver API 13010 and ABI 5. The installed NVIDIA driver was
591.86. One process completed these Korean streaming requests:

| Request | Output audio | Generation wall time | First PCM after request | RTF |
| --- | ---: | ---: | ---: | ---: |
| Initial short request | 4.16 s | 1.650 s | 155 ms | 0.397 |
| Same short request, warm | 4.16 s | 1.495 s | 53 ms | 0.359 |
| Longer request, warm | 15.60 s | 4.918 s | 57 ms | 0.315 |
| Request after cancellation | 3.68 s | 1.260 s | 43 ms | 0.342 |

Initial readiness took 22.637 seconds, including model/runtime integrity checks,
imports, model loading and reference preparation; the first-PCM figures exclude
that startup. RTF is generation time divided by audio duration; these results
were faster than playback. Matching short requests with seed 42 produced the
same WAV hash. All four outputs were continuous 48kHz mono PCM16, non-silent,
with no full-scale samples; this is not a perceptual quality assessment.

Cancellation after the first chunk completed at a native-step boundary, removed
the cancelled WAV, and retained one prepared reference in the same worker PID.
The following request succeeded. Shutdown acknowledged cleanup and exited 0.

Global VRAM started at 3,708 MiB, peaked at 7,314 MiB of 8,192 MiB, and measured
4,205 MiB after exit. Other GPU workloads remained running and their usage varied.
These are whole-GPU readings, not exact per-engine allocations or proof that
every concurrent workload will fit. This run establishes that the tested Qwen
Q8 path can run on this 8GB card without changing quantization or disabling
integrity, ABI, driver or capability checks. It does not establish VoxCPM2
memory fit, RTX4090 behavior of this new build, clean-host readiness or long-run
stability.

Two initial probe attempts reached GPU/model readiness but failed on Korean
input because the external harness omitted the supervisor's `-X utf8` option.
The successful run used the actual managed launch flags
`-I -B -u -X utf8`, offline settings and isolated caches. A diagnostic traceback
was added only to the copied worker's error handler. No native or admission
check was bypassed to correct this harness error. Private logs, reference paths,
WAVs and compiler artifacts remain outside Git.

## Paired x-vector and ICL measurement

A follow-up on 2026-10-04 used the same explicitly supplied 18.226-second,
48kHz mono PCM16 reference and the user's exact reference transcript. Each mode
ran in its own fresh worker with the same tested candidate, Q8 models, five
output texts and seed 42. ICL used the reference transcript; x-vector used an
empty transcript. Mode-specific prompt-cache keys were verified. The original
reference and installed voice-settings hashes were unchanged after both runs.

| Request | ICL audio / wall time / first PCM / RTF | x-vector audio / wall time / first PCM / RTF |
| --- | --- | --- |
| Initial short request | 4.48 s / 2.069 s / 456 ms / 0.462 | 4.16 s / 1.547 s / 113 ms / 0.372 |
| Same short request, warm | 4.48 s / 1.621 s / 79 ms / 0.362 | 4.16 s / 1.289 s / 58 ms / 0.309 |
| Longer request, warm | 13.68 s / 4.650 s / 108 ms / 0.340 | 15.60 s / 4.759 s / 64 ms / 0.305 |
| Request after cancellation | 3.52 s / 1.383 s / 73 ms / 0.393 | 3.68 s / 1.211 s / 49 ms / 0.329 |

Fresh-worker readiness took 17.208 seconds for ICL and 17.058 seconds for
x-vector; the request timings above exclude startup. Within each mode the
initial and warm short requests produced byte-identical WAVs. All eight saved
outputs passed sample continuity, format and non-silence checks, with no
full-scale samples. Both modes cancelled after the first chunk, removed its
temporary audio, reused the same PID with one prepared reference, successfully
generated again and shut down with exit code 0.

Whole-GPU VRAM baseline / peak / after-exit was 3,294 / 6,498 / 3,286 MiB for ICL
and 3,302 / 6,428 / 3,300 MiB for x-vector. Other applications kept running;
these are sampled global readings, not exact engine memory allocations. This
is one sequential trial per mode, not a statistical benchmark. The generated
durations differ, so wall time alone does not compare throughput. Neither
waveform validation nor lower latency establishes voice similarity,
pronunciation or naturalness; listening comparison remains outstanding.

## Approved build inputs

`scripts/runtime/qwen-sm86-build.json` fixes these inputs:

- qwentts.cpp: `https://github.com/ServeurpersoCom/qwentts.cpp`, commit
  `6fae92914045cd83364d2845ceaa0f7969727319`.
- ggml: `https://github.com/ServeurpersoCom/ggml`, commit
  `40e16e4a814f7fe851a0c486fb9e8c722e957830`.
- Windows x64, Visual Studio 2022, MSVC `14.35.32215`, CUDA Toolkit `13.0.48`,
  Windows SDK `10.0.22621.0` (reuse an existing installation).
- Explicit `CMAKE_CUDA_ARCHITECTURES=86;89`; CUDA graphs enabled. CCCL/NCCL
  acquisition and FetchContent updates/downloads disabled.

Source acquisition, toolchain installation, CMake/upstream build execution and
native inference require approval of those actions. The repository utility
never acquires dependencies. Do not reuse an incompatible compiler by disabling
its compatibility checks. CUDA runtime redistributables already installed for
Daemonlet are not a CUDA compiler/toolkit.

After approval, stage pristine source checkouts at the exact commits (including
no ignored/untracked inputs) and use a new output directory outside all input
trees and the application checkout. Do not run this against a live app folder.
Set `core.autocrlf=false` locally when creating each source checkout, before its
first checkout; do not change the user's global Git configuration. In particular,
ggml has no LICENSE newline attribute. Its pinned license bytes are LF, and a
Windows CRLF checkout must be restaged before building. License hashes are checked
before CMake runs as well as during candidate generation.

```powershell
python -B scripts/runtime/build-qwen-sm86.py `
  --qwen-source '<pinned-qwentts-checkout>' `
  --ggml-source '<pinned-ggml-checkout>' `
  --cuda-root '<approved-CUDA-v13.0>' `
  --cmake '<existing-cmake.exe>' --git '<existing-git.exe>' `
  --output '<new-external-build-directory>' --execute-build
```

The utility builds `qwen`, `qwen-tts` and `test-abi-c`; it does **not** run any of
them. It inspects the built CUDA DLL with the approved Toolkit's `cuobjdump`,
requires both SM86 and SM89 device code, checks AMD64 PE DLL headers, and retains
the pinned MIT licenses. It verifies source cleanliness before and after build.
Build logs and an external receipt retain exact commands. Never commit their
machine-specific paths or compiler outputs.

## Candidate output and integration

The output's `candidate/` directory contains a deterministic ZIP with exactly
five native DLLs and two license files, a new managed catalog, updated copies of
both worker policies, device-code listing, and `candidate-result.json`.
Hashes and byte counts are calculated from real generated bytes. No placeholder
binary hashes exist. The result remains `BUILT_NOT_GPU_VALIDATED` and
`abiExecuted=false`; the executable ABI test remains a separate approved step.

The runtime gate accepts SM86 only for the Qwen build-candidate contract with
the pinned sources, architecture list and CUDA version in the app-owned catalog.
Driver API >=13000 and the actual device's compute capability are still checked.
Vox retains its original CC8.9 restriction. An editable external receipt or a
capability-only edit cannot admit the original SM89 binary on SM86.

Review and explicitly adopt the generated catalog/policies into an isolated
development checkout/app before testing. They are not a new runtime-settings
override; the existing worker hashes and ABI checks remain mandatory. Updating
the catalog also updates its byte/hash pin in **both** policy copies. The Vox
copy changes only that catalog pin, not its native files or source hashes.
Keep `validatedGpuNames=[]` until real hardware evidence exists. A future
validated contract should be reviewed with its evidence, not created by editing
a user receipt.

The app derives a distinct managed root from the catalog hash. For an isolated
candidate, reuse verified copies of the existing shared-Python and CUDA-redist
archives; do not alter the installed profile's marker, receipts or files. Models
can be selected from an existing directory read-only after full hash checks.
Do not copy a settings file wholesale, switch the user's active engine, or
download another copy of the Q8 models.

Full Forge packaging still needs all six pinned runtime archives, including
Vulkan components. A source-only development build is not a releasable
installer. If only Qwen CUDA is tested, use a separate development profile and
the three required components rather than bypassing release resource checks.
The source UI now uses Qwen-specific CC8.6/CC8.9 wording and identifies the
RTX3060Ti speech-generation result as a test build with full application
validation pending. Vox and Vulkan retain their existing device requirements.

## Application integration preflight and remaining acceptance

The real candidate also passed the repository's Node archive-schema validation
and both worker catalog-pin checks. A source-only build report was correctly
rejected as an installer candidate. A separate admission check used the actual
application `compact-v1` layout: the catalog marker, schema-2 active receipt,
component provenance receipts, short content-addressed paths, full component
hashes, Python/package versions and all native-file pins passed. The real driver
reported CC8.6 and Driver API 13010. This check did not rerun inference; inference
used the same candidate bytes in the previously measured schema-1 layout.

Hash-policy integration is complete in both the generated candidate and the
default source catalog/policies. Source adoption happened after the native/GPU
and compact-layout checks; the three JSON files were copied byte-for-byte from
the tested candidate. **Built-application acceptance is still incomplete**.
The earlier separation was a staging decision while hardware evidence was being
established, not a requirement imposed by CUDA or the hash design.

Minimal remaining sequence:

1. Lockfile dependencies and Electron 43.4.0 are now prepared following explicit
   installation approval. The existing official Node 24.21.0/npm 11.19.0 was
   reused. `npm ci --ignore-scripts` installed 419 packages exclusively from
   `registry.npmjs.org`; then the pinned Electron package's explicit installer
   used the official Electron GitHub release and bundled checksums. The lockfile
   is unchanged. No Node/npm reinstall or global package update was performed.
   The existing C++ and CUDA tools need no further installation for Qwen.
2. The candidate catalog and **both** worker-policy JSON files have been adopted
   together. The engine-specific support/error wording in
   `src/character-chat/VoiceControls.tsx`, English keys in
   `electron/shared/messages.en.json`, and the GGUF/Qwen control tests were updated.
   Preserve the exact tested archive. Keep Qwen's local worker evidence separate
   from Vox/RTX4090/full-app claims. Run the related installer, terms, supervisor,
   service and UI tests plus type checking once dependencies are available.
3. Exercise the actual voice UI/IPC/audio player in a dedicated QA entry with a
   fresh profile and cache, the three verified Qwen CUDA components, existing
   models selected read-only, and a copied authorized reference. This avoids
   starting unrelated application services. `DAEMONLET_DATA_HOME` sets user and
   session storage before the single-instance lock; explicitly isolate adapter
   storage as well. A profile path alone is not the entire isolation boundary:
   the full `AppController` also constructs the OS credential/tunnel and update
   services. Do not use normal development startup unchanged for this voice-only
   test, copy existing settings/credentials, or reuse existing tunnel metadata.
4. Isolated UI-triggered playback, stream credits, stop/cancellation, same-worker
   re-request and unload passed below. Complete user-led replay, runtime reconnect
   and full desktop/release acceptance. Preserve the application's normal
   runtime-terms flow in the fresh profile; never fabricate an acceptance receipt.
   The older `real-voice-lipsync-ui-smoke.mjs` and `qwen-voice-ab.ts` are not ready
   substitutes: the former expects a separate pose/generation format, while the
   latter selects the legacy Torch Qwen engine.
5. The isolated GGUF ICL/x-vector comparison with the user's reference transcript
   is complete, as measured above. Compare the paired output WAVs by listening.
   No listening or ASR assessment was performed, so waveform checks do not
   establish pronunciation, voice similarity or naturalness. ICL in the actual
   full desktop and packaged playback path remains separate acceptance.
6. Historical candidate-stage packaging checklist (subsequently completed for
   the local installer): stage all six exact archives under
   `.generated/voice-gguf-runtime/win32-x64/archives`, plus the catalog-pinned
   character-chat runtime. The verified Qwen CUDA candidate and existing shared,
   CUDA-redist and Vox CUDA archives are available. The known authorized sources
   lack `qwen-vulkan-win32-x64.zip` (14,611,999 bytes) and
   `vox-vulkan-win32-x64.zip` (20,318,925 bytes); the checkout also lacks the staged
   character-chat runtime. Obtain those approved exact artifacts before packaging.
   Do not weaken Forge's six-archive or chat-runtime checks. Package into a new
   output location and test that artifact with a fresh profile before considering
   any installed-app replacement.

The checklist above records the earlier candidate-stage boundaries. The later
local installer and owner-led installation are described in the fork packaging
evidence. These source changes do not perform an installed-app replacement.

### Isolated Electron ICL QA

After approval, `scripts/voice-qa/` builds an external development-only entry
using the actual `VoiceIpcController`, `CharacterVoiceService`, reference import
worker, `VoiceSettings`, `VoiceControls` and `AudioPlaybackController`. A build
graph check rejects AppController, credential, tunnel, autostart, update-service
and real chat-service inputs. The first bundle had 81 inputs and no prohibited
service. A fresh user/session profile and private browser partition are used;
renderer permissions and external requests are denied. Existing Q8 models are
read-only inputs. The worker files, catalog and policies come directly from the
current default source, with compact-layout component hashes verified again.

The initial Electron 43.4.0 preflight passed seven UI/IPC checks and correctly
stopped at unaccepted Microsoft runtime terms. After the user explicitly agreed,
the QA called the normal acceptance IPC in its own profile. No existing receipt
was copied and no system-wide runtime package was installed.

The terms cover Microsoft V14 14.51.36247.0 and the NumPy-bundled Microsoft
2015-2022 runtime 14.40.33810.0. The current fingerprint is
`56a9fcf67874a854b2bdfd8c97e87e035d5e448eb4f25c79f977837ec0029c5e`.
The external QA configuration's `runtimeTermsApproved` flag may only be set after
explicit approval. It selects the normal acceptance action; it does not bypass
the application terms guard or integrity checks.

Two subsequent runs passed real native Web Audio decoding, scheduling, playback
completion, stop, re-request and same-worker reuse. The final run passed 14 checks
including visible-renderer readiness, ICL selection and exact transcript binding,
empty-transcript rejection/recovery, actual CC8.6 initialization, non-silent
48kHz mono audio, stop and same-PID/session re-request. Model verification hashed
all 1,283,766,112 bytes. The native prompt key matched the prior independently
verified ICL worker run.

In that final run readiness took 20.143 seconds. The first scheduled playback
time was 1.035 seconds after the speech request, 0.681 seconds for the next
request and 0.716 seconds after cancellation, including the player's 240ms
initial scheduling buffer. These are application timing measurements, not an
acoustic output measurement. Stop completed in 44ms; the native cooperative
acknowledgement took 43ms at a `native-step` boundary, kept the worker warm and
retained one prepared reference. One PID and session were preserved throughout.
Web Audio recorded 25 decoded/scheduled chunks across two complete requests and
one interrupted request, with one explicit source stop. The application returned
to idle without error and shut down cleanly.

The first playback attempt timed out before a Web Audio context was created.
The diagnostic retry observed a page initially hidden before becoming visible.
The QA now waits for an actually visible page before issuing actions, and its
final rerun passed. This timing fix is limited to the QA entry; no production
playback, visibility, hash, ABI, capability or terms guard was weakened. Failure
and successful-run evidence remain outside Git. Original reference and installed
voice-settings hashes were checked unchanged after the tests.

Full repository type checking, including the QA entry, passed. Twelve related
test files ran: 260 tests passed; one runtime-installer symlink rejection test
could not create its fixture on this Windows account (`EPERM`). No OS security
setting was changed to make that fixture run. This is a test-environment
limitation, not evidence that the symlink rejection case passed.

The QA uses Electron's application APIs and real Web Audio events. Official CUA
tools are unavailable in the delegated session; no OS screenshot or UI automation
workaround was used. Physical speaker output and perceptual quality still require
human listening or an approved observation path. The complete desktop application,
release package, other engine and GPU combinations remain separate acceptance.

## Validation

CPU checks require no SDK, models, downloads or native execution:

```text
python -B -m unittest discover -s tests -p qwen_sm86_build_test.py
python -B -m unittest discover -s tests -p managed_gguf_runtime_test.py
python -B scripts/test-qwen-gguf-worker.py --require-pcm
```

The last command uses existing numpy/scipy for fake-native PCM fixtures.
Synthetic PE fixtures prove generation and rejection logic, not real DLL
correctness. The first two suites are also included in Linux and Windows CI.

After separate native-execution approval:

1. Execute the built ABI test; retain ABI layout/export and DLL dependency
   results. Load through the application worker's exact Python 3.11.15 runtime.
2. Verify the real CUDA0 device is RTX 3060 Ti CC8.6, Driver API >=13000, model
   type is `base`, and all five DLL/two Q8 model hashes match the candidate.
3. With an authorized reference WAV, test x-vector and ICL using short/long
   Korean text, one cold load and at least two warm requests. Save WAVs without
   automatic playback, then assess quality separately.
4. Record peak VRAM, first PCM delay, RTF, cancellation/re-request and engine
   unload. Record concurrent GPU workloads as a measurement limitation; never
   stop unrelated processes.
5. Test in a separate app profile and verify its engine/model/runtime selectors,
   application playback and cleanup before declaring full application support.
   Keep worker-only hardware evidence distinct from application acceptance.

No 8GB memory budget is inferred from the 1.28GB model download. Native buffer,
reference and graph allocations still need measurement. No automatic CPU
fallback, memory-check removal or model quantization change is introduced.
