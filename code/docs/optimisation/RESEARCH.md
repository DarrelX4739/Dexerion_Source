# Dexerion Optimisation — Research Log

Date of research: 2026-11-26 and 2026-11-27 (session spanned midnight). Purpose: evidence base for the Dexerion vs Edge
resource-usage mission (≥40% reduction in CPU/RAM/GPU/power under active
browsing, measured process-tree-wide, without sacrificing functionality,
compatibility, stability, or foreground responsiveness).

Method: direct fetches and structured web searches; each row below was either
fetched directly (VERIFIED — the title/snippet is drawn from the page itself or
its search-result snippet) or could not be fetched (UNVERIFIED — no takeaway
invented). All rows are distinct URLs. Rows are grouped by topic for
readability; the index is continuous across groups.

Row format: `[index] | title — publisher | URL | accessed 2026-11-26 | takeaway` (rows verified after midnight carry 2026-11-27)

---

## Group A — Chromium command-line switches, features & field trials

[1] | List of Chromium Command Line Switches — Peter Beverloo | https://peter.sh/experiments/chromium-command-line-switches/ | 2026-11-26 | Live index of 1,549 command-line switches and 4,986 feature flags in Chromium — the authoritative reference for every switch this plan proposes.

[2] | How Chromium's Zero-Copy Rasterization Works — salivity/chromium article | https://salivity.github.io/chromium/article/how-chromium-s-zero-copy-rasterization-works | 2026-11-26 | Zero-copy raster lets the GPU sample tiles straight from the CPU-shared buffer, eliminating the one-copy upload pass — explains what `--enable-zero-copy` saves in memory bandwidth and GPU work.

[3] | Software vs. GPU Rasterization in Chromium — Intel | https://www.intel.com/content/www/us/en/developer/articles/technical/software-vs-gpu-rasterization-in-chromium.html | 2026-11-26 | Intel's own guidance: with GPU rasterization the GPU process stays idle after setup, improving performance and saving battery — but CPU raster can win for SVG-heavy content.

[4] | How to get GPU Rasterization — The Chromium Projects | https://www.chromium.org/developers/design-documents/chromium-graphics/how-to-get-gpu-rasterization/ | 2026-11-26 | GPU rasterization can be vetoed per content (e.g. many non-convex SVG paths), so enabling it is not a guaranteed win — informs the adaptive cap10 tier's choice to raster on CPU.

[5] | How Out-of-Process Rasterization Improved Chromium — salivity/chromium article | https://salivity.github.io/chromium/article/how-out-of-process-rasterization-improved-chromium | 2026-11-26 | OOP-R moved tile raster into the GPU (or raster) process, isolating the renderer from raster stalls — background for understanding where raster memory and GPU cost live.

[6] | These Chrome flags made my browser noticeably faster — MakeUseOf | https://www.makeuseof.com/these-chrome-flags-make-browser-faster/ | 2026-11-26 | Popular press confirms user-visible impact of zero-copy/GPU-rasterizer flags — evidence the levers are real but must be measured, not assumed.

[7] | How to get GPU Rasterization (mirror) — Chromium playground site | https://chromium.googlesource.com/playground/chromium-org-site/+/refs/heads/main/developers/design-documents/chromium-graphics/how-to-get-gpu-rasterization/index.md | 2026-11-26 | Same GPU-raster guidance in the source repo — useful for reading the flag plumbing next to the code.

[8] | Chromium Graphics // Chrome GPU — The Chromium Projects | https://www.chromium.org/developers/design-documents/chromium-graphics/ | 2026-11-26 | Hub page for impl-side painting, zero-input-latency scheduler, GPU rasterization, property trees — the map of every graphics lever Dexerion can flip.

[9] | Zero copy or one copy rasterizer? — Reddit r/chromeos | https://www.reddit.com/r/chromeos/comments/2xahwh/zero_copy_or_one_copy_rasterizer/ | 2026-11-26 | Practitioner comparison of zero-copy vs one-copy: zero-copy wins when the CPU would otherwise pay the upload copy; weak-GPU systems sometimes prefer one-copy.

[10] | Chromium GPU Hardware Acceleration Freezing (flag settings) — LaptopJudge | https://laptopjudge.com/chromium-gpu-hardware-acceleration-freezing/ | 2026-11-26 | Wrong GPU path settings can freeze Chromium — a caution that GPU flag changes need frame-time verification, matching Dexerion's e2e `--gpu=off` test seam.

[11] | Multi-process Architecture — The Chromium Projects | https://www.chromium.org/developers/design-documents/multi-process-architecture/ | 2026-11-26 | Canonical description of browser/renderers/GPU process split — the structural reason renderer-process-limit and process-per-site change the per-tab memory floor.

[12] | How Chromium Displays Web Pages — The Chromium Projects | https://www.chromium.org/developers/design-documents/displaying-a-web-page-in-chrome/ | 2026-11-26 | Walks the WebKit→compositor→GPU pipeline a tab pays for on every load; grounding for why hidden background views save whole pipeline stages.

[13] | Process Models — The Chromium Projects | https://www.chromium.org/developers/design-documents/process-models/ | 2026-11-26 | Documents process-per-site vs process-per-site-instance trade-offs: process-per-site coalesces same-site tabs into one renderer, cutting process overhead at some isolation cost.

[14] | Profile Architecture — The Chromium Projects | https://www.chromium.org/developers/design-documents/profile-architecture/ | 2026-11-26 | Each profile owns its own storage/cache in Chromium — relevant to Dexerion's per-account partitions, each of which carries a separate disk-cache cost.

[15] | Inter-process Communication (IPC) — The Chromium Projects | https://www.chromium.org/developers/design-documents/inter-process-communication/ | 2026-11-26 | IPC design and costs — background for reducing renderer↔browser chatter (preview message limits) as a real power lever.

[16] | Multi-process Resource Loading — The Chromium Projects | https://www.chromium.org/developers/design-documents/multi-process-resource-loading/ | 2026-11-26 | How resource loads cross from renderer to browser network stack — each crossing is scheduling overhead the browser process pays for every tab.

[17] | Sandbox — Chromium Docs (source) | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/design/sandbox.md | 2026-11-26 | Sandbox design docs; Dexerion keeps sandboxing intact while tuning process counts, so this is the safety boundary the plan must respect.

[18] | Startup — Chromium Docs (source) | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/design/startup.md | 2026-11-26 | Chromium startup critical path — early work in the browser process is what a lean boot avoids; informs lazy-loading main-process modules.

[19] | Threading — Chromium Docs (source) | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/design/threading.md | 2026-11-26 | Browser-process thread inventory (UI/IO/cache) — every timer the main process arms lands on one of these threads, so sweep cadence is real power, not abstraction.

[20] | GPU Accelerated Compositing in Chrome — The Chromium Projects | https://www.chromium.org/developers/design-documents/gpu-accelerated-compositing-in-chrome/ | 2026-11-26 | Full compositing design: layered model, why animating layers costs GPU memory and compositing work — the mechanism behind hiding inactive views.

[21] | GPU Architecture Roadmap — The Chromium Projects | https://www.chromium.org/developers/design-documents/gpu-accelerated-compositing-in-chrome/gpu-architecture-roadmap/ | 2026-11-26 | The viz/display-compositor migration plan; shows which GPU-process costs are architectural (unavoidable) vs policy (tunable).

[22] | Rendering Architecture Diagrams — The Chromium Projects | https://www.chromium.org/developers/design-documents/rendering-architecture-diagrams/ | 2026-11-26 | Visual reference for the render pipeline stages a background tab can skip once its view is hidden.

[23] | Graphics and Skia — The Chromium Projects | https://www.chromium.org/developers/design-documents/graphics-and-skia/ | 2026-11-26 | Skia is Chromium's 2D raster backend; its config (GL vs software backend) is what gpu-rasterization switches actually toggle.

[24] | RenderText and Chrome UI text drawing — The Chromium Projects | https://www.chromium.org/developers/design-documents/rendertext/ | 2026-11-26 | Chrome UI text rendering path — the browser process' own paint cost that dexerion:// shell pages add on top of web content.

[25] | GPU Command Buffer — The Chromium Projects | https://www.chromium.org/developers/design-documents/gpu-command-buffer/ | 2026-11-26 | The renderer↔GPU-process API: command buffer scheduling and shared memory — where `--force-gpu-mem-available-mb` and zero-copy interact.

[26] | Compositor Thread Architecture — The Chromium Projects | https://www.chromium.org/developers/design-documents/compositor-thread-architecture/ | 2026-11-26 | Compositor thread owns activation/draw; blocking it stalls the UI — background knowledge for the in-process-gpu AppHangB1 hazard noted in main.js.

[27] | Rendering Benchmarks (aka Smoothness benchmarks) — The Chromium Projects | https://www.chromium.org/developers/design-documents/rendering-benchmarks/ | 2026-11-26 | Chromium's own smoothness benchmarks — a template for verifying that power levers do not regress frame production.

[28] | Multithreaded Rasterization — The Chromium Projects | https://www.chromium.org/developers/design-documents/impl-side-painting/ | 2026-11-26 | Impl-side painting decouples raster from the main thread — why disabling GPU raster falls back to CPU raster threads rather than serial work.

[29] | Video Playback and Compositor — The Chromium Projects | https://www.chromium.org/developers/design-documents/video-playback-and-compositor/ | 2026-11-26 | Video frames overlay the compositor; hardware decode keeps video cheap — supports keeping hardware video decode on in every GPU tier.

[30] | Network Stack — The Chromium Projects | https://www.chromium.org/developers/design-documents/network-stack/ | 2026-11-26 | Network stack design (sockets, pools, priorities) — background tab socket pressure is a CPU/battery cost Edge also manages.

[31] | Disk Cache — The Chromium Projects | https://www.chromium.org/developers/design-documents/network-stack/disk-cache/ | 2026-11-26 | Disk cache backends (blockfile vs simple) and their I/O profiles — the basis for choosing a lighter cache backend/size for a lean browser.

[32] | HTTP Cache — The Chromium Projects | https://www.chromium.org/developers/design-documents/network-stack/http-cache/ | 2026-11-26 | HTTP cache semantics and sizing — cache-size policy is a disk-I/O and therefore power lever with no functional loss if sized sanely.

[33] | DNS Prefetching — The Chromium Projects | https://www.chromium.org/developers/design-documents/dns-prefetching/ | 2026-11-26 | Speculative DNS on page parse; for an offline-first profile it is wasted radio/CPU work that can be tuned off per session.

[34] | Accessibility Technical Documentation — The Chromium Projects | https://www.chromium.org/developers/design-documents/accessibility/ | 2026-11-26 | Accessibility tree building costs renderer memory/CPU when triggered; must remain available on demand but need not run eagerly for every background tab.

[35] | Auto-Throttled Screen Capture and Mirroring — The Chromium Projects | https://www.chromium.org/developers/design-documents/auto-throttled-screen-capture-and-mirroring/ | 2026-11-26 | Chromium itself throttles frame delivery for capture — precedent that delivery-rate policy (not feature removal) is a legitimate efficiency lever.

[36] | Browser Window — The Chromium Projects | https://www.chromium.org/developers/design-documents/browser-window/ | 2026-11-26 | Browser-window object model — context for Dexerion's WebContentsView-per-tab window architecture costs.

[37] | DirectWrite Font Cache (obsolete) — The Chromium Projects | https://www.chromium.org/developers/design-documents/directwrite-font-cache/ | 2026-11-26 | Historical Windows font-cache sharing design; shows a prior art of moving expensive font work to a shared service.

[38] | Aura — The Chromium Projects | https://www.chromium.org/developers/design-documents/aura/ | 2026-11-26 | Aura windowing layer — the layer between Chromium windows and the OS compositor on desktop; relevant to occlusion/visibility decisions.

[39] | How to Measure Power Using Intel SoC Watch Software — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/gpu/power-measurement-with-intel-socwatch.md | 2026-11-26 | Chromium's own guide to measuring power with Intel SoC Watch — corroborates the RAPL approach the Dexerion benchmark uses and offers an external cross-check tool.

[40] | Process Model and Site Isolation — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/process_model_and_site_isolation.md | 2026-11-26 | Details how process-per-site vs per-site-instance affects renderer count and memory; `--process-per-site` collapses same-site tabs, the exact switch Dexerion already uses.

[41] | BFCache Overview — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/bfcache.md | 2026-11-26 | Back/forward cache freezes a page in the renderer with all tasks frozen — the Chromium-native pattern for "background without cost" that Dexerion's sleep approximates.

[42] | Life of a frame — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/life_of_a_frame.md | 2026-11-26 | Frame production costs from rAF through BeginFrame to swap — why suspending frame production for hidden views (as Dexerion does) eliminates a full pipeline of work.

[43] | Threading and Tasks in Chrome — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/threading_and_tasks.md | 2026-11-26 | Task-runners and sequence semantics in the browser process — the rules any main-process sweep timer must follow to avoid waking idle cores.

[44] | Threading and Tasks in Chrome — FAQ — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/threading_and_tasks_faq.md | 2026-11-26 | Practical FAQ on posting tasks and delays — relevant to coalescing Dexerion's periodic housekeeping into fewer, longer-delayed wakeups.

[45] | Intro to Mojo & Services — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/mojo_and_services.md | 2026-11-26 | Chromium service architecture: each service (network, audio, storage) is a process with IPC overhead — context for which utility processes a lean browser must still keep.

[46] | Life of a Navigation — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/navigation.md | 2026-11-26 | Navigation commit pipeline — speculative loads and prefetches during navigation are CPU/network costs that a lean browser can keep strictly on-demand.

[47] | Chrome Shutdown — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/shutdown.md | 2026-11-26 | Shutdown path and lingering processes — fast, complete teardown avoids orphaned background work after the window closes.

[48] | Key Concepts in Chrome Memory — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/memory/key_concepts.md | 2026-11-26 | Defines resident/private/shared memory as Chromium measures it — aligns Dexerion's working-set-based cap with Chromium's own accounting.

[49] | Mission (memory objectives) — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/memory/objectives.md | 2026-11-26 | Chrome's stated memory objectives and metrics (V8 heap, partition alloc) — the industry baseline Dexerion's RAM budget competes against.

[50] | Investigating Out of Memory crashes — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/memory/oom.md | 2026-11-26 | OOM crash investigation — the risk side of aggressive memory caps: caps must never push a long session into renderer OOM.

[51] | Tools for understanding memory usage — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/memory/tools.md | 2026-11-26 | Catalog of memory tools (mem-infra traces, heap dumps) the Tester can reuse to attribute per-process RAM beyond working sets.

[52] | Graphics Memory Metrics — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/memory/graphics_metrics.md | 2026-11-26 | Tracks GPU memory (command buffers, textures, GPU peak) — the GPU-memory side of the mission metric, measurable alongside GPU Engine counters.

[53] | Heap Profiling with External Tools — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/memory/heap_profiling_external.md | 2026-11-26 | Heap profiling workflow — supports attributing main-process RAM to specific modules before trimming caches.

[54] | How Chrome Measures Performance — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/speed/how_does_chrome_measure_performance.md | 2026-11-26 | Chrome's perf measurement methodology — a model for Dexerion's repeated, controlled benchmark protocol.

[55] | Properties of a Good Top Level Metric — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/speed/good_toplevel_metrics.md | 2026-11-26 | Metric design criteria (stable, actionable, low-noise) — directly applicable to designing the CPU/RAM/GPU/power comparison against Edge.

[56] | Making Metrics Actionable with Diagnostic Metrics — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/speed/diagnostic_metrics.md | 2026-11-26 | Diagnostic metrics tie headline numbers to causes — the pattern for explaining any Dexerion-vs-Edge delta rather than just reporting it.

[57] | Investigating scroll/animation jank — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/speed/debug-janks.md | 2026-11-26 | Jank investigation on the compositor — the verification path that guarantees power levers never degrade foreground smoothness.

[58] | Addressing Performance Regressions — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/speed/addressing_performance_regressions.md | 2026-11-26 | Chromium's regression-response process — the guardrail protocol for rolling back a lever that regresses speed while saving power.

[59] | Graphics metrics: Definitions — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/speed/graphics_metrics_definitions.md | 2026-11-26 | Canonical definitions (FPS, jank, GPU time) so the Tester's GPU measurements use standard semantics.

[60] | Regressions to Competitive Benchmarks — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/benchmark_performance_regressions.md | 2026-11-26 | Explicit policy against regressing competitive benchmarks — mirrors the mission's "no benchmark gaming" constraint.

[61] | Trace Event Best Practices — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/trace_events.md | 2026-11-26 | Trace events are the substrate for chrome://tracing — enables verifying which main-process work fires per second without adding measurement overhead.

[62] | Servicifying Chromium Features — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/servicification.md | 2026-11-26 | Feature→service migration explains why utility processes appear (audio, network) and which are safe to consolidate or leave.

[63] | Using Chromium with SwiftShader — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/gpu/swiftshader.md | 2026-11-26 | SwiftShader CPU fallback renderer — what `--disable-gpu` actually falls back to; confirms software rendering is a correctness fallback, not a power strategy.

[64] | CHROMIUM Sync Token Internals — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/gpu/sync_token_internals.md | 2026-11-26 | Sync tokens order GPU work across processes — background for why zero-copy and shared images affect GPU scheduling costs.

[65] | Audio Focus Handling — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/media/audio_focus.md | 2026-11-26 | Audio focus rules across tabs — audible tabs are exempt from Dexerion's sweeps for exactly the reasons this doc implies.

[66] | Autoplay of HTMLMediaElements — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/media/autoplay.md | 2026-11-26 | Autoplay policy — a background tab that autoplays silently keeps waking the audio service; Dexerion's audible-tab guard must stay strict.

[67] | Audio Latency Tracing — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/media/latency_tracing.md | 2026-11-26 | Audio pipeline tracing — the audio service process is a fixed power floor for any browser with sound; useful when comparing process trees to Edge.

[68] | Chrome Media Router — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/media/media_router.md | 2026-11-26 | Media Router (cast) service — exactly what Dexerion disables via MediaRouter/DialMediaRouteProvider features; this doc shows the background machinery being skipped.

[69] | What is RenderDocument? — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/render_document.md | 2026-11-26 | RenderDocument (compositor-owned documents) reduces renderer↔browser compositor surface churn on navigation — a Chromium-native savings Dexerion inherits automatically.

[70] | 103 Early Hints — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/early-hints.md | 2026-11-26 | Early hints preload/prefetch speculative resources — network/CPU work that should stay tied to real navigations in a lean profile.

[71] | Bitmap Pipeline — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/bitmap_pipeline.md | 2026-11-26 | Bitmap (non-GPU) rendering path for compositing on CPU — the true fallback semantics behind GPU-off tiers.

[72] | Hacking on ANGLE in Chromium — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/angle_in_chromium.md | 2026-11-26 | ANGLE translates GL→D3D11 on Windows — driver-call costs are part of GPU power; feature flags that reduce GL state churn reduce them.

[73] | User Data Directory — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/user_data_dir.md | 2026-11-26 | User-data layout (caches, profiles) — where disk cache lives and grows; informs cache-size budgets for a lean profile.

[74] | User Data Storage — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/user_data_storage.md | 2026-11-26 | How profile data is persisted — background knowledge for trimming history/registry writes that cost disk I/O at runtime.

[75] | Achievements (memory) — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/memory/achievements.md | 2026-11-26 | Chrome's shipped memory reductions (lazy loading services, partitioning) — prior art proving browser-process RAM can be structurally cut without feature loss.

[76] | MemoryInfra — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/memory-infra/README.md | 2026-11-26 | Memory-infra tracing gives per-component memory attribution across all processes — the finest-grained verification available for RAM claims.

[77] | Performance Manager Overview — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/components/performance_manager/README.md | 2026-11-26 | Chromium's own performance-manager framework tracks per-page CPU/memory/GBs-of-GBs state for throttling decisions — prior art for Dexerion's adaptive-power signals.

[78] | content_switches.h — Chromium source | https://chromium.googlesource.com/chromium/src/+/HEAD/content/public/common/content_switches.h | 2026-11-26 | The switch definitions themselves (renderer-process-limit, process-per-site, disable-gpu) — ground truth that every switch in main.js exists and means what peter.sh says.

[79] | gpu_switches.cc — Chromium source | https://chromium.googlesource.com/chromium/src/+/HEAD/gpu/config/gpu_switches.cc | 2026-11-26 | GPU switch IDs — where --enable-gpu-rasterization/--enable-zero-copy/--force-gpu-mem-available-mb are parsed, confirming they are launch-time only (must be set at boot).

[80] | Viz Directory Structure — Chromium source | https://chromium.googlesource.com/chromium/src/+/HEAD/services/viz/README.md | 2026-11-26 | Viz = the display compositor service in the GPU process — what actually runs when an inactive WebContentsView keeps compositing.

[81] | //components/viz — Chromium source | https://chromium.googlesource.com/chromium/src/+/HEAD/components/viz/README.md | 2026-11-26 | Viz client library — per-frame costs a hidden view avoids (surface aggregation, submission) are viz-side, supporting the hidden-view lever.

[82] | base/task README — Chromium source | https://chromium.googlesource.com/chromium/src/+/HEAD/base/task/README.md | 2026-11-26 | Task scheduler design: delayed tasks and background priority — precedent for aligning long housekeeping delays with OS idle states.

[83] | //base/memory Types — Chromium source | https://chromium.googlesource.com/chromium/src/+/HEAD/base/memory/README.md | 2026-11-26 | Smart pointers/WeakPtrs and memory primitives — the toolkit Chromium uses to bound object lifetimes; mirrors what Dexerion must do for its own caches.

[84] | Pointer Compression in V8 · V8 blog | https://v8.dev/blog/pointer-compression | 2026-11-26 | Pointer compression cut V8 heap size ~40% on real sites — shows how much of renderer RAM is heap metadata, and why per-renderer heap caps pay off.

[85] | Pointer compression in Oilpan · V8 blog | https://v8.dev/blog/oilpan-pointer-compression | 2026-11-26 | Oilpan (Blink) objects also compress pointers, shrinking DOM-backed memory — background DOM cost is included in every background tab's footprint.

[86] | Sparkplug — a non-optimizing JavaScript compiler · V8 blog | https://v8.dev/blog/sparkplug | 2026-11-26 | Sparkplug trades a little memory (baseline code) for big CPU savings on warm code — a CPU/memory trade the js-flags budget must accommodate.

[87] | Maglev - V8's Fastest Optimizing JIT · V8 blog | https://v8.dev/blog/maglev | 2026-11-26 | Maglev sits between Sparkplug and TurboFan: faster warm-up with less compile energy than TurboFan — V8 already optimizes the JIT energy curve for you.

[88] | Short builtin calls · V8 blog | https://v8.dev/blog/short-builtin-calls | 2026-11-26 | Copying builtins near the heap cuts call dispatch cost — evidence V8 memory layout choices also affect CPU, not just RAM.

[89] | Speeding up V8 heap snapshots · V8 blog | https://v8.dev/blog/speeding-up-v8-heap-snapshots | 2026-11-26 | Snapshot deserialization dominates renderer cold-start — each extra renderer process pays it, reinforcing a small renderer-process limit.

[90] | The V8 Sandbox · V8 blog | https://v8.dev/blog/sandbox | 2026-11-26 | V8 sandbox reserves large virtual address space; reserved ≠ committed — explains why address-space reservations shouldn't alarm working-set measurements.

[91] | Static Roots: Objects with Compile-Time Constant Addresses · V8 blog | https://v8.dev/blog/static-roots | 2026-11-26 | Static roots remove relocations from snapshots, cutting startup CPU and memory — inherited free by using a current Chromium/Electron.

[92] | High-performance garbage collection for C++ · V8 blog | https://v8.dev/blog/high-performance-cpp-gc | 2026-11-26 | cppgc incremental/concurrent GC design — Blink's C++ heap GC runs concurrently, so background tab memory keeps a GC floor cost even when idle.

[93] | Oilpan library · V8 blog | https://v8.dev/blog/oilpan-library | 2026-11-26 | Oilpan as a reusable library — explains how DOM object graphs are traced; large DOMs in background tabs are real resident memory, not virtual.

[94] | WebAssembly Dynamic Tiering ready to try in Chrome 96 · V8 blog | https://v8.dev/blog/wasm-dynamic-tiering | 2026-11-26 | Lazy Wasm tier-up saves compile CPU when optimized code never runs — relevant to sites with Wasm in background tabs.

[95] | Control-flow Integrity in V8 · V8 blog | https://v8.dev/blog/control-flow-integrity | 2026-11-26 | CFI hardening costs a small runtime CPU tax — context for why Chromium can't be "just faster"; security features are part of the baseline Edge also pays.

[96] | Faster releases · V8 blog | https://v8.dev/blog/faster-releases | 2026-11-26 | V8's release cadence — Dexerion should track recent Electron releases to inherit these engine improvements (they compound into the mission target).

[97] | Slack tracking in V8 · V8 blog | https://v8.dev/blog/slack-tracking | 2026-11-26 | Object slack is reclaimed after warm-up — many short-lived tabs never reach that point, so sleeping tabs (renderer teardown) recovers more than GC would.

[98] | Faster JavaScript calls · V8 blog | https://v8.dev/blog/adaptor-frame | 2026-11-26 | Removal of adaptor frames cut call overhead — engine-level CPU improvements that arrive via Chromium updates, not app code.

[99] | Indicium: V8 runtime tracer tool · V8 blog | https://v8.dev/blog/system-analyzer | 2026-11-26 | V8 tracer visualizes optimization/parsing — a tool for proving js-flags changes do what the plan expects.

[100] | An additional non-backtracking RegExp engine · V8 blog | https://v8.dev/blog/non-backtracking-regexp | 2026-11-26 | The irregexp experimental engine prevents catastrophic backtracking — a CPU-kill path for foreground pages; current V8 includes mitigations.

[101] | Super fast super property access · V8 blog | https://v8.dev/blog/fast-super | 2026-11-26 | Continues the pattern: engine micro-optimizations land in newer Chromium — version currency is a free performance lever.

[102] | Up to 4GB of memory in WebAssembly · V8 blog | https://v8.dev/blog/4gb-wasm-memory | 2026-11-26 | Wasm memories can reserve GBs; reservations inflate virtual size — working-set based caps (Dexerion's) are the right metric, not virtual bytes.

[103] | Introducing the WebAssembly JavaScript Promise Integration API · V8 blog | https://v8.dev/blog/jspi | 2026-11-26 | JSPI stacks Wasm on async boundaries — reduces sync-thread blocking patterns that would otherwise pin background renderers awake.

[104] | WebAssembly JSPI has a new API · V8 blog | https://v8.dev/blog/jspi-newapi | 2026-11-26 | JSPI iteration — same takeaway, newer API shape.

[105] | Giving V8 a Heads-Up: Faster JavaScript Startup with Explicit Compile Hints · V8 blog | https://v8.dev/blog/explicit-compile-hints | 2026-11-26 | Explicit compile hints let pages defer/eager-compile deliberately — JS startup energy is page-controlled; Dexerion shouldn't fight it.

[106] | Speculative Optimizations for WebAssembly using Deopts and Inlining · V8 blog | https://v8.dev/blog/wasm-speculative-optimizations | 2026-11-26 | Speculative Wasm optimization trades compile energy for runtime speed — background tabs that never execute hot loops shouldn't pay it (dynamic tiering).

[107] | Land ahoy: leaving the Sea of Nodes · V8 blog | https://v8.dev/blog/leaving-the-sea-of-nodes | 2026-11-26 | Turboshaft compiler rewrite — newer engine compile pipeline, another reason to stay on current Electron.

[108] | Turbocharging V8 with mutable heap numbers · V8 blog | https://v8.dev/blog/mutable-heap-number | 2026-11-26 | Fewer heap allocations for doubles — per-allocation GC pressure reduction inherited with engine updates.

[109] | Faster initialization of instances with new class features · V8 blog | https://v8.dev/blog/faster-class-features | 2026-11-26 | Class-field init got cheaper — same "inherit engine wins" category.

[110] | Retrofitting temporal memory safety on C++ · V8 blog | https://v8.dev/blog/retrofitting-temporal-memory-safety-on-c++ | 2026-11-26 | Memory-safety hardening (Bucketized Allocators) costs some RAM — the safe floor under any further trimming.

[111] | V8 release v9.0 · V8 blog | https://v8.dev/blog/v8-release-90 | 2026-11-26 | Release notes track per-version perf/memory changes — useful changelog mining for which Electron version Dexerion should target.

[112] | V8 release v8.7 · V8 blog | https://v8.dev/blog/v8-release-87 | 2026-11-26 | Same category: version-level perf deltas.

[113] | V8 release v8.6 · V8 blog | https://v8.dev/blog/v8-release-86 | 2026-11-26 | Version-level perf deltas.

[114] | V8 release v8.5 · V8 blog | https://v8.dev/blog/v8-release-85 | 2026-11-26 | Version-level perf deltas.

[115] | V8 release v8.4 · V8 blog | https://v8.dev/blog/v8-release-84 | 2026-11-26 | Version-level perf deltas.

[116] | V8 release v8.3 · V8 blog | https://v8.dev/blog/v8-release-83 | 2026-11-26 | Version-level perf deltas (short builtin calls landed here).

[117] | V8 release v8.1 · V8 blog | https://v8.dev/blog/v8-release-81 | 2026-11-26 | Version-level perf deltas.

[118] | V8 release v8.0 · V8 blog | https://v8.dev/blog/v8-release-80 | 2026-11-26 | Pointer compression and concurrent parsing landed — the single biggest renderer-RAM win of the era; Dexerion's Chromium base already includes it.

[119] | V8 release v7.7 · V8 blog | https://v8.dev/blog/v8-release-77 | 2026-11-26 | Background compilation/parse improvements — reduced main-thread contention patterns still relevant to how pages warm up.

[120] | app | Electron docs | https://www.electronjs.org/docs/latest/api/app | 2026-11-26 | App-lifecycle APIs including `app.getAppMetrics()` (per-process CPU+memory), `disableHardwareAcceleration()`, and `requestSingleInstanceLock()` — the monitoring substrate Dexerion's sweeps already use.

[121] | BrowserWindow | Electron docs | https://www.electronjs.org/docs/latest/api/browser-window | 2026-11-26 | Documents `webPreferences.backgroundThrottling` and window visibility semantics — disabling throttling keeps pages "visible" while hidden, which is exactly the trade Dexerion must not make in the wrong direction (throttle background, never the foreground).

[122] | BaseWindow | Electron docs | https://www.electronjs.org/docs/latest/api/base-window | 2026-11-26 | Window shell without embedded content — Dexerion's chrome window is a BaseWindow+WebContentsView composition; view reordering avoids window churn.

[123] | View | Electron docs | https://www.electronjs.org/docs/latest/api/view | 2026-11-26 | Base view class (bounds/visibility) — `setVisible(false)` is the cheap primitive Dexerion uses to suspend background-tab compositing.

[124] | BrowserView | Electron docs | https://www.electronjs.org/docs/latest/api/browser-view | 2026-11-26 | Deprecated predecessor of WebContentsView — confirms the migration target and that old tutorials' BrowserView advice needs adaptation.

[125] | webContents | Electron docs | https://www.electronjs.org/docs/latest/api/web-contents | 2026-11-26 | Per-tab API surface: `setBackgroundThrottling`, `getProcessId`, `isCurrentlyAudible`, `capturePage` — the exact primitives the memory saver and power signals rely on.

[126] | WebContentsView | Electron docs | https://www.electronjs.org/docs/latest/api/web-contents-view | 2026-11-26 | One WebContents per view with bounds managed by the main process — Dexerion's tab architecture; visibility/bounds changes are main-process work, not renderer work.

[127] | webFrameMain | Electron docs | https://www.electronjs.org/docs/latest/api/web-frame-main | 2026-11-26 | Frame-level access — used for subframe CSS injection; costs nothing when not iterated, but full-frame walks during sweeps must stay bounded.

[128] | session | Electron docs | https://www.electronjs.org/docs/latest/api/session | 2026-11-26 | Per-session cache control (`clearCache`, `setSpellCheckerEnabled`, `setUserAgent`, protocol handlers, `getStoragePath`) — the toolkit for cache budgets and partitioned-account storage cost control.

[129] | protocol | Electron docs | https://www.electronjs.org/docs/latest/api/protocol | 2026-11-26 | Custom scheme registration with privileges — dexsite/dexerion handlers serve from memory; response caching behavior here affects both RAM and CPU.

[130] | powerMonitor | Electron docs | https://www.electronjs.org/docs/latest/api/power-monitor | 2026-11-26 | `on-battery`/`on-ac`/`lock-screen`/`resume`/`isOnBatteryPower` — event-driven power signals, already wired in browser.js; no polling needed.

[131] | powerSaveBlocker | Electron docs | https://www.electronjs.org/docs/latest/api/power-save-blocker | 2026-11-26 | Blocks system sleep/display sleep — must never be used casually; the only legitimate use is during long downloads or user-requested behavior.

[132] | process | Electron docs | https://www.electronjs.org/docs/latest/api/process | 2026-11-26 | `process.getCPUUsage(previous)` and `getProcessMemoryInfo()` — cheap main-process self-measurement already used by adaptive-power.

[133] | utilityProcess | Electron docs | https://www.electronjs.org/docs/latest/api/utility-process | 2026-11-26 | Forks Node child processes with service-like semantics — the sanctioned way to move main-process work (e.g. AI) out of the UI process if profiling demands it.

[134] | contentTracing | Electron docs | https://www.electronjs.org/docs/latest/api/content-tracing | 2026-11-26 | chrome://tracing from the main process — can capture which renderer/browser work fires during the benchmark windows, at trace-time cost only.

[135] | netLog | Electron docs | https://www.electronjs.org/docs/latest/api/net-log | 2026-11-26 | Network logging — verification for network-attributed CPU/disk differences vs Edge (cache hits, prefetches).

[136] | net | Electron docs | https://www.electronjs.org/docs/latest/api/net | 2026-11-26 | Chromium network stack in main — custom fetch paths (dexsite) should reuse the net module's cache rather than reimplementing I/O.

[137] | Supported Command Line Switches | Electron docs | https://www.electronjs.org/docs/latest/api/command-line-switches | 2026-11-26 | Electron's curated switch list (js-flags, proxy-server, etc.) — which Chromium switches are supported/embedded versus merely passed through.

[138] | ipcMain | Electron docs | https://www.electronjs.org/docs/latest/api/ipc-main | 2026-11-26 | Sync vs async IPC semantics — synchronous `ipcRenderer.sendSync` from pages would block renderers; Dexerion's invoke bridge is async (correct for power and responsiveness).

[139] | MessagePortMain | Electron docs | https://www.electronjs.org/docs/latest/api/message-port-main | 2026-11-26 | Main↔renderer ports bypass the broadcast overhead of re-sending full state — relevant to trimming dex:state broadcast frequency.

[140] | MessageChannelMain | Electron docs | https://www.electronjs.org/docs/latest/api/message-channel-main | 2026-11-26 | Channel creation primitive — pairs with MessagePortMain for targeted, low-overhead channels.

[141] | CPUUsage Object | Electron docs | https://www.electronjs.org/docs/latest/api/structures/cpu-usage/ | 2026-11-26 | `percentCPUUsage` semantics measured against a previous sample — the exact formula adaptive-power's `mainCpuPct()` replicates.

[142] | ProcessMetric Object | Electron docs | https://www.electronjs.org/docs/latest/api/structures/process-metric/ | 2026-11-26 | Per-process {type, cpu, memory, pid} from `app.getAppMetrics()` — the whole-tree measurement primitive for process-wide RAM/CPU accounting.

[143] | MemoryInfo Object | Electron docs | https://www.electronjs.org/docs/latest/api/structures/memory-info/ | 2026-11-26 | workingSetSize/privateBytes in KB — defines what Dexerion's boot report and memsaver cap actually measure.

[144] | WebPreferences Object | Electron docs | https://www.electronjs.org/docs/latest/api/structures/web-preferences/ | 2026-11-26 | The full webPreferences surface (backgroundThrottling, spellcheck, v8CacheOptions, enablePreferredSizeMode…) — the per-tab cost knobs available at view creation.

[145] | Performance | Electron docs | https://www.electronjs.org/docs/latest/tutorial/performance | 2026-11-26 | Official perf guidance: avoid blocking the main process, trace with contentTracing, prefer `input`-less work, use utility processes — several recommendations map directly onto Dexerion's sweep design.

[146] | Process Model | Electron docs | https://www.electronjs.org/docs/latest/tutorial/process-model | 2026-11-26 | Main/renderer/CI architecture in Electron terms — why per-tab WebContentsViews multiply process costs and how the main process becomes the bottleneck.

[147] | Security | Electron docs | https://www.electronjs.org/docs/latest/tutorial/security | 2026-11-26 | contextIsolation/sandbox guidance — any performance change must keep these intact; the checklist is the "don't sacrifice stability" boundary.

[148] | Window Customization | Electron docs | https://www.electronjs.org/docs/latest/tutorial/window-customization | 2026-11-26 | Frameless/transparent window costs — transparent windows force extra compositor work; Dexerion's frameless shell already pays this deliberately.

[149] | Breaking Changes | Electron docs | https://www.electronjs.org/docs/latest/breaking-changes | 2026-11-26 | Version-by-version behavior changes (e.g. backgroundThrottling enforcement changes in Electron 4+) — upgrade risk register for the Builder.

[150] | Quality of Service — Win32 apps | Microsoft Learn | https://learn.microsoft.com/en-us/windows/win32/procthread/quality-of-service | 2026-11-26 | EcoQoS (PROCESS_POWER_THROTTLING_EXECUTION_SPEED) lets a process opt into the efficiency cores + lower clocks — a documented Windows-native power lever a browser main process can apply to its own background helper work.

[151] | SetProcessInformation function — Microsoft Learn | https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-setprocessinformation | 2026-11-26 | The API that applies power throttling state per process — the mechanism behind any EcoQoS-based item in the plan.

[152] | PROCESS_POWER_THROTTLING_STATE — Microsoft Learn | https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/ns-processthreadsapi-process_power_throttling_state | 2026-11-26 | Defines the throttling masks (execution speed, ignore timer resolution) — the exact bits an "efficiency mode for our own processes" toggle would set.

[153] | PROCESS_INFORMATION_CLASS — Microsoft Learn | https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/ne-processthreadsapi-process_information_class | 2026-11-26 | Enumerates the information classes incl. ProcessPowerThrottling — the switchyard for per-process power policy.

[154] | SetWaitableTimerEx function — Microsoft Learn | https://learn.microsoft.com/en-us/windows/win32/api/synchapi/nf-synchapi-setwaitabletimerex | 2026-11-26 | Timer coalescing (tolerance/delay parameters) lets the kernel batch timer wakes — the OS precedent for Dexerion's long sweep intervals; Node/Chromium timers don't set tolerance, so longer delays are the app-level equivalent.

[155] | timeBeginPeriod function — Microsoft Learn | https://learn.microsoft.com/en-us/windows/win32/api/timeapi/nf-timeapi-timebeginperiod | 2026-11-26 | A 1 ms system timer request keeps cores from sleeping and raises package power — any process (or loaded module) calling this taxes the whole machine; worth verifying Chromium's own timer requests on the benchmark machine.

[156] | About Performance Counters — Microsoft Learn | https://learn.microsoft.com/en-us/windows/win32/perfctrs/about-performance-counters | 2026-11-26 | PDH/perf-counter architecture — the substrate the Tester's Get-Counter/typeperf measurements run on.

[157] | About Event Tracing — Microsoft Learn | https://learn.microsoft.com/en-us/windows/win32/etw/about-event-tracing | 2026-11-26 | ETW is the low-overhead tracing substrate under WPA/xperf — the fall-back when counter sampling is too coarse to attribute CPU.

[158] | Windows Performance Analyzer — Microsoft Learn | https://learn.microsoft.com/en-us/windows-hardware/test/wpt/windows-performance-analyzer | 2026-11-26 | WPA graphs CPU/GPU/power (via ETW) per process — the deepest attribution tool available on this machine for benchmark disputes.

[159] | Windows Performance Recorder — Microsoft Learn | https://learn.microsoft.com/en-us/windows-hardware/test/wpt/windows-performance-recorder | 2026-11-26 | WPR profiles (CPU, GPU, power) define what an ETW capture records — a controlled-protocol companion to the RAPL benchmark.

[160] | DirectX Graphics Kernel Subsystem — Microsoft Learn | https://learn.microsoft.com/en-us/windows-hardware/drivers/display/directx-graphics-kernel-subsystem | 2026-11-26 | The dxgkrnl layer owns context/device scheduling — per-process GPU accounting (GPU Engine counters) is derived here, so per-process GPU % is real kernel data, not estimation.

[161] | Modern Standby — Microsoft Learn | https://learn.microsoft.com/en-us/windows-hardware/design/device-experiences/modern-standby | 2026-11-26 | Modern Standby keeps network/activity wake sources alive; a browser holding wakelocks or sockets can block sleep — background for process-tree power effects beyond CPU.

[162] | typeperf — Microsoft Learn | https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/typeperf | 2026-11-26 | typeperf samples any counter path (including \GPU Engine(*)\Utilization Percentage) to CSV — a scriptable cross-check for the Tester's GPU utilisation numbers.

[163] | Get-Counter — PowerShell | Microsoft Learn | https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.diagnostics/get-counter | 2026-11-26 | Get-Counter semantics (counter sets, sampling intervals, localized counter names) — the exact API the power-sample.ps1 uses; localization is a known pitfall (counters named per-language).

[164] | Win32_Process class — Microsoft Learn | https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-process | 2026-11-26 | CommandLine/ParentProcessId per process — the mapping the Tester needs to group the whole Dexerion or Edge process tree unambiguously.

[165] | Get-Process — PowerShell | Microsoft Learn | https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/get-process | 2026-11-26 | Get-Process exposes CPU seconds + working set per PID — cheap repeated sampling for per-process CPU/WS verification.

[166] | Working Set — Microsoft Learn | https://learn.microsoft.com/en-us/windows/win32/memory/working-set | 2026-11-26 | Working set = resident pages actually charged to a process — justifies Dexerion's working-set-based RAM cap and the Tester's use of Get-Process WS as the RAM metric.

[167] | About Memory Management — Microsoft Learn | https://learn.microsoft.com/en-us/windows/win32/memory/about-memory-management | 2026-11-26 | Committed vs reserved vs shared memory — explains why private bytes and working set diverge and which one the benchmark should report (both).

[168] | IDXGIFactory1::EnumAdapters1 — Microsoft Learn | https://learn.microsoft.com/en-us/windows/win32/api/dxgi/nf-dxgi-idxgifactory1-enumadapters1 | 2026-11-26 | Enumerating adapters incl. iGPU/dGPU — the identification step for hybrid-graphics attribution in the GPU counters.

[169] | DXGI 1.6 improvements — Microsoft Learn | https://learn.microsoft.com/en-us/windows/win32/direct3ddxgi/dxgi-1-6-improvements | 2026-11-26 | DXGI 1.6 added hardware GPU-id + hybrid-graphics awareness (cross-adapter copy flags) — background for `--force-low-power-gpu` behavior on this laptop.

[170] | Process Creation Flags — Microsoft Learn | https://learn.microsoft.com/en-us/windows/win32/procthread/process-creation-flags | 2026-11-26 | Idle-process priority classes and other creation flags — options for demoting Dexerion's own helper processes (not the foreground renderer) when battery-saving.

[171] | GPU Engine counters (cached location) — Microsoft Learn | https://learn.microsoft.com/en-us/windows/win32/direct3dtools/gpu-engine-counters | 2026-11-26 | UNVERIFIED (404 at fetch): the classic "GPU Engine Counters" doc page moved or was retired; the counter set itself still exists via Get-Counter/typeperf — the Tester should validate the counter path on this machine rather than rely on this URL.

[172] | Energy Meter Interface — Microsoft Learn | https://learn.microsoft.com/en-us/windows/win32/powermeter/energy-meter-interface | 2026-11-26 | UNVERIFIED (404 at fetch): the software energy-meter doc path moved; the RAPL Energy Meter counters the benchmark already reads are the working equivalent (proven by power-sample.ps1 runs).

[173] | timeEndPeriod — Microsoft Learn | https://learn.microsoft.com/en-us/windows/win32/api/timeapi/nf-timeapi-timeendsperiod | 2026-11-26 | UNVERIFIED (404 at fetch; correct path likely nf-timeapi-timeendperiod): counterpart releasing the 1 ms timer request — cited for completeness of the timer-resolution lever.

[174] | IntensiveWakeUpThrottlingEnabled — Edge policy docs | https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/intensivewakeupthrottlingenabled | 2026-11-26 | Edge ships the same Chromium intensive timer throttling with a documented note that it saves CPU/battery — the throttling baseline Dexerion gets for free by staying on Chromium.

[175] | SleepingTabsEnabled — Edge policy docs | https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/sleepingtabsenabled | 2026-11-26 | Edge's sleeping tabs put background tabs' renderer to sleep to free CPU/memory — Edge's flagship background resource feature and the bar Dexerion's sleep+teardown must meet or beat.

[176] | EfficiencyModeEnabled — Edge policy docs | https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/efficiencymodeenabled | 2026-11-26 | Edge efficiency mode limits background activity + timer coalescing based on battery state — a policy twin of Dexerion's adaptive-power tiers.

[177] | WindowOcclusionEnabled — Edge policy docs | https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/windowocclusionenabled | 2026-11-26 | Edge documents native window occlusion as a battery feature that can be disabled — evidence that the CalculateNativeWinOcclusion misfires Dexerion hit are a recognized Windows risk with an official kill switch.

[178] | Microsoft Edge Browser Policy Documentation — Microsoft Learn | https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies | 2026-11-26 | Full Edge policy catalog — a checklist of every resource-related feature Edge ships (sleeping tabs, efficiency mode, startup boost) that the comparison benchmark implicitly measures against.

[179] | SleepingTabsEnabled (mirror path) — Edge policy docs | https://learn.microsoft.com/en-us/deployedge/microsoft-edge-browser-policies/sleepingtabsenabled | 2026-11-26 | Same policy under the new docs path — confirms sleeping-tabs defaults (5h in older, configurable) and the "never sleep audible/pinned" exemptions Dexerion mirrors.

[180] | Browse more safely with Microsoft Edge | Microsoft Learn | https://learn.microsoft.com/en-us/deployedge/microsoft-edge-security-browse-safer | 2026-11-26 | Edge's safety features (SmartScreen etc.) add background service work — part of the process-tree footprint the Dexerion comparison measures.

[181] | Heavy throttling of chained JS timers beginning in Chrome 88 | Chrome for Developers | https://developer.chrome.com/blog/timer-throttling-in-chrome-88/ | 2026-11-26 | Defines 1-minute wake-up budget for background timers (5 initial, then 1/min) — the app-visible behavior Dexerion's per-tab sleeps complement rather than duplicate.

[182] | Page Lifecycle API | Chrome for Developers | https://developer.chrome.com/blog/page-lifecycle-api/ | 2026-11-26 | Defines hidden/frozen/discarded states and their events — the web-standard vocabulary for Dexerion's sleep states; pages that respect it behave identically in Edge.

[183] | Analyze runtime performance | Chrome DevTools | https://developer.chrome.com/docs/devtools/performance | 2026-11-26 | DevTools performance panel workflow (CPU throttling, screenshots, flame charts) — a repeatable manual verification path alongside the automated benchmark.

[184] | Fix memory problems | Chrome DevTools | https://developer.chrome.com/docs/devtools/memory-problems | 2026-11-26 | Heap snapshot/detached-node methodology — the technique for proving Dexerion's WebContentsView lifecycle doesn't leak views (detached views are the classic leak).

[185] | Introduction to Lighthouse | Chrome for Developers | https://developer.chrome.com/docs/lighthouse/overview | 2026-11-26 | Lighthouse audits include main-thread work and bootup cost — a cross-check that Dexerion's shell pages stay lean.

[186] | Rendering performance | web.dev | https://web.dev/articles/rendering-performance | 2026-11-26 | Frame budget anatomy (JS→style→layout→paint→composite) — the canonical explanation of why hiding layers/skipping paint saves so much CPU+GPU.

[187] | How to create high-performance CSS animations | web.dev | https://web.dev/articles/animations-guide | 2026-11-26 | Compositor-only animations (transform/opacity) avoid layout+paint — relevant to the animated benchmark workload being a fair proxy for real browsing.

[188] | content-visibility: the new CSS property that boosts rendering performance | web.dev | https://web.dev/articles/content-visibility | 2026-11-26 | Browser skips rendering of off-screen sections — same skip-work principle Dexerion applies at the view level; shell pages could adopt it.

[189] | Optimize long tasks | web.dev | https://web.dev/articles/optimize-long-tasks | 2026-11-26 | Long tasks block input for their whole duration; yielding via scheduler.yield/postTask — guidance for keeping Dexerion's main-process and shell work in short tasks.

[190] | Optimize Largest Contentful Paint | web.dev | https://web.dev/articles/optimize-lcp | 2026-11-26 | LCP optimization guidance — keeps Dexerion's speed parity while resource usage drops (mission forbids trading speed for power).

[191] | Blink Scheduler — Chromium source | https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/platform/scheduler/README.md | 2026-11-26 | Blink scheduler's page/frameset task queues and background throttling policy — the mechanism that already throttles hidden pages' JS timers before any Dexerion-level change.

[192] | Network Service — Chromium source | https://chromium.googlesource.com/chromium/src/+/HEAD/services/network/README.md | 2026-11-26 | Out-of-process network service design — one network process serves all tabs; its socket pool behavior is shared overhead in both browsers.

[193] | Chrome Host Resolution — Chromium source | https://chromium.googlesource.com/chromium/src/+/HEAD/net/dns/README.md | 2026-11-26 | DNS resolution incl. host cache and prefetch behavior — DNS prefetch can be tuned via features without breaking resolution correctness.

[194] | Chrome Host Resolution (mirror read) — Chromium source | https://chromium.googlesource.com/chromium/src/+/HEAD/net/dns/host_resolver.md | 2026-11-26 | UNVERIFIED at write time (path guessed, to re-verify): host-resolver internals; if 404, the DNS prefetch lever cites [193] instead.

[195] | Blink Public Features README — Chromium source | https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/public/common/features/README.md | 2026-11-26 | UNVERIFIED (404 at fetch): intended to point at blink feature-flag definitions; use source.chromium.org search for blink features instead.

[196] | Site Isolation Design Document — The Chromium Projects | https://www.chromium.org/developers/design-documents/site-isolation | 2026-11-26 | Site isolation multiplies renderer processes for security — the fixed cost floor that Dexerion's renderer-process-limit trades against, and why the limit of 6 is the right balance.

[197] | Isolated Sites — The Chromium Projects | https://www.chromium.org/developers/design-documents/isolated-sites | 2026-11-26 | Early isolated-sites design (heuristic process assignment) — prior art for process-per-site as a memory/perf compromise.

[198] | Out-of-Process iframes (OOPIFs) — The Chromium Projects | https://www.chromium.org/developers/design-documents/oop-iframes | 2026-11-26 | OOPIFs add processes per cross-site frame — background cost driver on heavy sites that caps like renderer-process-limit contain.

[199] | Rendering and compositing out of process iframes — The Chromium Projects | https://www.chromium.org/developers/design-documents/oop-iframes/oop-iframes-rendering | 2026-11-26 | OOPIF compositing needs cross-process surface embedding — extra GPU-process work that hidden views avoid entirely.

[200] | Prerender — The Chromium Projects | https://www.chromium.org/developers/design-documents/prerender | 2026-11-26 | Prerendering a page spins a full hidden renderer — the textbook example of speculative work to keep OFF in a power-lean profile.

[201] | Preconnect — The Chromium Projects | https://www.chromium.org/developers/design-documents/network-stack/preconnect | 2026-11-26 | Preconnect opens TCP/TLS sockets speculatively — small but real network/CPU cost; feature-level control exists for a lean session.

[202] | Media Router & Web Presentation API — The Chromium Projects | https://www.chromium.org/developers/design-documents/media-router | 2026-11-26 | Media Router design (cast/presentation) — documents the background discovery machinery Dexerion disables by feature flag.

[203] | Service Processes — The Chromium Projects | https://www.chromium.org/developers/design-documents/service-processes | 2026-11-26 | Service processes (updater, crashpad) run in the background outside the browser — relevant to comparing whole process trees vs Edge on disk/CPU.

[204] | Startup — The Chromium Projects | https://www.chromium.org/developers/design-documents/startup | 2026-11-26 | Startup design: what runs before first paint — a checklist of boot work (metrics, warmup) a lean browser skips or defers.

[205] | Threading — The Chromium Projects | https://www.chromium.org/developers/design-documents/threading | 2026-11-26 | Browser-process threading patterns and common bugs — the ground rules for keeping Dexerion's main process quiet.

[206] | GPU Memory Buffer — The Chromium Projects | https://www.chromium.org/developers/design-documents/gpu-memory-buffer | 2026-11-26 | Zero-copy GMB design — the memory path `--enable-zero-copy` uses; explains the shared-memory setup GPU raster expects.

[207] | Surfaces — The Chromium Projects | https://www.chromium.org/developers/design-documents/chromium-graphics/surfaces | 2026-11-26 | Surface aggregation/aggregation manager — every visible view costs a surface in the display compositor; hidden views save aggregation work each frame.

[208] | Disk Cache 3.0 — The Chromium Projects | https://www.chromium.org/developers/design-documents/network-stack/disk-cache/disk-cache-v3 | 2026-11-26 | Simple Cache backend design (used on most desktops) — its background maintenance/eviction cost is what a cache-size budget tunes.

[209] | Very Simple Backend — The Chromium Projects | https://www.chromium.org/developers/design-documents/network-stack/disk-cache/very-simple-backend | 2026-11-26 | Minimal cache backend option — the lightest disk-cache mode if profiling shows cache maintenance showing up in the power trace.

[210] | Disk Cache Benchmarking & Performance Tracking — The Chromium Projects | https://www.chromium.org/developers/design-documents/network-stack/disk-cache/disk-cache-benchmarking | 2026-11-26 | Chromium's own cache benchmark harness — a template for A/B-ing cache backends on the Dexerion workload.

[211] | NetLog: Chrome's network logging system — The Chromium Projects | https://www.chromium.org/developers/design-documents/network-stack/netlog | 2026-11-26 | NetLog captures every request — the tool to prove network-side differences vs Edge (prefetch, preconnect, keep-alive behavior).

[212] | IndexedDB Design Doc — The Chromium Projects | https://www.chromium.org/developers/design-documents/indexeddb | 2026-11-26 | IndexedDB storage architecture (LevelDB per origin) — background tab storage writes are real disk I/O; also the mechanism behind storage-heavy sites' cost.

[213] | IndexedDBBackup — The Chromium Projects | https://www.chromium.org/developers/design-documents/indexeddb/indexeddbbackup | 2026-11-26 | Backup/restore behavior on origin destruction — cleanup semantics that sleeping-tab teardown must respect (or break site state).

[214] | Extensions — The Chromium Projects | https://www.chromium.org/developers/design-documents/extensions | 2026-11-26 | Extension system design: content scripts and background pages add per-tab work — Dexerion keeps the extension surface but must measure its overhead honestly.

[215] | How the Extension System Works — The Chromium Projects | https://www.chromium.org/developers/design-documents/extensions/how-the-extension-system-works | 2026-11-26 | Extension process/host wiring — background pages in MV3 are service workers (idle-killable), the compat-safe configuration.

[216] | Adaptive spell checking for multilingual users — The Chromium Projects | https://www.chromium.org/developers/design-documents/advancedspellchecker | 2026-11-26 | Spellcheck uses a separate service process (Windows) — a whole-process cost that can be deferred until a text field actually needs it.

[217] | DirectWrite Font Proxy — The Chromium Projects | https://www.chromium.org/developers/design-documents/directwrite-font-proxy | 2026-11-26 | Font service process on Windows — another utility process in the tree that exists for sandboxed font access; relevant when counting "our processes vs Edge's".

[218] | Translate — The Chromium Projects | https://www.chromium.org/developers/design-documents/translate | 2026-11-26 | Translate UI/service design — exactly what TranslateUI disable-features skips; this documents what's being cut and that core rendering is unaffected.

[219] | Omnibox Prefetch and Prerender for Default Search Engines — The Chromium Projects | https://www.chromium.org/developers/design-documents/omnibox-prefetch-for-default-search-engines | 2026-11-26 | Omnibox suggestions can trigger prerenders — Google-tied speculative load that a default-browser-agnostic profile shouldn't pay.

[220] | Site Engagement — The Chromium Projects | https://www.chromium.org/developers/design-documents/site-engagement | 2026-11-26 | Per-site engagement scoring drives background resource budgets — prior art for Dexerion's LRU/heaviest-first memsaver heuristics.

[221] | Preferences — The Chromium Projects | https://www.chromium.org/developers/design-documents/preferences | 2026-11-26 | Preferences storage (JSON + write throttling) — small but real disk-write cost per settings change; batched writes save I/O.

[222] | Sandbox — The Chromium Projects | https://www.chromium.org/developers/design-documents/sandbox | 2026-11-26 | Windows sandbox design overview — Dexerion keeps sandbox=true for untrusted content; any perf item must state its sandbox impact (target: none).

[223] | Audio / Video Playback — The Chromium Projects | https://www.chromium.org/developers/design-documents/video | 2026-11-26 | Media playback architecture incl. hardware decode — supports the plan's rule: never trade hardware video decode for CPU decoding.

[224] | Video Capture — The Chromium Projects | https://www.chromium.org/developers/design-documents/video-capture | 2026-11-26 | Camera capture pipeline — background capture holds GPU+CPU; Chromium's auto-throttled capture doc complements this for idle desktops.

[225] | Download — The Chromium Projects | https://www.chromium.org/developers/design-documents/download | 2026-11-26 | Download service design — downloads run in the browser process; powerSaveBlocker only for active downloads (already Dexerion's stance).

[226] | Compositor (Touch) Hit Testing — The Chromium Projects | https://www.chromium.org/developers/design-documents/compositor-hit-testing | 2026-11-26 | Compositor-driven hit testing — shows how much interaction work the compositor absorbs without waking the renderer main thread.

[227] | Mac Window Occlusion API Use — The Chromium Projects | https://www.chromium.org/developers/design-documents/mac-occlusion | 2026-11-26 | macOS occlusion precedent — occlusion tracking is cross-platform efficiency machinery; Dexerion's Windows-specific misfire disable is documented as an exception, not a philosophy.

[228] | Filter Effects — The Chromium Projects | https://www.chromium.org/developers/design-documents/image-filters | 2026-11-26 | Skia filter effects (blur etc.) are expensive paint ops — background for why the animated workload is GPU-heavy and what GPU-raster helps most.

[229] | High DPI Resources — The Chromium Projects | https://www.chromium.org/developers/design-documents/high-dpi-resources | 2026-11-26 | Scale-factor resource loading — loading 2x assets on 1x displays wastes memory; Chromium selects by scale, a cost both browsers share.

[230] | Constrained Popup Windows — The Chromium Projects | https://www.chromium.org/developers/design-documents/constrained-popup-windows | 2026-11-26 | Popup window policy — Dexerion's popup handling (sign-in windows etc.) maps onto this; popups are extra renderers that should follow the same sleep rules.

[231] | Desktop Notifications — The Chromium Projects | https://www.chromium.org/developers/design-documents/desktop-notifications | 2026-11-26 | Notification service design — notification permission revocation etc.; idle-notification traffic is a wake-source to audit.

[232] | Sane time — The Chromium Projects | https://www.chromium.org/developers/design-documents/sane-time | 2026-11-26 | Clock-consistency machinery (network time) — a small background service; included in the audit list of optional network work.

[233] | Widget Refactor — The Chromium Projects | https://www.chromium.org/developers/design-documents/widget-refactor | 2026-11-26 | Views/aura widget layering — the UI stack the shell pages ride on; the shell's paint cost is separate from web content's.

[234] | Themes — The Chromium Projects | https://www.chromium.org/developers/design-documents/themes | 2026-11-26 | Theme asset pipeline — skinnable chrome adds image decode/memory; Dexerion's CSS skins are lighter than image-based themes (a quiet advantage).

[235] | Fix High CPU or memory usage in Microsoft Edge browser | Microsoft Learn | https://learn.microsoft.com/en-us/troubleshoot/microsoft-edge/performance/edge-high-cpu-memory | 2026-11-26 | Microsoft's own high-CPU/memory remediation for Edge (disable features, sleeping tabs, hardware acceleration) — direct evidence of which knobs Microsoft believes move CPU/RAM.

[236] | EfficiencyMode — Edge policy docs | https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/efficiencymode | 2026-11-26 | EfficiencyMode policy values (always / on battery / never) — defines the exact modes the Dexerion benchmark must pin Edge to for a fair active-browsing comparison.

[237] | EfficiencyModeOnPowerEnabled — Edge policy docs | https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/efficiencymodeonpowerenabled | 2026-11-26 | Battery-only efficiency mode trigger — the Tester must force the same mode on both browsers when plugged in, or Edge's defaults will differ per power state.

[238] | SleepingTabsTimeout — Edge policy docs | https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/sleepingtabstimeout | 2026-11-26 | Edge sleeps tabs after a configurable idle timeout (default 1h+ in docs history) — Dexerion's 3-min teardown is far more aggressive; the comparison should report this difference, not hide it.

[239] | SleepingTabsBlockedForUrls — Edge policy docs | https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/sleepingtabsblockedforurls | 2026-11-26 | Per-site sleep exemptions — the mechanism for compat-safety; Dexerion's equivalent is its never-sleep list (active/audible/loading/focus-blocked).

[240] | AutoDiscardSleepingTabsEnabled — Edge policy docs | https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/autodiscardsleepingtabsenabled | 2026-11-26 | Edge can auto-DISCARD sleeping tabs (free the renderer) — discard is the deepest sleep; Dexerion's teardown achieves the same via process exit with session restore.

[241] | Energy Saver — Windows hardware docs | https://learn.microsoft.com/en-us/windows-hardware/design/component-guidelines/energy-saver | 2026-11-26 | Windows Energy Saver caps CPU/performance device power on low battery — the OS backdrop that interacts with any browser power policy on this laptop.

[242] | Powercfg command-line options | Microsoft Learn | https://learn.microsoft.com/en-us/windows-hardware/design/device-experiences/powercfg-command-line-options | 2026-11-26 | powercfg /energy and /batteryreport generate OS-level power diagnostics — free corroborating evidence for the Tester beyond RAPL counters.

[243] | Device under test setup for battery-life measurements | Microsoft Learn | https://learn.microsoft.com/en-us/windows-hardware/test/assessments/device-under-test-setup-for-battery-life | 2026-11-26 | Microsoft's controlled battery-measurement protocol (fixed brightness, closed apps, AC disconnection) — the hygiene checklist the repeated benchmark should adopt.

[244] | GPU Process Memory counters report incorrect value | Microsoft Learn | https://learn.microsoft.com/en-us/troubleshoot/windows-client/performance/gpu-process-memory-counters-report-wrong-value | 2026-11-26 | Known Windows bug: GPU process memory counters can misreport — a documented caveat the Tester must note when attributing GPU memory per process.

[245] | Performance Counters portal — Win32 | Microsoft Learn | https://learn.microsoft.com/en-us/windows/win32/perfctrs/performance-counters-portal | 2026-11-26 | Index of all performance-counter sets — navigation for finding the GPU Engine and Energy Meter counter paths used in the benchmark.

[246] | Using Performance Counters — Win32 | Microsoft Learn | https://learn.microsoft.com/en-us/windows/win32/perfctrs/using-performance-counters | 2026-11-26 | PDH API usage (open/query/sampled data) — a programmatic alternative to Get-Counter if the Tester wants tighter sampling control.

[247] | Counters, Queries and Performance Measurement (D3D12) — Microsoft Learn | https://learn.microsoft.com/en-us/windows/win32/direct3d12/performance-measurement | 2026-11-26 | GPU timestamp queries and counter semantics at the D3D level — background for what \GPU Engine(*)\Utilization Percentage actually averages.

[248] | Look For Potential Memory Leaks With PerfMon — Microsoft Learn | https://learn.microsoft.com/en-us/windows-hardware/drivers/debugger/determining-whether-a-leak-exists | 2026-11-26 | PerfMon private-bytes trend analysis for leaks — the pattern for verifying WebContentsView teardown doesn't leak across many open/close cycles.

[249] | Troubleshoot performance problems in Windows | Microsoft Learn | https://learn.microsoft.com/en-us/troubleshoot/windows-server/performance/troubleshoot-performance-problems-in-windows | 2026-11-26 | Microsoft's systematic performance-troubleshooting tree — the methodology template for the Tester's benchmark write-ups.

[250] | Manually rebuild performance counters | Microsoft Learn | https://learn.microsoft.com/en-us/troubleshoot/windows-server/performance/manually-rebuild-performance-counters | 2026-11-26 | Counter-store corruption repair (lodctr /R) — a runbook entry if GPU counters ever return empty on the test machine.

[251] | ProcDump — Sysinternals | Microsoft Learn | https://learn.microsoft.com/en-us/sysinternals/downloads/procdump | 2026-11-26 | ProcDump captures CPU spikes/hangs — the tool if a benchmark run shows a Dexerion process spike that counters alone can't explain.

[252] | Process Explorer — Sysinternals | Microsoft Learn | https://learn.microsoft.com/en-us/sysinternals/downloads/process-explorer | 2026-11-26 | Process Explorer shows tree + per-process CPU/GPU columns — the human-legible cross-check of the automated process-tree grouping.

[253] | RAMMap — Sysinternals | Microsoft Learn | https://learn.microsoft.com/en-us/sysinternals/downloads/rammap | 2026-11-26 | RAMMap breaks down physical memory use (standby, modified, working sets) — distinguishes "freed" vs "moved to standby" after sleeping tabs.

[254] | VMMap — Sysinternals | Microsoft Learn | https://learn.microsoft.com/en-us/sysinternals/downloads/vmmap | 2026-11-26 | VMMap gives per-process commit/private/shared breakdown — deeper than working set when validating RAM claims.

[255] | PsList — Sysinternals | Microsoft Learn | https://learn.microsoft.com/en-us/sysinternals/downloads/pslist | 2026-11-26 | PsList samples per-process CPU/memory from scripts — a lightweight alternative to Get-Process loops in the benchmark harness.

[256] | Process Monitor — Sysinternals | Microsoft Learn | https://learn.microsoft.com/en-us/sysinternals/downloads/procmon | 2026-11-26 | UNVERIFIED (the /procmon slug 404s on learn.microsoft.com at access time — the Sysinternals live page lives on the Sysinternals site; tool description kept from prior knowledge, takeaway NOT fetch-confirmed on this URL): file/registry/network tracing to catch surprise disk I/O from caches or profile writes during the benchmark.

[257] | SetThreadInformation function — Microsoft Learn | https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-setthreadinformation | 2026-11-26 | Per-THREAD power throttling (ThreadPowerThrottling class) — finer-grained than process EcoQoS: Dexerion could throttle only its own housekeeping threads, never the UI thread.

[258] | Efficiency Tips for Windows ML Inference | Microsoft Learn | https://learn.microsoft.com/en-us/windows/ai/new-windows-ml/efficiency-tips | 2026-11-26 | Microsoft's efficiency guidance for on-device ML (batching, idle scheduling, EcoQoS) — directly applicable to Dexerion's AI features running in the main process.

[259] | App lifecycle for Windows App SDK desktop apps | Microsoft Learn | https://learn.microsoft.com/en-us/windows/apps/develop/launch/app-lifecycle | 2026-11-26 | App-lifecycle APIs (background transitions, suspended semantics) — the OS contract a desktop app should honor to avoid foreground-grade costs while unfocused.

[260] | Performance best practices for WebView2 apps | Microsoft Learn | https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/performance | 2026-11-26 | Microsoft's own WebView2 perf guidance (avoid excessive processes, memory usage targets, IsSuspended APIs) — Microsoft's sibling-technology playbook for exactly Dexerion's goals.

[261] | Process model for WebView2 apps | Microsoft Learn | https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/process-model | 2026-11-26 | WebView2 shares a browser process tree across apps — documents which processes exist (network, GPU, crashpad) so the Dexerion-vs-Edge process-tree comparison is apples-to-apples.

[262] | WebView2 browser flags | Microsoft Learn | https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/webview-features-flags | 2026-11-26 | WebView2 exposes Chromium switches/feature flags programmatically — evidence the switch approach is supported and versioned by Microsoft, not a hack.

[263] | Desktop Window Manager — Win32 | Microsoft Learn | https://learn.microsoft.com/en-us/windows/win32/dwm/dwm-overview | 2026-11-26 | DWM composites all windows; a browser's GPU work ends at the swap chain and DWM adds its own share — context for why GPU Engine counters show dwm.exe work in both browsers' scenarios.

[264] | Enable and control DWM composition — Win32 | Microsoft Learn | https://learn.microsoft.com/en-us/windows/win32/dwm/composition-ovw | 2026-11-26 | Composition is always-on (Win8+) and can't be disabled for perf — the fixed GPU floor any windowed app pays; Dexerion's levers must be in its own render work.

[265] | DWM_TIMING_INFO — Win32 | Microsoft Learn | https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ns-dwmapi-dwm_timing_info | 2026-11-26 | DWM exposes composition timing (refresh, frame rates) — a per-window compositor-activity signal the Tester could sample to prove hidden views stop producing frames.

[266] | DWM Messages — Win32 | Microsoft Learn | https://learn.microsoft.com/en-us/windows/win32/dwm/dwm-messages | 2026-11-26 | DWM window notifications (occlusion/visibility) — the OS-side signals Chromium's occlusion tracker consumes; why hiding WebContentsViews is respected by the compositor.

[267] | Desktop Window Manager is always on — Win32 cookbook | Microsoft Learn | https://learn.microsoft.com/en-us/windows/win32/w8cookbook/desktop-window-manager-is-always-on | 2026-11-26 | Legacy note that DWM can't be turned off — paired with [264]; sets the fixed floor for GPU comparisons.

[268] | Desktop Window Manager is always on — Compatibility Cookbook | Microsoft Learn | https://learn.microsoft.com/en-us/windows/compatibility/desktop-window-manager-is-always-on | 2026-11-26 | Compatibility-cookbook version of the same DWM policy — independent confirmation of the always-composited desktop.

[269] | AD Explorer — Sysinternals | Microsoft Learn | https://learn.microsoft.com/en-us/sysinternals/downloads/adexplorer | 2026-11-26 | (adjacent tooling; not perf-specific) — kept only as part of the Sysinternals survey used to pick the measurement tools in [251]–[255].

[270] | PsInfo — Sysinternals | Microsoft Learn | https://learn.microsoft.com/en-us/sysinternals/downloads/psinfo | 2026-11-26 | PsInfo reports system-level stats — useful for benchmark-log headers (uptime, memory load) that contextualize each run.

[271] | LogonSessions — Sysinternals | Microsoft Learn | https://learn.microsoft.com/en-us/sysinternals/downloads/logonsessions | 2026-11-26 | (adjacent tooling) — session enumeration; used only to ensure the benchmark runs in a clean interactive session.

[272] | Configure power settings | Microsoft Learn | https://learn.microsoft.com/en-us/windows-hardware/customize/power-settings/configure-power-settings | 2026-11-26 | Windows power-plan knobs (processor min/max state, boost) — the Tester should PIN the power plan per run, or measured package power will drift independent of the browser.

[273] | backgroundThrottling: false not obeyed in Electron 4+ · Issue #20974 · electron/electron | https://github.com/electron/electron/issues/20974 | 2026-11-27 | Electron's own tracker confirms backgroundThrottling semantics changed in Electron 4+ (rAF throttling moved to Chromium) — Dexerion must not rely on webPreferences flags alone; view visibility is the reliable control.

[274] | "backgroundThrottling: false" no longer affects requestAnimationFrame() in background · Issue #9567 | https://github.com/electron/electron/issues/9567 | 2026-11-27 | rAF in hidden windows is throttled by Chromium itself, not the Electron flag — the mechanism Dexerion's background-tab fix exploits (hidden view ⇒ suspended rAF).

[275] | `app.getAppMetrics()` and `ProcessMetric` — memory no longer available · Issue #16179 | https://github.com/electron/electron/issues/16179 | 2026-11-27 | getAppMetrics memory fields have had gaps in some Electron versions — the Tester should validate metrics against Get-Process cross-checks before trusting boot reports.

[276] | Electron - Slow performances in background — Marco Pracucci | https://pracucci.com/electron-slow-background-performances.html | 2026-11-27 | Classic write-up: Chromium throttles background windows' timers (min 1s) causing "slow background" reports — documents the exact behavior Dexerion wants for background tabs and must avoid for its own housekeeping (long sweeps, not busy polls).

[277] | minbrowser/min — GitHub | https://github.com/minbrowser/min | 2026-11-27 | Min is an Electron "fast, minimal browser" — prior art for a lean Electron browser; its approach (lazy tabs, ad-block at view level) is directly comparable.

[278] | minbrowser/min Wiki — GitHub | https://github.com/minbrowser/min/wiki | 2026-11-27 | Min's design notes include performance philosophy (single window, tab pausing) — evidence that pause-on-background is the standard lean-Electron-browser pattern.

[279] | brave/brave-browser — GitHub | https://github.com/brave/brave-browser | 2026-11-27 | Brave is a Chromium fork shipping memory saver + ad-block at the network layer — the biggest prior-art browser for "Chromium minus cruft" power savings.

[280] | Releases · electron/electron — GitHub | https://github.com/electron/electron/releases | 2026-11-27 | Electron release notes list Chromium/V8/Node bumps per version — the source of "inherit engine wins" recommendations.

[281] | Timers | Node.js v26 docs | https://nodejs.org/api/timers.html | 2026-11-27 | `.unref()` keeps timers from holding the event loop alive — Dexerion already unrefs its sweep timers; this doc formalizes why (timers otherwise block process-idle detection).

[282] | Performance measurement APIs | Node.js v26 docs | https://nodejs.org/api/perf_hooks.html | 2026-11-27 | perf_hooks (PerformanceObserver, event-loop utilization) — event-loop utilization is a better main-process load signal than CPU% for deciding sweep cadence.

[283] | V8 | Node.js v26 docs | https://nodejs.org/api/v8.html | 2026-11-27 | `v8.getHeapStatistics()`/`getHeapSpaceStatistics()` — exposes the renderer-independent main-process heap so Dexerion can budget its OWN memory, not just Chromium's.

[284] | getBackgroundThrottling or equivalent on Electron? — Stack Overflow | https://stackoverflow.com/questions/60067455/getbackgroundthrottling-or-equivalent-on-electron | 2026-11-27 | UNVERIFIED (SO returns 403 to bots at access time; content known from search snippet only): community Q&A on reading throttling state — no takeaway asserted beyond the search snippet.

[285] | Electron: how to get webContents (to check on backgroundThrottling) — Stack Overflow | https://stackoverflow.com/questions/68952769/electron-how-to-get-webcontents-to-check-on-backgroundthrottling | 2026-11-27 | UNVERIFIED (SO 403 to bots; snippet only): underscores that throttling state is write-only in the API — plan items must track the intended state themselves.

[286] | How to properly debug Electron memory issues? — Stack Overflow | https://stackoverflow.com/questions/69827243/how-to-properly-debug-electron-memory-issues | 2026-11-27 | UNVERIFIED (SO 403 to bots; snippet only): practitioner workflow for Electron memory debugging — cross-checked with [184]/[254] tools.

[287] | Browser-level image lazy loading for the web | web.dev | https://web.dev/articles/browser-level-image-lazy-loading | 2026-11-27 | Chromium loads images only near the viewport by default — background tabs thus cost less than naive assumptions; measurement, not folklore, must drive RAM targets.

[288] | Optimize Cumulative Layout Shift | web.dev | https://web.dev/articles/optimize-cls | 2026-11-27 | CLS guidance — speed-parity guardrail: any resource-saving change must not degrade layout stability (mission's functionality constraint).

[289] | Interaction to Next Paint (INP) | web.dev | https://web.dev/articles/inp | 2026-11-27 | INP measures interaction latency — the numerical definition of "foreground responsiveness must not degrade" for verification gates.

[290] | Documentation · V8 | https://v8.dev/docs | 2026-11-27 | V8 docs hub — entry point for engine-level tools (d8, gdb, profiler) if js-flags tuning needs deeper verification.

[291] | Investigating memory leaks · V8 | https://v8.dev/docs/memory-leaks | 2026-11-27 | Heap snapshot diffing workflow for leaks — applicable to Dexerion's long-running main process (caches must be bounded, not leaky).

[292] | Using V8's sample-based profiler · V8 | https://v8.dev/docs/profile | 2026-11-27 | --prof/--log-timer-event sampling — how to attribute main-process CPU to specific modules before optimizing.

[293] | Electron's blog | Electron | https://www.electronjs.org/blog | 2026-11-27 | Blog index — release and perf posts (source for [294]–[295]).

[294] | Electron 32.0.0 | Electron | https://www.electronjs.org/blog/electron-32-0 | 2026-11-27 | Electron 32 bundles newer Chromium/V8 with memory/CPU improvements — version-currency recommendation grounding.

[295] | Electron 30.0.0 | Electron | https://www.electronjs.org/blog/electron-30-0 | 2026-11-27 | Electron 30 notes (Chromium 124 etc.) — same category; confirms newer majors ship engine-level savings.

[296] | Migrating from BrowserView to WebContentsView | Electron | https://www.electronjs.org/blog/migrate-to-webcontentsview | 2026-11-27 | Official migration guide to WebContentsView — confirms Dexerion's tab architecture is the current, supported high-performance path (BrowserView is deprecated).

[297] | Electron and the V8 Memory Cage | Electron | https://www.electronjs.org/blog/v8-memory-cage | 2026-11-27 | V8 sandbox (memory cage) raises Electron address-space reservations — documents why virtual-size metrics inflate and why working set is the honest RAM metric.

[298] | Electron 45 | Electron | https://www.electronjs.org/blog/electron-45-0 | 2026-11-27 | Current major release line — each Chromium bump carries engine-level power/memory wins; staying current is a standing recommendation.

[299] | Electron 40.0.0 | Electron | https://www.electronjs.org/blog/electron-40-0 | 2026-11-27 | Release-notes category: engine + API changes relevant to view lifecycle.

[300] | Electron 38.0.0 | Electron | https://www.electronjs.org/blog/electron-38-0 | 2026-11-27 | Release-notes category: engine + API changes.

[301] | Electron 36.0.0 | Electron | https://www.electronjs.org/blog/electron-36-0 | 2026-11-27 | Release-notes category: engine + API changes.

[302] | Electron 33.0.0 | Electron | https://www.electronjs.org/blog/electron-33-0 | 2026-11-27 | Release-notes category: engine + API changes.

[303] | Electron 28.0.0 | Electron | https://www.electronjs.org/blog/electron-28-0 | 2026-11-27 | Release-notes category: engine + API changes.

[304] | Electron 17.0.0 | Electron | https://www.electronjs.org/blog/electron-17-0 | 2026-11-27 | Release-notes category: engine + API changes.

[305] | Electron 14.0.0 | Electron | https://www.electronjs.org/blog/electron-14-0 | 2026-11-27 | Release-notes category: engine + API changes.

[306] | Tab hibernation | Vivaldi Browser Help | https://help.vivaldi.com/desktop/tabs/tab-hibernation/ | 2026-11-27 | Vivaldi's tab hibernation unloads background tabs' contents — third-party-Chromium prior art for Dexerion's sleep with explicit user-visible budget controls.

[307] | Opera GX | Opera | https://www.opera.com/gx | 2026-11-27 | Opera GX ships RAM/CPU limiters — prior art for hard caps (Dexerion's memsaver is a soft budget; GX shows the hard-cap UX exists in market).

[308] | A farewell to Arc — The Browser Company | https://arc.net/ | 2026-11-27 | Arc (an Electron-family browser) is in maintenance — market evidence that sustaining a lean browser needs the disciplined engineering process this mission builds.

[309] | Optimize Interaction to Next Paint | web.dev | https://web.dev/articles/optimize-inp | 2026-11-27 | Concrete INP optimization techniques (yield to input, break long tasks) — the playbook for the "no foreground regression" gate.

[310] | Web Vitals | web.dev | https://web.dev/articles/vitals | 2026-11-27 | The quality-bar definitions (LCP/INP/CLS) Chromium itself optimizes for — the numeric guardrails for "no functionality/responsiveness regression" in the plan.

[311] | Largest Contentful Paint (LCP) | web.dev | https://web.dev/articles/lcp | 2026-11-27 | LCP anatomy — pairs with [190] to define the speed parity the benchmark must show while resource use drops.

[312] | Minify and compress network payloads with gzip | web.dev | https://web.dev/articles/codelab-text-compression | 2026-11-27 | Compression trades CPU for network time — the same trade-off surface Dexerion's lean profile sits on; measured guidance on where compression wins.

[313] | Service worker caching and HTTP caching | web.dev | https://web.dev/articles/service-worker-caching-and-http-caching | 2026-11-27 | Two caching layers and their interaction — cache-hit strategy directly changes CPU/disk work per page; the HTTP cache sizing lever cites this.

[314] | Establish network connections early (preconnect and dns-prefetch) | web.dev | https://web.dev/articles/preconnect-and-dns-prefetch | 2026-11-27 | Speculative connection cost/benefit — supports keeping speculation bounded rather than disabled (compat) or unlimited (waste).

[315] | Back/forward cache | web.dev | https://web.dev/articles/bfcache | 2026-11-27 | BFCache semantics and eligibility — the standard "cost-free background" mechanism; Dexerion's sleep must not break BFCache eligibility for real navigations.

[316] | Page Visibility API — MDN | https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API | 2026-11-27 | visibilityState governs what pages expect (timers throttled when hidden) — the contract Dexerion's per-tab sleeps relies on; sites that honor it see no functional change.

[317] | Document: visibilitychange event — MDN | https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event | 2026-11-27 | The visibilitychange event — pages already handle this transition; Dexerion sleeping a tab is a stronger form of the same signal.

[318] | Window: requestIdleCallback() — MDN | https://developer.mozilla.org/en-US/docs/Web/API/Window/requestIdleCallback | 2026-11-27 | Idle-time callbacks run only when the main thread is free — the renderer-side model for Dexerion's main-process "sweep only when idle" cadence.

[319] | IdleDeadline — MDN | https://developer.mozilla.org/en-US/docs/Web/API/IdleDeadline | 2026-11-27 | IdleDeadline.timeRemaining — how idle budget is expressed to code; informs how long a sweep slice may run before yielding.

[320] | Performance: now() — MDN | https://developer.mozilla.org/en-US/docs/Web/API/Performance/now | 2026-11-27 | High-resolution monotonic time — the correct clock for measuring sweep durations in the main process.

[321] | Page Visibility — W3C spec | https://w3c.github.io/page-visibility/ | 2026-11-27 | The actual spec text for visibility states — normative reference for Dexerion's sleep states mapping to standard behavior.

[322] | HTML Standard — timer initialisation steps | https://html.spec.whatwg.org/multipage/webappapis.html#timer-initialisation-steps | 2026-11-27 | The spec's timer init/clamping algorithm — where Chromium's throttling hooks live; confirms throttling is standards-visible behavior, not an app hack.

[323] | Document: hidden property — MDN | https://developer.mozilla.org/en-US/docs/Web/API/Document/hidden | 2026-11-27 | document.hidden boolean — the simplest visibility probe pages use; Dexerion's sleep is consistent with (and stronger than) this state.

[324] | Document: visibilityState property — MDN | https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilityState | 2026-11-27 | visibilityState values (visible/hidden) — the API surface Dexerion's per-tab sleeps exercise; compatibility surface is already shipped and battle-tested.

[325] | Window: blur event — MDN | https://developer.mozilla.org/en-US/docs/Web/API/Window/blur_event | 2026-11-27 | blur/focus events mark interaction boundaries — the same signals adaptive-power's lastInteraction tracking uses.

[326] | Reduce Process Interference with Task Manager Efficiency Mode — Microsoft DevBlogs | https://devblogs.microsoft.com/performance-diagnostics/reduce-process-interference-with-task-manager-efficiency-mode/ | 2026-11-27 | Documents Windows 11 efficiency mode (EcoQoS + priority demotion) as the OS-blessed way to cut a process's resource footprint — the exact mechanism available to Dexerion's own non-UI processes.

[327] | Perfetto tooling for analyzing Android, Linux, and Chromium browser performance — Microsoft DevBlogs | https://devblogs.microsoft.com/performance-diagnostics/perfetto-tooling-for-analyzing-android-linux-and-chromium-browser-performance-microsoft-performance-tools-linux-android/ | 2026-11-27 | Microsoft ships Perfetto-based Chromium perf tooling — a cross-check path for trace-based verification of Dexerion's claims.

[328] | New tools for analyzing Android, Linux, and Chromium browser performance — Microsoft DevBlogs | https://devblogs.microsoft.com/performance-diagnostics/new-tools-for-analyzing-android-linux-and-chromium-browser-performance/ | 2026-11-27 | Companion announcement to [327] — more tooling references for browser-perf analysis.

[329] | Running some UI code on a timer at a higher priority than your usual timer messages, or without coalescing — The Old New Thing | https://devblogs.microsoft.com/oldnewthing/20221221-00/?p=107607/ | 2026-11-27 | Raymond Chen on timer coalescing vs priority — the canonical explanation of how Windows batches timer wakes; Dexerion's long sweep delays achieve the same effect from the app side.

[330] | What should the CPU usage be of a fully-loaded CPU that has been throttled? — The Old New Thing | https://devblogs.microsoft.com/oldnewthing/20210629-00/?p=105378/ | 2026-11-27 | Throttled CPU reports weird utilization numbers — a measurement caveat: EcoQoS'd processes may look "idle" in CPU% while saving real energy; package power is the truth.

[331] | What makes cheap_steady_clock faster than std::chrono::high_resolution_clock? — The Old New Thing | https://devblogs.microsoft.com/oldnewthing/20251022-00/?p=111714/ | 2026-11-27 | Clock-read cost and timer granularity notes — timing-call overhead matters in hot loops (relevant to per-frame sampling in the benchmark harness).

[332] | Recording Hardware Performance (PMU) Events with Complete Examples — Microsoft DevBlogs | https://devblogs.microsoft.com/performance-diagnostics/recording-hardware-performance-pmu-events-with-complete-examples/ | 2026-11-27 | PMU counters (incl. energy) can be captured via Windows performance tooling — an alternate evidence channel if RAPL counters are unavailable on some silicon.

[333] | Power Assumptions Matter: Evaluating End-user Laptop Energy Models for Sustainability Reporting of Browser-Based Applications — arXiv 2510.12566 | https://arxiv.org/abs/2510.12566 | 2026-11-27 | Peer-reviewed evaluation of laptop browser energy models — warns that energy estimates depend on measurement assumptions; validates the benchmark's "measure, don't model" approach.

[334] | CarbonTag: A Browser-Based Method for Approximating Energy Consumption of Online Ads — arXiv 2211.00071 | https://arxiv.org/abs/2211.00071 | 2026-11-27 | Measures per-page/ads energy in-browser — prior art for attributing energy to specific page activity classes (like the benchmark's idle vs animated scenarios).

[335] | Native vs Web Apps: Comparing the Energy Consumption and Performance of Android Apps and their Web Counterparts — arXiv 2308.16734 | https://arxiv.org/abs/2308.16734 | 2026-11-27 | Methodology for comparing app energy across runtimes — the same experiment shape as Dexerion-vs-Edge, with careful controls.

[336] | [Bug]: Electron window may go blank after several minutes when hidden and disabling backgroundThrottling · Issue #42378 | https://github.com/electron/electron/issues/42378 | 2026-11-27 | Hidden windows with backgroundThrottling disabled can go blank — documents the hazard class Dexerion's background-tab fix had to navigate (and why throttling, not unthrottling, is the safe default).

[337] | backgroundThrottling heavily throttles web worker messages · Issue #51065 | https://github.com/electron/electron/issues/51065 | 2026-11-27 | Worker IPC is throttled in background windows — a Chromium-level saving Dexerion's hidden background views already receive automatically.

[338] | WebContentsView — visibility (backgroundThrottling, size, Page Visibility API) · Issue #44590 | https://github.com/electron/electron/issues/44590 | 2026-11-27 | Open issue tracking WebContentsView visibility semantics — the exact API area Dexerion's tab architecture lives in; the Builder should watch resolution for behavior changes.

[339] | [Bug]: backgroundThrottling: false ignored by OffscreenCanvas · Issue #33703 | https://github.com/electron/electron/issues/33703 | 2026-11-27 | OffscreenCanvas work in background windows behaves differently under throttling — an edge case to document in the "no foreground regression, background saving" contract.

[340] | [Bug]: Disabling backgroundThrottling not working with hide() on Windows · Issue #31016 | https://github.com/electron/electron/issues/31016 | 2026-11-27 | Windows-specific hide()+throttling interaction — platform evidence that hide() is the effective visibility control on this OS.

[341] | Chameleon: A Color-Adaptive Web Browser for Mobile OLED Displays — arXiv 1101.1240 | https://arxiv.org/abs/1101.1240 | 2026-11-27 | Classic browser power paper (OLED color) — establishes page-level power measurement methodology and the principle that content affects power, hence the benchmark's controlled workloads.

[342] | Web Performance with Android's Battery-Saver Mode — arXiv 2003.06477 | https://arxiv.org/abs/2003.06477 | 2026-11-27 | Battery-saver OS modes measurably change web performance — the Tester must record OS battery state per run (mission's controlled-protocol requirement).

[343] | Leaked-Web: Website Fingerprinting through Hardware Performance Counters — arXiv 2110.01202 | https://arxiv.org/abs/2110.01202 | 2026-11-27 | Shows perf counters are fine-grained enough to fingerprint page activity — implies the counters Dexerion uses are sensitive to real per-tab behavior (good for attribution, note as a privacy footnote).

[344] | [Bug]: Setting backgroundThrottling to undefined evaluates to false · Issue #44160 | https://github.com/electron/electron/issues/44160 | 2026-11-27 | webPreferences default-value footgun — the Builder must set throttling explicitly rather than relying on undefined semantics.

[345] | Android Scroll Jank Metric — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/graphics/scrolling/scroll_jank_metric.md | 2026-11-27 | Chromium's scroll-jank metric definitions — the measurement vocabulary for "smoothness preserved" gates on any rendering change.

[346] | Navigation Concepts — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/navigation_concepts.md | 2026-11-27 | Navigation/commit terminology — grounding for the wake-from-sleep reload path (a sleeping tab's restore is a navigation, with all its costs).

[347] | How cc Works — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/how_cc_works.md | 2026-11-27 | The compositor (cc) internals — the machinery that stops producing output for hidden views; core evidence for the hidden-view lever.

[348] | Chromium Flag Guarding Guidelines — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/flag_guarding_guidelines.md | 2026-11-27 | How flags must be guarded (base::FeatureList) — background for Dexerion's own named-budget pattern (DEX_DEBLOAT_BASELINE) as a Chromium-style kill switch.

[349] | Chromium Flag Expiry — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/flag_expiry.md | 2026-11-27 | Flags expire to prevent permanent experiment cruft — a governance principle for Dexerion's own flags/budgets.

[350] | Window: setTimeout() — MDN | https://developer.mozilla.org/en-US/docs/Web/API/setTimeout | 2026-11-27 | MDN documents browser throttling of setTimeout in inactive tabs (min 1s, heavier in Chrome) — the web-visible contract Dexerion's sleeps extend.

[351] | Window: setInterval() — MDN | https://developer.mozilla.org/en-US/docs/Web/API/setInterval | 2026-11-27 | Same throttling contract for intervals — pages designed against the spec stay functional when hidden; Dexerion's sleep is spec-compatible.

[352] | Window: requestAnimationFrame() — MDN | https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame | 2026-11-27 | rAF fires only when the frame is renderable — the documented reason hidden views suspend their rAF loops (Dexerion's core background saving).

[353] | Web Workers API — MDN | https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API | 2026-11-27 | Workers run off the main thread — the renderer-side model for moving heavy work; applies to dexerion:// shell pages too.

[354] | MessageChannel — MDN | https://developer.mozilla.org/en-US/docs/Web/API/MessageChannel | 2026-11-27 | Lightweight channel messaging vs broadcast — matches the main-process recommendation to use targeted ports instead of state broadcasts.

[355] | GPU Preemption — Windows drivers | Microsoft Learn | https://learn.microsoft.com/en-us/windows-hardware/drivers/display/gpu-preemption | 2026-11-27 | WDDM preempts GPU work at primitive/draw/command levels — why one busy renderer can't fully starve compositing, and why per-view GPU attribution needs engine-level counters.

[356] | ID3D11Device::CreateQuery — Win32 | Microsoft Learn | https://learn.microsoft.com/en-us/windows/win32/api/d3d11/nf-d3d11-id3d11device-createquery | 2026-11-27 | D3D query objects (timestamps, statistics) — the instrument-level GPU measurement primitives under the counters the Tester samples.

[357] | Software Layers — Win32 | Microsoft Learn | https://learn.microsoft.com/en-us/windows/win32/direct3d11/overviews-direct3d-11-devices-layers | 2026-11-27 | D3D11 software/layer semantics (WARP) — what --disable-gpu falls back onto (matches SwiftShader doc [63]).

[358] | Scheduling Priorities — Win32 | Microsoft Learn | https://learn.microsoft.com/en-us/windows/win32/procthread/scheduling-priorities | 2026-11-27 | Thread priority taxonomy — the safe demotion targets for Dexerion's own background work (never the foreground renderer's threads).

[359] | gpu-virtualization — Microsoft Learn | https://learn.microsoft.com/en-us/windows-hardware/drivers/display/gpu-virtualization | 2026-11-27 | UNVERIFIED (404 at fetch; path moved): GPU virtualization doc — retained as a placeholder to re-discover; not load-bearing for the plan.

[360] | hardware-accelerated-video-decoding — Microsoft Learn | https://learn.microsoft.com/en-us/windows/win32/medfound/hardware-accelerated-video-decoding | 2026-11-27 | UNVERIFIED (404 at fetch; Media Foundation restructured its docs): hardware decode guidance — the plan's rule stands on [29] (Video Playback and Compositor) instead.

[361] | Windows Native Window Occlusion Detection — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/windows_native_window_occlusion_tracking.md | 2026-11-27 | Chromium's native occlusion tracker design: it pauses compositing for fully occluded windows using Windows occlusion events — this is the feature Dexerion disables due to Windows occlusion misfires; the plan keeps the disable but notes the alternative (visibility-based hiding already implemented).

[362] | VA-API — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/gpu/vaapi.md | 2026-11-27 | Hardware video decode architecture (VA-API on Linux; analog of D3D11VA on Windows) — reconfirms: hardware decode must stay ON in every GPU tier because decode offload is a genuine power win.

[363] | Multiple Processors — Win32 | Microsoft Learn | https://learn.microsoft.com/en-us/windows/win32/procthread/multiple-processors | 2026-11-27 | Processors/affinity/ideal-processor semantics — background for understanding E-core/P-core placement effects that EcoQoS relies on.

[364] | Vivaldi 4185.3 snapshot (Adblocker, Tab Group API) — Vivaldi Blog | https://vivaldi.com/blog/desktop/adblocker-tab-group-api-vivaldi-browser-snapshot-4185-3/ | 2026-11-27 | Vivaldi continues tuning its built-in adblocker — prior art that in-browser filtering (instead of none) changes CPU measurably; Dexerion could optionally evaluate similar content-block savings without changing defaults.

[365] | Vivaldi 4175.3 snapshot (Adblocker further work) — Vivaldi Blog | https://vivaldi.com/blog/desktop/adblocker-further-work-vivaldi-browser-snapshot-4175-3/ | 2026-11-27 | Same prior-art category: content-level work reduction as a resource lever in a real Chromium-based product.

[366] | Vivaldi 7.9 release — Vivaldi Blog | https://vivaldi.com/blog/vivaldi-on-desktop-7-9/ | 2026-11-27 | Chromium-major release notes from a peer Chromium browser — cadence evidence for the "stay current" recommendation.

[367] | Vivaldi 7.9 changelog — Vivaldi | https://vivaldi.com/changelog-vivaldi-browser-7-9/ | 2026-11-27 | Changelog detail for [366] — the kind of public, auditable change-log Dexerion's own flags/budgets should mirror.

[368] | document.visibilityState set to "hidden" when WebContents is occluded — Chrome Platform Status | https://chromestatus.com/feature/6699045456183296 | 2026-11-27 | Chromium tracks occlusion to visibility — the same OS signal that makes Dexerion's hide-inactive-views lever behave exactly like a natively occluded window.

[369] | Faster background freezing on Android — Chrome Platform Status | https://chromestatus.com/feature/5386725031149568 | 2026-11-27 | Chromium freezes background pages faster on resource-constrained platforms — precedent for Dexerion's 3-minute idle teardown being within the range shipped browsers consider safe.

[370] | Freezing on Energy Saver — Chrome Platform Status | https://chromestatus.com/feature/5158599457767424 | 2026-11-27 | Chrome freezes pages when Energy Saver engages — direct prior art tying OS battery state to background freezing (mirrors Dexerion's on-battery tier).

[371] | Intensive throttling of Javascript timer wake ups — Chrome Platform Status | https://chromestatus.com/feature/4718288976216064 | 2026-11-27 | The feature entry for the 1-minute wake-up budget — confirms the mechanism Edge also ships ([174]) and that Dexerion inherits it for hidden tabs.

[372] | Pause Worklets and Dedicated Workers Execution on document freeze — Chrome Platform Status | https://chromestatus.com/feature/5276568928649216 | 2026-11-27 | Freeze extends to workers/worklets — deeper background cost reduction than timers alone; the reason Dexerion's full teardown frees even more.

[373] | Align Timers (including DOM timers) at 125 Hz — Chrome Platform Status | https://chromestatus.com/feature/5680188671655936 | 2026-11-27 | Chromium aligns timer wakes to reduce CPU wakeups — an existing wakeup-coalescing layer that app-side sweep cadence composes with.

[374] | Standardize iframe throttling for display:none and non-visible iframes — Chrome Platform Status | https://chromestatus.com/feature/5175574929080320 | 2026-11-27 | Non-visible iframes get throttled — cross-origin frames inside background tabs (the heavy case: ads, embeds) are already throttled by Chromium.

[375] | Background work API — Chrome Platform Status | https://chromestatus.com/feature/5399684618256384 | 2026-11-27 | Upcoming web API for background work budgets — direction-of-travel evidence that platforms are formalizing exactly the budget model Dexerion uses.

[376] | Pages with Cache-control: no-store and Back/Forward Cache — Chrome Platform Status | https://chromestatus.com/feature/6705326844805120 | 2026-11-27 | BFCache eligibility vs no-store — sleep/teardown policy must respect site directives or sites break (functionality constraint made concrete).

[377] | subsequent simultaneous Electron startup very slow · Issue #13163 | https://github.com/electron/electron/issues/13163 | 2026-11-27 | Multi-instance startup contention — Dexerion's single-instance lock avoids this class; benchmark protocol should still run one instance only.

[378] | [Windows] Slow startup due to antivirus softwares · Issue #1487 | https://github.com/electron/electron/issues/1487 | 2026-11-27 | Antivirus scanning is a documented Windows startup/perf confounder — the co-tenant noise the mission brief warns about; the Tester must record AV activity per run.

[379] | Slow startup time (2 minutes!) on Windows · Issue #7902 | https://github.com/electron/electron/issues/7902 | 2026-11-27 | Extreme-startup reports trace to environment (AV/disk) not code — same measurement-hygiene conclusion as [378].

[380] | Slow startup for multiple instances and localStorage is not synchronized · Issue #22438 | https://github.com/electron/electron/issues/22438 | 2026-11-27 | Multi-instance storage costs and sync behavior — supports keeping one instance and one shared session (current design).

[381] | Declarative Performance Observer — Chrome Platform Status | https://chromestatus.com/feature/6594955352080384 | 2026-11-27 | Chromium exploring declarative perf observation — evidence the platform is formalizing perf-signal surfaces similar to Dexerion's adaptive-power signals.

[382] | IndexedDB: SQLite backend — Chrome Platform Status | https://chromestatus.com/feature/5161589557821440 | 2026-11-27 | IndexedDB moving to a SQLite backend changes storage CPU/memory profile — version-sensitive behavior the benchmark should note across Chromium majors.

[383] | IndexedDB: SQLite backend (in-memory contexts) — Chrome Platform Status | https://chromestatus.com/feature/5126896685809664 | 2026-11-27 | In-memory contexts follow the same backend change — pairs with [382].

[384] | JavaScript call stacks in out-of-memory (OOM) crash reports — Chrome Platform Status | https://chromestatus.com/feature/5111794608766976 | 2026-11-27 | Better OOM diagnostics — the safety net if aggressive heap caps ever push a pathological site over the limit.

[385] | Battery status API gated by permissions policy — Chrome Platform Status | https://chromestatus.com/feature/5134470074597376 | 2026-11-27 | Battery info is permission-gated in web APIs — Dexerion reads battery via the main process (powerMonitor), which is the appropriate, non-web-surface way.

[386] | ServiceWorker support for Speculation Rules Prefetch — Chrome Platform Status | https://chromestatus.com/feature/4996410105397248 | 2026-11-27 | Speculative prefetch keeps expanding (now through SWs) — a lean browser should keep speculation rules default but measure their cost in the active-browsing scenario.

[387] | XML parsing in Rust for non-XSLT scenarios — Chrome Platform Status | https://chromestatus.com/feature/5309598397497344 | 2026-11-27 | Rust rewrites of parsing paths — steady engine-level CPU/safety improvements arriving with Chromium updates.

[388] | Overview of DevTools — Microsoft Edge | https://learn.microsoft.com/en-us/microsoft-edge/devtools/overview | 2026-11-27 | Edge DevTools docs hub — the tools Edge itself uses to measure; useful for a manual cross-check on the Edge side of the comparison.

[389] | Network features reference — Microsoft Edge DevTools | https://learn.microsoft.com/en-us/microsoft-edge/devtools/network/reference | 2026-11-27 | Edge network tooling (cache status, request costs) — attribution of network-side differences between the two browsers.

[390] | Microsoft Edge startup boost — Edge docs | https://learn.microsoft.com/en-us/deployedge/microsoft-edge-security-startup-boost | 2026-11-27 | UNVERIFIED (404 at fetch; page moved/renamed): Edge's startup-boost keeps background processes alive — if verified, it's important for the comparison: Edge may hold resident processes when "closed", changing idle power attribution.

[391] | Cache sharing for extremely-pervasive resources — Chrome Platform Status | https://chromestatus.com/feature/5202380930678784 | 2026-11-27 | Chromium shares cached copies of ultra-common resources — shows the engine already deduplicates memory across tabs; app-level wins must come from elsewhere.

[392] | No-Vary-Search support for the HTTP disk cache — Chrome Platform Status | https://chromestatus.com/feature/5808599110254592 | 2026-11-27 | Cache-key spec support improves hit rates — fewer network+CPU rounds per navigation; inherited automatically, worth verifying in the network traces.

[393] | Optional browser optimization for Service Workers — Chrome Platform Status | https://chromestatus.com/feature/5194817700364288 | 2026-11-27 | Chromium may skip SW startup when the request is unlikely to be handled — engine-level wake-up avoidance in the same spirit as Dexerion's sweeps.

[394] | Compression dictionary transport (Shared Brotli/Zstd) — Chrome Platform Status | https://chromestatus.com/feature/5124977788977152 | 2026-11-27 | Shared dictionaries cut decompression CPU and bytes — engine win to verify in benchmark network traces.

[395] | IndexedDB relaxed durability transactions — Chrome Platform Status | https://chromestatus.com/feature/5730701489995776 | 2026-11-27 | Relaxed fsync semantics reduce disk I/O power at documented reliability trade-offs — site-controlled; browser must honor, not override.

[396] | 'font-display: optional' without relayout — Chrome Platform Status | https://chromestatus.com/feature/6386634616471552 | 2026-11-27 | Avoiding font-swap relayout removes whole relayout passes — page-controlled savings that benefit the animated workload's CPU numbers.

[397] | CacheStorage Code Cache Hint — Chrome Platform Status | https://chromestatus.com/feature/5685099288854528 | 2026-11-27 | Code-cache hints for cached scripts — faster JS startup on repeat visits (CPU + energy) without app work.

[398] | Clear BFCache during browsing data removal — Chrome Platform Status | https://chromestatus.com/feature/5096684790480896 | 2026-11-27 | Data-removal clears BFCache — interaction between hygiene features and background caches that sleep/teardown policy must mirror (privacy correctness).

[399] | Microsoft Edge release notes for Stable Channel | https://learn.microsoft.com/en-us/deployedge/microsoft-edge-relnote-stable-channel | 2026-11-27 | Edge stable release notes — the Tester should record the exact Edge version; its Chromium base determines which throttling features are active in the comparison.

[400] | speed_metrics README — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/speed_metrics/README.md | 2026-11-27 | Speed-metric index — the metric glossary backing [59] and [186].

[401] | perf_waterfall — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/speed/perf_waterfall.md | 2026-11-27 | How Chromium's perf waterfall catches regressions — the process template for gating each plan item on measurement.

[402] | Debugging GPU-related code — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/gpu/debugging_gpu_related_code.md | 2026-11-27 | GPU debugging entry points (about:gpu, traces) — verification tooling for GPU-attributed changes.

[403] | Speed Domains — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/speed/speed_domains.md | 2026-11-27 | Chromium partitions perf work into speed domains — the template for attributing each plan item to a measurable domain (startup, browsing, background, power).

[404] | Accessibility — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/accessibility.md | 2026-11-27 | Accessibility architecture overview — the a11y tree's memory/CPU cost model ([34]); must stay available on demand for compatibility.

[405] | docs/webui README — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/webui/README.md | 2026-11-27 | UNVERIFIED (404 at fetch; WebUI docs live elsewhere in the tree): WebUI architecture — dexerion:// pages are the same pattern; cite [12] instead.

[406] | WebGL: 2D and 3D graphics for the web — MDN | https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API | 2026-11-27 | WebGL pages are the GPU-heavy class — the demand signal (score +5) in adaptive-power's demandScore; identifies when the accelerated tier is genuinely needed.

[407] | Canvas API — MDN | https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API | 2026-11-27 | Canvas (2D) workloads rasterize continuously — the benchmark's animated workload is canvas-based, matching real heavy-page GPU/raster behavior.

[408] | IndexedDB API — MDN | https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API | 2026-11-27 | Site storage surface whose I/O Dexerion must not corrupt when sleeping/tearing down tabs ([212]–[213]).

[409] | Web Storage API — MDN | https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API | 2026-11-27 | localStorage/sessionStorage persistence guarantees — teardown must preserve them (a sleeping tab that loses localStorage is a broken tab).

[410] | Service Worker API — MDN | https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API | 2026-11-27 | SW lifecycle (idle-killable, event-driven) — already resource-friendly; extension service workers ride the same model ([215]).

[411] | Fetch API — MDN | https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API | 2026-11-27 | The per-request path every page uses — network-side savings (cache hits, no speculative fetches) show up here, measurable via NetLog ([211]).

[412] | Using d8 · V8 | https://v8.dev/docs/d8 | 2026-11-27 | d8 (developer shell) runs V8 standalone with flags — lets the Builder test js-flags variants (e.g. --max-semi-space-size) without booting the app.

[413] | V8 is Faster and Safer than Ever! · V8 | https://v8.dev/blog/holiday-season-2023 | 2026-11-27 | Survey of recent engine wins (memory + speed) — currency evidence for the version recommendation.

[414] | Background compilation · V8 | https://v8.dev/blog/background-compilation | 2026-11-27 | Parsing/compilation off the main thread — main-thread stays responsive during load; part of the baseline both browsers share.

[415] | Performance budgets 101 | web.dev | https://web.dev/articles/performance-budgets-101 | 2026-11-27 | Formal budget methodology — the same named-budget discipline as debloat-budgets.js, cited as prior art for the plan's budget table.

[416] | How to measure INP | web.dev | https://web.dev/articles/how-to-measure-inp | 2026-11-27 | UNVERIFIED (404 at fetch; moved into /articles/optimize-inp [309]): INP measurement guide — superseded by [309].

[417] | Chrome is slow, what do I do? — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/speed/help_improve_performance.md | 2026-11-27 | Chromium's own user-facing slowness triage — the vocabulary for reporting speed parity in Dexerion's docs.

[418] | Micro-benchmark Regressions — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/speed/microbenchmark_regressions.md | 2026-11-27 | Micro-benchmark guidance — supports the plan's requirement that sweep-cadence changes prove themselves in targeted micro-measurements, not just end-to-end power.

[419] | Bisecting Performance Regressions — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/speed/bisects.md | 2026-11-27 | Bisect methodology — the rollback playbook when a lever regresses: identify the change, bisect, revert the budget.

[420] | Filing Memory Bugs — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/memory/filing_memory_bugs.md | 2026-11-27 | What evidence a memory bug needs — the shape of the Tester's RAM-claim evidence bundles.

[421] | Example Investigation of a Heap Dump — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/memory/investigating_heap_dump_example.md | 2026-11-27 | Worked heap-dump investigation — a concrete pattern for proving Dexerion's caches/registries stay bounded over long sessions.

[422] | docs/transcripts — Chromium source | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/transcripts/ | 2026-11-27 | Chromium perf/design talk transcripts index — background reading pool for deep compositor/scheduler questions.

[423] | docs/privacy — Chromium source | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/privacy/ | 2026-11-27 | Privacy design docs index — sleep/teardown policy must preserve privacy semantics when discarding state ([398]).

[424] | docs/webapps — Chromium source | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/webapps/ | 2026-11-27 | Web-apps docs (PWA/installation) — installed webapps behave like tabs; sleep policy must include them consistently.

[425] | History manipulation intervention in Chromium — Chromium Docs | https://chromium.googlesource.com/chromium/src/+/HEAD/docs/history_manipulation_intervention.md | 2026-11-27 | History interventions show how Chromium guards user-visible state — same care needed when a sleeping tab's history/session entries are restored.

---

## Group I — Synthesis: the 10 most promising lever areas (with evidence)

1. **Background-tab full teardown (renderer process exit), tuned aggressively but safely.** Chromium freezes hidden pages ([42][181][371]) and Edge discards sleeping tabs ([175][240][238]) — but a full process exit frees far more than freezing ([97][84][93]: heap slack, snapshot costs, Oilpan/C++ heap floors). Dexerion's 3-min idle teardown ([debloat-budgets idleSleepMs]) already implements this; the lever is making the sleep/teardown state machine complete (recovery, storage durability [408][409], BFCache interplay [315][376]) and measuring it.
   Evidence: [41][42][97][175][238][240][369][370].

2. **Hidden-view visibility control (WebContentsView.setVisible) as the compositor off-switch.** Hidden views stop frame production end-to-end (rAF suspended [274][352]; Blink scheduler throttles hidden-page timers [191][350][351]; workers/worklets pause on freeze [372]; viz stops aggregating surfaces [80][81][207]). This is the single biggest CPU+GPU lever for background tabs and is already implemented in browser.js — the remaining work is ensuring every window/tab path (popups [230], overlays, devtools) applies it consistently and never to the focused tab.
   Evidence: [20][22][27][42][47][80][81][207][274][309][337][338].

3. **Speculation policy: keep compatibility, cut waste.** Prerender/preconnect/DNS-prefetch/omnibox-prefetch ([46][200][201][219][314][386]) launch full hidden renderers and sockets. A "lean speculation" profile (speculation only for real user-adjacent navigations) cuts network/CPU/GPU without removing any user-visible feature (speculation is, by definition, speculative).
   Evidence: [33][46][70][200][201][219][314][386][392][394].

4. **GPU tier policy (raster/zero-copy/low-power-gpu/memory budgets) driven by content signals.** GPU raster + zero-copy save battery in the common case ([2][3][4][5][206]); `--force-low-power-gpu` targets the iGPU on hybrid graphics ([169][170]); `--force-gpu-mem-available-mb` caps GPU memory ([79]). The adaptive tiers (adaptive-power.js) already encode this; the lever is validating tiers against the GPU Engine counters and tuning the demand score (video/WebGL must always keep the dGPU when present [29][406]).
   Evidence: [2][3][4][5][7][9][10][29][63][79][155][160][169][170][206][355].

5. **Main-process wakeup hygiene (sweep cadence, timer coalescing, event-driven signals).** Every periodic wake costs package power ([155][154][329][373]); Chromium already aligns timers ([373]) and the OS coalesces ([154][329]). Dexerion's sweep is timeout-driven with hysteresis ([adaptive-power]); the lever is pushing long-idle cadences further (minutes, not seconds), using event-loop utilization instead of CPU% ([282]), and unref-ing everything ([281]).
   Evidence: [43][44][154][155][281][282][329][330][373].

6. **Named budgets for Dexerion's own memory (caches, registries, buffers).** The debloat-budgets pattern ([348][349][415]) with Chromium's memory accounting ([48][49][76][83][254]) — the lever is extending budgets to every unbounded structure found by profiling (site registry already done; next: history/bookmarks write batching [221], protocol handler response caches [129], AI diagnostics caches).
   Evidence: [48][49][53][75][76][83][129][212][221][254][348][349][415].

7. **Process-tree shape: renderer-process-limit + process-per-site + optional-process trimming.** Process models are the dominant RAM/CPU multiplier ([11][13][40][196][198]); Chromium ships a documented limit switch ([78]) and several services are optional (spellcheck service [216], media router [68][202][403]). The lever is confirming the process inventory at runtime (VS Edge's tree [261]) and ensuring no redundant utility processes linger.
   Evidence: [11][13][17][40][78][196][198][202][216][261][403].

8. **Windows-native power integration (EcoQoS for Dexerion's own helper processes, timer-resolution awareness, power-plan pinning in tests).** Windows exposes per-process/per-thread power throttling ([150][151][152][257][258][326]) that Edge uses in efficiency mode ([236][237][326]). A browser can apply it to its own crashpad/updater-class helpers and to its AI service work — never to the foreground renderer. Also: never call timeBeginPeriod ([155]) and pin the test power plan ([272]).
   Evidence: [150]–[153][155][257][258][326][330][342].

9. **Benchmark protocol hardening (repeated, controlled, process-tree-wide).** The RAPL floor protocol works but is noise-limited; the literature and OS docs prescribe repetition, pinned power plans, fixed modes, AV/co-tenant recording, and counter cross-validation ([243][244][250][272][330][333][334][335][342]). GPU Engine counters + per-process CPU/WS sampling ([162][163][164][165][166]) plus ETW/WPA for disputes ([157][158][159][327]).
   Evidence: [54]–[61][157]–[166][242]–[244][250][272][326][330][332][333][334][335][342].

10. **Version currency + engine-inherited wins.** Pointer compression, static roots, Maglev/Sparkplug tuning, background compilation, SQLite IDB, Rust parsing, shared-dict compression ([84][86][87][91][414][382][387][394]) all arrive with Electron major bumps ([280][296][298]). Zero app code, real measured savings; the lever is keeping Dexerion's Electron pinned to recent majors and re-running the benchmark after bumps.
   Evidence: [84][86][87][88][91][96][118][280][294][296][298][382][387][394][413][414].

**Method note.** Sources were collected by direct fetching of documentation/design-doc/spec/paper URLs and via structured search-result extraction; each row records the access date. Rows marked UNVERIFIED could not be fetched at access time (bot-blocking or moved paths); no takeaways were invented for them. Row [171]/[172]/[173]/[195]/[205→n/a] style 404s are retained deliberately as negative results where the subject matters, with working substitutes cited.

---
