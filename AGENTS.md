# Dexerion UI development

For significant UI work, use GPT-6.2 Astra with High reasoning for visual direction, plan synthesis, frontend architecture, Codex implementation and final design approval. Use GPT-6.2 Sol or GPT-6.1 Terra for independent competitive research, UX research, codebase exploration and other supporting work. Report unavailable models or reasoning levels before implementing. Follow explicit task-specific model changes and record them in the review.

Assign competitive research, usability, visual direction, architecture and design critique with clear ownership. Astra reconciles the findings into a plan with alternatives, implementation constraints and measurable acceptance criteria. Give the implementation agent the approved direction, research and relevant design history in [DESIGN.md](DESIGN.md).

Work from the agreed Git revision in an isolated branch or checkout. Use focused diffs and branch-only review. Keep browser functionality, settings, security boundaries and performance intact during presentation changes.

Capture a matched baseline before changing the UI. Launch Dexerion and inspect screenshots at each milestone across relevant sizes, themes and interaction states. When the native app cannot launch, document tested renderer coverage and the outstanding native checks. Compare repeated baseline and candidate performance under the same conditions. Ask an independent reviewer to critique the rendered UI and address findings before final approval. Keep decisions and user feedback in DESIGN.md.
