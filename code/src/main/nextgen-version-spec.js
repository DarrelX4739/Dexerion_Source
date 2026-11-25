// Next-generation version ladders for Dexerion.
//
// V51-V130: the full UI overhaul. V131-V180: the debloat programme.
// Earlier ladders stay untouched: site 30, report 20, combined V31-V50.
// Every tier has exactly four improvements and four stable check IDs.
'use strict';

const UI_FIRST_VERSION = 51;
const UI_LAST_VERSION = 130;
const DEBLOAT_FIRST_VERSION = 131;
const DEBLOAT_LAST_VERSION = 180;

const UI_VERSION_SPEC = [
  {
    "version": 51,
    "program": "ui-overhaul",
    "theme": "Design foundation",
    "focus": "the single token contract for colour, type, spacing, radius and motion",
    "rules": [
      "Introduce the single token contract for colour, type, spacing, radius and motion through the shared design-token and component layer without changing existing behaviour.",
      "Apply the single token contract for colour, type, spacing, radius and motion consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while the single token contract for colour, type, spacing, radius and motion is active.",
      "Verify the single token contract for colour, type, spacing, radius and motion with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV51-C1",
      "UIV51-C2",
      "UIV51-C3",
      "UIV51-C4"
    ]
  },
  {
    "version": 52,
    "program": "ui-overhaul",
    "theme": "Design foundation",
    "focus": "a compact density scale shared by chrome, sidebar and pages",
    "rules": [
      "Introduce a compact density scale shared by chrome, sidebar and pages through the shared design-token and component layer without changing existing behaviour.",
      "Apply a compact density scale shared by chrome, sidebar and pages consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while a compact density scale shared by chrome, sidebar and pages is active.",
      "Verify a compact density scale shared by chrome, sidebar and pages with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV52-C1",
      "UIV52-C2",
      "UIV52-C3",
      "UIV52-C4"
    ]
  },
  {
    "version": 53,
    "program": "ui-overhaul",
    "theme": "Design foundation",
    "focus": "one accent and status colour map with verified light/dark contrast",
    "rules": [
      "Introduce one accent and status colour map with verified light/dark contrast through the shared design-token and component layer without changing existing behaviour.",
      "Apply one accent and status colour map with verified light/dark contrast consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while one accent and status colour map with verified light/dark contrast is active.",
      "Verify one accent and status colour map with verified light/dark contrast with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV53-C1",
      "UIV53-C2",
      "UIV53-C3",
      "UIV53-C4"
    ]
  },
  {
    "version": 54,
    "program": "ui-overhaul",
    "theme": "Design foundation",
    "focus": "a documented non-generic visual identity for every surface",
    "rules": [
      "Introduce a documented non-generic visual identity for every surface through the shared design-token and component layer without changing existing behaviour.",
      "Apply a documented non-generic visual identity for every surface consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while a documented non-generic visual identity for every surface is active.",
      "Verify a documented non-generic visual identity for every surface with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV54-C1",
      "UIV54-C2",
      "UIV54-C3",
      "UIV54-C4"
    ]
  },
  {
    "version": 55,
    "program": "ui-overhaul",
    "theme": "Browser chrome",
    "focus": "a quieter tab strip with explicit active, loading and sleeping states",
    "rules": [
      "Introduce a quieter tab strip with explicit active, loading and sleeping states through the shared design-token and component layer without changing existing behaviour.",
      "Apply a quieter tab strip with explicit active, loading and sleeping states consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while a quieter tab strip with explicit active, loading and sleeping states is active.",
      "Verify a quieter tab strip with explicit active, loading and sleeping states with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV55-C1",
      "UIV55-C2",
      "UIV55-C3",
      "UIV55-C4"
    ]
  },
  {
    "version": 56,
    "program": "ui-overhaul",
    "theme": "Browser chrome",
    "focus": "a single-line toolbar with intentional grouping and no dead controls",
    "rules": [
      "Introduce a single-line toolbar with intentional grouping and no dead controls through the shared design-token and component layer without changing existing behaviour.",
      "Apply a single-line toolbar with intentional grouping and no dead controls consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while a single-line toolbar with intentional grouping and no dead controls is active.",
      "Verify a single-line toolbar with intentional grouping and no dead controls with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV56-C1",
      "UIV56-C2",
      "UIV56-C3",
      "UIV56-C4"
    ]
  },
  {
    "version": 57,
    "program": "ui-overhaul",
    "theme": "Browser chrome",
    "focus": "an address field with clear security, source and focus states",
    "rules": [
      "Introduce an address field with clear security, source and focus states through the shared design-token and component layer without changing existing behaviour.",
      "Apply an address field with clear security, source and focus states consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while an address field with clear security, source and focus states is active.",
      "Verify an address field with clear security, source and focus states with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV57-C1",
      "UIV57-C2",
      "UIV57-C3",
      "UIV57-C4"
    ]
  },
  {
    "version": 58,
    "program": "ui-overhaul",
    "theme": "Browser chrome",
    "focus": "window controls and overlays that never cover focus or content",
    "rules": [
      "Introduce window controls and overlays that never cover focus or content through the shared design-token and component layer without changing existing behaviour.",
      "Apply window controls and overlays that never cover focus or content consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while window controls and overlays that never cover focus or content is active.",
      "Verify window controls and overlays that never cover focus or content with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV58-C1",
      "UIV58-C2",
      "UIV58-C3",
      "UIV58-C4"
    ]
  },
  {
    "version": 59,
    "program": "ui-overhaul",
    "theme": "AI sidebar",
    "focus": "a persistent sidebar workspace with clear chat and artifact boundaries",
    "rules": [
      "Introduce a persistent sidebar workspace with clear chat and artifact boundaries through the shared design-token and component layer without changing existing behaviour.",
      "Apply a persistent sidebar workspace with clear chat and artifact boundaries consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while a persistent sidebar workspace with clear chat and artifact boundaries is active.",
      "Verify a persistent sidebar workspace with clear chat and artifact boundaries with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV59-C1",
      "UIV59-C2",
      "UIV59-C3",
      "UIV59-C4"
    ]
  },
  {
    "version": 60,
    "program": "ui-overhaul",
    "theme": "AI sidebar",
    "focus": "compact model, provider and effort readouts with honest status",
    "rules": [
      "Introduce compact model, provider and effort readouts with honest status through the shared design-token and component layer without changing existing behaviour.",
      "Apply compact model, provider and effort readouts with honest status consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while compact model, provider and effort readouts with honest status is active.",
      "Verify compact model, provider and effort readouts with honest status with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV60-C1",
      "UIV60-C2",
      "UIV60-C3",
      "UIV60-C4"
    ]
  },
  {
    "version": 61,
    "program": "ui-overhaul",
    "theme": "AI sidebar",
    "focus": "stable message grouping and streaming state that never jumps",
    "rules": [
      "Introduce stable message grouping and streaming state that never jumps through the shared design-token and component layer without changing existing behaviour.",
      "Apply stable message grouping and streaming state that never jumps consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while stable message grouping and streaming state that never jumps is active.",
      "Verify stable message grouping and streaming state that never jumps with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV61-C1",
      "UIV61-C2",
      "UIV61-C3",
      "UIV61-C4"
    ]
  },
  {
    "version": 62,
    "program": "ui-overhaul",
    "theme": "AI sidebar",
    "focus": "context chips and attachments with removable, labelled states",
    "rules": [
      "Introduce context chips and attachments with removable, labelled states through the shared design-token and component layer without changing existing behaviour.",
      "Apply context chips and attachments with removable, labelled states consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while context chips and attachments with removable, labelled states is active.",
      "Verify context chips and attachments with removable, labelled states with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV62-C1",
      "UIV62-C2",
      "UIV62-C3",
      "UIV62-C4"
    ]
  },
  {
    "version": 63,
    "program": "ui-overhaul",
    "theme": "Tabs and navigation",
    "focus": "keyboard-first tab creation, switching, closing and restoration",
    "rules": [
      "Introduce keyboard-first tab creation, switching, closing and restoration through the shared design-token and component layer without changing existing behaviour.",
      "Apply keyboard-first tab creation, switching, closing and restoration consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while keyboard-first tab creation, switching, closing and restoration is active.",
      "Verify keyboard-first tab creation, switching, closing and restoration with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV63-C1",
      "UIV63-C2",
      "UIV63-C3",
      "UIV63-C4"
    ]
  },
  {
    "version": 64,
    "program": "ui-overhaul",
    "theme": "Tabs and navigation",
    "focus": "tab groups with visible identity and predictable collapse behaviour",
    "rules": [
      "Introduce tab groups with visible identity and predictable collapse behaviour through the shared design-token and component layer without changing existing behaviour.",
      "Apply tab groups with visible identity and predictable collapse behaviour consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while tab groups with visible identity and predictable collapse behaviour is active.",
      "Verify tab groups with visible identity and predictable collapse behaviour with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV64-C1",
      "UIV64-C2",
      "UIV64-C3",
      "UIV64-C4"
    ]
  },
  {
    "version": 65,
    "program": "ui-overhaul",
    "theme": "Tabs and navigation",
    "focus": "back/forward/reload states with accessible progress feedback",
    "rules": [
      "Introduce back/forward/reload states with accessible progress feedback through the shared design-token and component layer without changing existing behaviour.",
      "Apply back/forward/reload states with accessible progress feedback consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while back/forward/reload states with accessible progress feedback is active.",
      "Verify back/forward/reload states with accessible progress feedback with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV65-C1",
      "UIV65-C2",
      "UIV65-C3",
      "UIV65-C4"
    ]
  },
  {
    "version": 66,
    "program": "ui-overhaul",
    "theme": "Tabs and navigation",
    "focus": "session restore that preserves focus, scroll and sidebar context",
    "rules": [
      "Introduce session restore that preserves focus, scroll and sidebar context through the shared design-token and component layer without changing existing behaviour.",
      "Apply session restore that preserves focus, scroll and sidebar context consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while session restore that preserves focus, scroll and sidebar context is active.",
      "Verify session restore that preserves focus, scroll and sidebar context with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV66-C1",
      "UIV66-C2",
      "UIV66-C3",
      "UIV66-C4"
    ]
  },
  {
    "version": 67,
    "program": "ui-overhaul",
    "theme": "AI features",
    "focus": "prompt recipes that insert without overwriting user text",
    "rules": [
      "Introduce prompt recipes that insert without overwriting user text through the shared design-token and component layer without changing existing behaviour.",
      "Apply prompt recipes that insert without overwriting user text consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while prompt recipes that insert without overwriting user text is active.",
      "Verify prompt recipes that insert without overwriting user text with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV67-C1",
      "UIV67-C2",
      "UIV67-C3",
      "UIV67-C4"
    ]
  },
  {
    "version": 68,
    "program": "ui-overhaul",
    "theme": "AI features",
    "focus": "web-search status with source counts and honest failure text",
    "rules": [
      "Introduce web-search status with source counts and honest failure text through the shared design-token and component layer without changing existing behaviour.",
      "Apply web-search status with source counts and honest failure text consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while web-search status with source counts and honest failure text is active.",
      "Verify web-search status with source counts and honest failure text with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV68-C1",
      "UIV68-C2",
      "UIV68-C3",
      "UIV68-C4"
    ]
  },
  {
    "version": 69,
    "program": "ui-overhaul",
    "theme": "AI features",
    "focus": "memory and project controls with explicit consent state",
    "rules": [
      "Introduce memory and project controls with explicit consent state through the shared design-token and component layer without changing existing behaviour.",
      "Apply memory and project controls with explicit consent state consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while memory and project controls with explicit consent state is active.",
      "Verify memory and project controls with explicit consent state with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV69-C1",
      "UIV69-C2",
      "UIV69-C3",
      "UIV69-C4"
    ]
  },
  {
    "version": 70,
    "program": "ui-overhaul",
    "theme": "AI features",
    "focus": "mission and task handoffs that keep the conversation on thread",
    "rules": [
      "Introduce mission and task handoffs that keep the conversation on thread through the shared design-token and component layer without changing existing behaviour.",
      "Apply mission and task handoffs that keep the conversation on thread consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while mission and task handoffs that keep the conversation on thread is active.",
      "Verify mission and task handoffs that keep the conversation on thread with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV70-C1",
      "UIV70-C2",
      "UIV70-C3",
      "UIV70-C4"
    ]
  },
  {
    "version": 71,
    "program": "ui-overhaul",
    "theme": "Artifact previews",
    "focus": "site and report previews with a shared control vocabulary",
    "rules": [
      "Introduce site and report previews with a shared control vocabulary through the shared design-token and component layer without changing existing behaviour.",
      "Apply site and report previews with a shared control vocabulary consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while site and report previews with a shared control vocabulary is active.",
      "Verify site and report previews with a shared control vocabulary with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV71-C1",
      "UIV71-C2",
      "UIV71-C3",
      "UIV71-C4"
    ]
  },
  {
    "version": 72,
    "program": "ui-overhaul",
    "theme": "Artifact previews",
    "focus": "device presets, fullscreen, reload, console and edit affordances",
    "rules": [
      "Introduce device presets, fullscreen, reload, console and edit affordances through the shared design-token and component layer without changing existing behaviour.",
      "Apply device presets, fullscreen, reload, console and edit affordances consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while device presets, fullscreen, reload, console and edit affordances is active.",
      "Verify device presets, fullscreen, reload, console and edit affordances with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV72-C1",
      "UIV72-C2",
      "UIV72-C3",
      "UIV72-C4"
    ]
  },
  {
    "version": 73,
    "program": "ui-overhaul",
    "theme": "Artifact previews",
    "focus": "preview health and error states that explain instead of blanking",
    "rules": [
      "Introduce preview health and error states that explain instead of blanking through the shared design-token and component layer without changing existing behaviour.",
      "Apply preview health and error states that explain instead of blanking consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while preview health and error states that explain instead of blanking is active.",
      "Verify preview health and error states that explain instead of blanking with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV73-C1",
      "UIV73-C2",
      "UIV73-C3",
      "UIV73-C4"
    ]
  },
  {
    "version": 74,
    "program": "ui-overhaul",
    "theme": "Artifact previews",
    "focus": "image, table and citation rendering with consistent typography",
    "rules": [
      "Introduce image, table and citation rendering with consistent typography through the shared design-token and component layer without changing existing behaviour.",
      "Apply image, table and citation rendering with consistent typography consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while image, table and citation rendering with consistent typography is active.",
      "Verify image, table and citation rendering with consistent typography with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV74-C1",
      "UIV74-C2",
      "UIV74-C3",
      "UIV74-C4"
    ]
  },
  {
    "version": 75,
    "program": "ui-overhaul",
    "theme": "Settings and account",
    "focus": "a settings information architecture with one clear path per task",
    "rules": [
      "Introduce a settings information architecture with one clear path per task through the shared design-token and component layer without changing existing behaviour.",
      "Apply a settings information architecture with one clear path per task consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while a settings information architecture with one clear path per task is active.",
      "Verify a settings information architecture with one clear path per task with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV75-C1",
      "UIV75-C2",
      "UIV75-C3",
      "UIV75-C4"
    ]
  },
  {
    "version": 76,
    "program": "ui-overhaul",
    "theme": "Settings and account",
    "focus": "provider and model controls that never lose the current draft",
    "rules": [
      "Introduce provider and model controls that never lose the current draft through the shared design-token and component layer without changing existing behaviour.",
      "Apply provider and model controls that never lose the current draft consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while provider and model controls that never lose the current draft is active.",
      "Verify provider and model controls that never lose the current draft with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV76-C1",
      "UIV76-C2",
      "UIV76-C3",
      "UIV76-C4"
    ]
  },
  {
    "version": 77,
    "program": "ui-overhaul",
    "theme": "Settings and account",
    "focus": "account and sync status with explicit offline and error states",
    "rules": [
      "Introduce account and sync status with explicit offline and error states through the shared design-token and component layer without changing existing behaviour.",
      "Apply account and sync status with explicit offline and error states consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while account and sync status with explicit offline and error states is active.",
      "Verify account and sync status with explicit offline and error states with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV77-C1",
      "UIV77-C2",
      "UIV77-C3",
      "UIV77-C4"
    ]
  },
  {
    "version": 78,
    "program": "ui-overhaul",
    "theme": "Settings and account",
    "focus": "key management and privacy controls with plain-language warnings",
    "rules": [
      "Introduce key management and privacy controls with plain-language warnings through the shared design-token and component layer without changing existing behaviour.",
      "Apply key management and privacy controls with plain-language warnings consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while key management and privacy controls with plain-language warnings is active.",
      "Verify key management and privacy controls with plain-language warnings with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV78-C1",
      "UIV78-C2",
      "UIV78-C3",
      "UIV78-C4"
    ]
  },
  {
    "version": 79,
    "program": "ui-overhaul",
    "theme": "Tasks and focus timer",
    "focus": "task creation with validation and visible due/priority chips",
    "rules": [
      "Introduce task creation with validation and visible due/priority chips through the shared design-token and component layer without changing existing behaviour.",
      "Apply task creation with validation and visible due/priority chips consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while task creation with validation and visible due/priority chips is active.",
      "Verify task creation with validation and visible due/priority chips with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV79-C1",
      "UIV79-C2",
      "UIV79-C3",
      "UIV79-C4"
    ]
  },
  {
    "version": 80,
    "program": "ui-overhaul",
    "theme": "Tasks and focus timer",
    "focus": "completed-task handling that preserves undo and history",
    "rules": [
      "Introduce completed-task handling that preserves undo and history through the shared design-token and component layer without changing existing behaviour.",
      "Apply completed-task handling that preserves undo and history consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while completed-task handling that preserves undo and history is active.",
      "Verify completed-task handling that preserves undo and history with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV80-C1",
      "UIV80-C2",
      "UIV80-C3",
      "UIV80-C4"
    ]
  },
  {
    "version": 81,
    "program": "ui-overhaul",
    "theme": "Tasks and focus timer",
    "focus": "focus timer phases that are legible without reading the clock",
    "rules": [
      "Introduce focus timer phases that are legible without reading the clock through the shared design-token and component layer without changing existing behaviour.",
      "Apply focus timer phases that are legible without reading the clock consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while focus timer phases that are legible without reading the clock is active.",
      "Verify focus timer phases that are legible without reading the clock with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV81-C1",
      "UIV81-C2",
      "UIV81-C3",
      "UIV81-C4"
    ]
  },
  {
    "version": 82,
    "program": "ui-overhaul",
    "theme": "Tasks and focus timer",
    "focus": "site blocking and sound controls with persistent state",
    "rules": [
      "Introduce site blocking and sound controls with persistent state through the shared design-token and component layer without changing existing behaviour.",
      "Apply site blocking and sound controls with persistent state consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while site blocking and sound controls with persistent state is active.",
      "Verify site blocking and sound controls with persistent state with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV82-C1",
      "UIV82-C2",
      "UIV82-C3",
      "UIV82-C4"
    ]
  },
  {
    "version": 83,
    "program": "ui-overhaul",
    "theme": "Menus and overlays",
    "focus": "the main menu with guaranteed visible items and scrim dismissal",
    "rules": [
      "Introduce the main menu with guaranteed visible items and scrim dismissal through the shared design-token and component layer without changing existing behaviour.",
      "Apply the main menu with guaranteed visible items and scrim dismissal consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while the main menu with guaranteed visible items and scrim dismissal is active.",
      "Verify the main menu with guaranteed visible items and scrim dismissal with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV83-C1",
      "UIV83-C2",
      "UIV83-C3",
      "UIV83-C4"
    ]
  },
  {
    "version": 84,
    "program": "ui-overhaul",
    "theme": "Menus and overlays",
    "focus": "context menus with stable roles, icons and keyboard parity",
    "rules": [
      "Introduce context menus with stable roles, icons and keyboard parity through the shared design-token and component layer without changing existing behaviour.",
      "Apply context menus with stable roles, icons and keyboard parity consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while context menus with stable roles, icons and keyboard parity is active.",
      "Verify context menus with stable roles, icons and keyboard parity with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV84-C1",
      "UIV84-C2",
      "UIV84-C3",
      "UIV84-C4"
    ]
  },
  {
    "version": 85,
    "program": "ui-overhaul",
    "theme": "Menus and overlays",
    "focus": "modal dialogs with focus trap, Escape and trigger restore",
    "rules": [
      "Introduce modal dialogs with focus trap, Escape and trigger restore through the shared design-token and component layer without changing existing behaviour.",
      "Apply modal dialogs with focus trap, Escape and trigger restore consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while modal dialogs with focus trap, Escape and trigger restore is active.",
      "Verify modal dialogs with focus trap, Escape and trigger restore with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV85-C1",
      "UIV85-C2",
      "UIV85-C3",
      "UIV85-C4"
    ]
  },
  {
    "version": 86,
    "program": "ui-overhaul",
    "theme": "Menus and overlays",
    "focus": "toasts and banners that announce status without stealing focus",
    "rules": [
      "Introduce toasts and banners that announce status without stealing focus through the shared design-token and component layer without changing existing behaviour.",
      "Apply toasts and banners that announce status without stealing focus consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while toasts and banners that announce status without stealing focus is active.",
      "Verify toasts and banners that announce status without stealing focus with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV86-C1",
      "UIV86-C2",
      "UIV86-C3",
      "UIV86-C4"
    ]
  },
  {
    "version": 87,
    "program": "ui-overhaul",
    "theme": "Search, history and bookmarks",
    "focus": "unified search entry with scoped results and clear empty states",
    "rules": [
      "Introduce unified search entry with scoped results and clear empty states through the shared design-token and component layer without changing existing behaviour.",
      "Apply unified search entry with scoped results and clear empty states consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while unified search entry with scoped results and clear empty states is active.",
      "Verify unified search entry with scoped results and clear empty states with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV87-C1",
      "UIV87-C2",
      "UIV87-C3",
      "UIV87-C4"
    ]
  },
  {
    "version": 88,
    "program": "ui-overhaul",
    "theme": "Search, history and bookmarks",
    "focus": "history grouping with deterministic ordering and restore",
    "rules": [
      "Introduce history grouping with deterministic ordering and restore through the shared design-token and component layer without changing existing behaviour.",
      "Apply history grouping with deterministic ordering and restore consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while history grouping with deterministic ordering and restore is active.",
      "Verify history grouping with deterministic ordering and restore with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV88-C1",
      "UIV88-C2",
      "UIV88-C3",
      "UIV88-C4"
    ]
  },
  {
    "version": 89,
    "program": "ui-overhaul",
    "theme": "Search, history and bookmarks",
    "focus": "bookmark add/edit states with inline validation",
    "rules": [
      "Introduce bookmark add/edit states with inline validation through the shared design-token and component layer without changing existing behaviour.",
      "Apply bookmark add/edit states with inline validation consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while bookmark add/edit states with inline validation is active.",
      "Verify bookmark add/edit states with inline validation with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV89-C1",
      "UIV89-C2",
      "UIV89-C3",
      "UIV89-C4"
    ]
  },
  {
    "version": 90,
    "program": "ui-overhaul",
    "theme": "Search, history and bookmarks",
    "focus": "top sites and recent work with privacy-aware labels",
    "rules": [
      "Introduce top sites and recent work with privacy-aware labels through the shared design-token and component layer without changing existing behaviour.",
      "Apply top sites and recent work with privacy-aware labels consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while top sites and recent work with privacy-aware labels is active.",
      "Verify top sites and recent work with privacy-aware labels with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV90-C1",
      "UIV90-C2",
      "UIV90-C3",
      "UIV90-C4"
    ]
  },
  {
    "version": 91,
    "program": "ui-overhaul",
    "theme": "Extensions and downloads",
    "focus": "extension buttons with loading, error and disabled states",
    "rules": [
      "Introduce extension buttons with loading, error and disabled states through the shared design-token and component layer without changing existing behaviour.",
      "Apply extension buttons with loading, error and disabled states consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while extension buttons with loading, error and disabled states is active.",
      "Verify extension buttons with loading, error and disabled states with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV91-C1",
      "UIV91-C2",
      "UIV91-C3",
      "UIV91-C4"
    ]
  },
  {
    "version": 92,
    "program": "ui-overhaul",
    "theme": "Extensions and downloads",
    "focus": "downloads list with progress, pause/cancel and open actions",
    "rules": [
      "Introduce downloads list with progress, pause/cancel and open actions through the shared design-token and component layer without changing existing behaviour.",
      "Apply downloads list with progress, pause/cancel and open actions consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while downloads list with progress, pause/cancel and open actions is active.",
      "Verify downloads list with progress, pause/cancel and open actions with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV92-C1",
      "UIV92-C2",
      "UIV92-C3",
      "UIV92-C4"
    ]
  },
  {
    "version": 93,
    "program": "ui-overhaul",
    "theme": "Extensions and downloads",
    "focus": "permission prompts that are specific and dismissible by keyboard",
    "rules": [
      "Introduce permission prompts that are specific and dismissible by keyboard through the shared design-token and component layer without changing existing behaviour.",
      "Apply permission prompts that are specific and dismissible by keyboard consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while permission prompts that are specific and dismissible by keyboard is active.",
      "Verify permission prompts that are specific and dismissible by keyboard with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV93-C1",
      "UIV93-C2",
      "UIV93-C3",
      "UIV93-C4"
    ]
  },
  {
    "version": 94,
    "program": "ui-overhaul",
    "theme": "Extensions and downloads",
    "focus": "extension management with consistent install/uninstall feedback",
    "rules": [
      "Introduce extension management with consistent install/uninstall feedback through the shared design-token and component layer without changing existing behaviour.",
      "Apply extension management with consistent install/uninstall feedback consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while extension management with consistent install/uninstall feedback is active.",
      "Verify extension management with consistent install/uninstall feedback with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV94-C1",
      "UIV94-C2",
      "UIV94-C3",
      "UIV94-C4"
    ]
  },
  {
    "version": 95,
    "program": "ui-overhaul",
    "theme": "Screenshot and inspector",
    "focus": "capture modes with visible region, delay and destination state",
    "rules": [
      "Introduce capture modes with visible region, delay and destination state through the shared design-token and component layer without changing existing behaviour.",
      "Apply capture modes with visible region, delay and destination state consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while capture modes with visible region, delay and destination state is active.",
      "Verify capture modes with visible region, delay and destination state with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV95-C1",
      "UIV95-C2",
      "UIV95-C3",
      "UIV95-C4"
    ]
  },
  {
    "version": 96,
    "program": "ui-overhaul",
    "theme": "Screenshot and inspector",
    "focus": "recording controls that are obvious, cancellable and accessible",
    "rules": [
      "Introduce recording controls that are obvious, cancellable and accessible through the shared design-token and component layer without changing existing behaviour.",
      "Apply recording controls that are obvious, cancellable and accessible consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while recording controls that are obvious, cancellable and accessible is active.",
      "Verify recording controls that are obvious, cancellable and accessible with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV96-C1",
      "UIV96-C2",
      "UIV96-C3",
      "UIV96-C4"
    ]
  },
  {
    "version": 97,
    "program": "ui-overhaul",
    "theme": "Screenshot and inspector",
    "focus": "inspector panes with readable DOM/CSS/console hierarchy",
    "rules": [
      "Introduce inspector panes with readable DOM/CSS/console hierarchy through the shared design-token and component layer without changing existing behaviour.",
      "Apply inspector panes with readable DOM/CSS/console hierarchy consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while inspector panes with readable DOM/CSS/console hierarchy is active.",
      "Verify inspector panes with readable DOM/CSS/console hierarchy with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV97-C1",
      "UIV97-C2",
      "UIV97-C3",
      "UIV97-C4"
    ]
  },
  {
    "version": 98,
    "program": "ui-overhaul",
    "theme": "Screenshot and inspector",
    "focus": "clipboard and save status that survive failure",
    "rules": [
      "Introduce clipboard and save status that survive failure through the shared design-token and component layer without changing existing behaviour.",
      "Apply clipboard and save status that survive failure consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while clipboard and save status that survive failure is active.",
      "Verify clipboard and save status that survive failure with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV98-C1",
      "UIV98-C2",
      "UIV98-C3",
      "UIV98-C4"
    ]
  },
  {
    "version": 99,
    "program": "ui-overhaul",
    "theme": "Accessibility",
    "focus": "visible focus rings on every interactive surface",
    "rules": [
      "Introduce visible focus rings on every interactive surface through the shared design-token and component layer without changing existing behaviour.",
      "Apply visible focus rings on every interactive surface consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while visible focus rings on every interactive surface is active.",
      "Verify visible focus rings on every interactive surface with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV99-C1",
      "UIV99-C2",
      "UIV99-C3",
      "UIV99-C4"
    ]
  },
  {
    "version": 100,
    "program": "ui-overhaul",
    "theme": "Accessibility",
    "focus": "accessible names for icon-only controls and status regions",
    "rules": [
      "Introduce accessible names for icon-only controls and status regions through the shared design-token and component layer without changing existing behaviour.",
      "Apply accessible names for icon-only controls and status regions consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while accessible names for icon-only controls and status regions is active.",
      "Verify accessible names for icon-only controls and status regions with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV100-C1",
      "UIV100-C2",
      "UIV100-C3",
      "UIV100-C4"
    ]
  },
  {
    "version": 101,
    "program": "ui-overhaul",
    "theme": "Accessibility",
    "focus": "contrast and target-size conformance in both themes",
    "rules": [
      "Introduce contrast and target-size conformance in both themes through the shared design-token and component layer without changing existing behaviour.",
      "Apply contrast and target-size conformance in both themes consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while contrast and target-size conformance in both themes is active.",
      "Verify contrast and target-size conformance in both themes with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV101-C1",
      "UIV101-C2",
      "UIV101-C3",
      "UIV101-C4"
    ]
  },
  {
    "version": 102,
    "program": "ui-overhaul",
    "theme": "Accessibility",
    "focus": "reduced-motion and high-contrast alternatives with no lost state",
    "rules": [
      "Introduce reduced-motion and high-contrast alternatives with no lost state through the shared design-token and component layer without changing existing behaviour.",
      "Apply reduced-motion and high-contrast alternatives with no lost state consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while reduced-motion and high-contrast alternatives with no lost state is active.",
      "Verify reduced-motion and high-contrast alternatives with no lost state with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV102-C1",
      "UIV102-C2",
      "UIV102-C3",
      "UIV102-C4"
    ]
  },
  {
    "version": 103,
    "program": "ui-overhaul",
    "theme": "Keyboard and power user",
    "focus": "a documented shortcut map with conflict-free bindings",
    "rules": [
      "Introduce a documented shortcut map with conflict-free bindings through the shared design-token and component layer without changing existing behaviour.",
      "Apply a documented shortcut map with conflict-free bindings consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while a documented shortcut map with conflict-free bindings is active.",
      "Verify a documented shortcut map with conflict-free bindings with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV103-C1",
      "UIV103-C2",
      "UIV103-C3",
      "UIV103-C4"
    ]
  },
  {
    "version": 104,
    "program": "ui-overhaul",
    "theme": "Keyboard and power user",
    "focus": "command palette entries for browser and AI actions",
    "rules": [
      "Introduce command palette entries for browser and AI actions through the shared design-token and component layer without changing existing behaviour.",
      "Apply command palette entries for browser and AI actions consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while command palette entries for browser and AI actions is active.",
      "Verify command palette entries for browser and AI actions with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV104-C1",
      "UIV104-C2",
      "UIV104-C3",
      "UIV104-C4"
    ]
  },
  {
    "version": 105,
    "program": "ui-overhaul",
    "theme": "Keyboard and power user",
    "focus": "focus memory when moving between chrome, page and sidebar",
    "rules": [
      "Introduce focus memory when moving between chrome, page and sidebar through the shared design-token and component layer without changing existing behaviour.",
      "Apply focus memory when moving between chrome, page and sidebar consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while focus memory when moving between chrome, page and sidebar is active.",
      "Verify focus memory when moving between chrome, page and sidebar with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV105-C1",
      "UIV105-C2",
      "UIV105-C3",
      "UIV105-C4"
    ]
  },
  {
    "version": 106,
    "program": "ui-overhaul",
    "theme": "Keyboard and power user",
    "focus": "Escape layering that closes one surface at a time",
    "rules": [
      "Introduce Escape layering that closes one surface at a time through the shared design-token and component layer without changing existing behaviour.",
      "Apply Escape layering that closes one surface at a time consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while Escape layering that closes one surface at a time is active.",
      "Verify Escape layering that closes one surface at a time with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV106-C1",
      "UIV106-C2",
      "UIV106-C3",
      "UIV106-C4"
    ]
  },
  {
    "version": 107,
    "program": "ui-overhaul",
    "theme": "Responsive and density",
    "focus": "compact, comfortable and spacious density presets",
    "rules": [
      "Introduce compact, comfortable and spacious density presets through the shared design-token and component layer without changing existing behaviour.",
      "Apply compact, comfortable and spacious density presets consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while compact, comfortable and spacious density presets is active.",
      "Verify compact, comfortable and spacious density presets with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV107-C1",
      "UIV107-C2",
      "UIV107-C3",
      "UIV107-C4"
    ]
  },
  {
    "version": 108,
    "program": "ui-overhaul",
    "theme": "Responsive and density",
    "focus": "narrow-window behaviour with no clipped or unreachable controls",
    "rules": [
      "Introduce narrow-window behaviour with no clipped or unreachable controls through the shared design-token and component layer without changing existing behaviour.",
      "Apply narrow-window behaviour with no clipped or unreachable controls consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while narrow-window behaviour with no clipped or unreachable controls is active.",
      "Verify narrow-window behaviour with no clipped or unreachable controls with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV108-C1",
      "UIV108-C2",
      "UIV108-C3",
      "UIV108-C4"
    ]
  },
  {
    "version": 109,
    "program": "ui-overhaul",
    "theme": "Responsive and density",
    "focus": "sidebar width states with keyboard resizing and persistence",
    "rules": [
      "Introduce sidebar width states with keyboard resizing and persistence through the shared design-token and component layer without changing existing behaviour.",
      "Apply sidebar width states with keyboard resizing and persistence consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while sidebar width states with keyboard resizing and persistence is active.",
      "Verify sidebar width states with keyboard resizing and persistence with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV109-C1",
      "UIV109-C2",
      "UIV109-C3",
      "UIV109-C4"
    ]
  },
  {
    "version": 110,
    "program": "ui-overhaul",
    "theme": "Responsive and density",
    "focus": "zoom and text scaling that preserve layout integrity",
    "rules": [
      "Introduce zoom and text scaling that preserve layout integrity through the shared design-token and component layer without changing existing behaviour.",
      "Apply zoom and text scaling that preserve layout integrity consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while zoom and text scaling that preserve layout integrity is active.",
      "Verify zoom and text scaling that preserve layout integrity with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV110-C1",
      "UIV110-C2",
      "UIV110-C3",
      "UIV110-C4"
    ]
  },
  {
    "version": 111,
    "program": "ui-overhaul",
    "theme": "Theme and personalisation",
    "focus": "light/dark/system themes with no flash of wrong theme",
    "rules": [
      "Introduce light/dark/system themes with no flash of wrong theme through the shared design-token and component layer without changing existing behaviour.",
      "Apply light/dark/system themes with no flash of wrong theme consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while light/dark/system themes with no flash of wrong theme is active.",
      "Verify light/dark/system themes with no flash of wrong theme with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV111-C1",
      "UIV111-C2",
      "UIV111-C3",
      "UIV111-C4"
    ]
  },
  {
    "version": 112,
    "program": "ui-overhaul",
    "theme": "Theme and personalisation",
    "focus": "accent colour application that respects contrast minimums",
    "rules": [
      "Introduce accent colour application that respects contrast minimums through the shared design-token and component layer without changing existing behaviour.",
      "Apply accent colour application that respects contrast minimums consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while accent colour application that respects contrast minimums is active.",
      "Verify accent colour application that respects contrast minimums with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV112-C1",
      "UIV112-C2",
      "UIV112-C3",
      "UIV112-C4"
    ]
  },
  {
    "version": 113,
    "program": "ui-overhaul",
    "theme": "Theme and personalisation",
    "focus": "wallpaper and page background states that stay quiet",
    "rules": [
      "Introduce wallpaper and page background states that stay quiet through the shared design-token and component layer without changing existing behaviour.",
      "Apply wallpaper and page background states that stay quiet consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while wallpaper and page background states that stay quiet is active.",
      "Verify wallpaper and page background states that stay quiet with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV113-C1",
      "UIV113-C2",
      "UIV113-C3",
      "UIV113-C4"
    ]
  },
  {
    "version": 114,
    "program": "ui-overhaul",
    "theme": "Theme and personalisation",
    "focus": "profile identity that is visible without dominating chrome",
    "rules": [
      "Introduce profile identity that is visible without dominating chrome through the shared design-token and component layer without changing existing behaviour.",
      "Apply profile identity that is visible without dominating chrome consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while profile identity that is visible without dominating chrome is active.",
      "Verify profile identity that is visible without dominating chrome with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV114-C1",
      "UIV114-C2",
      "UIV114-C3",
      "UIV114-C4"
    ]
  },
  {
    "version": 115,
    "program": "ui-overhaul",
    "theme": "Interface performance",
    "focus": "compositor-friendly animation limited to transform and opacity",
    "rules": [
      "Introduce compositor-friendly animation limited to transform and opacity through the shared design-token and component layer without changing existing behaviour.",
      "Apply compositor-friendly animation limited to transform and opacity consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while compositor-friendly animation limited to transform and opacity is active.",
      "Verify compositor-friendly animation limited to transform and opacity with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV115-C1",
      "UIV115-C2",
      "UIV115-C3",
      "UIV115-C4"
    ]
  },
  {
    "version": 116,
    "program": "ui-overhaul",
    "theme": "Interface performance",
    "focus": "deferred non-critical UI work outside first interaction",
    "rules": [
      "Introduce deferred non-critical UI work outside first interaction through the shared design-token and component layer without changing existing behaviour.",
      "Apply deferred non-critical UI work outside first interaction consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while deferred non-critical UI work outside first interaction is active.",
      "Verify deferred non-critical UI work outside first interaction with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV116-C1",
      "UIV116-C2",
      "UIV116-C3",
      "UIV116-C4"
    ]
  },
  {
    "version": 117,
    "program": "ui-overhaul",
    "theme": "Interface performance",
    "focus": "bounded DOM lists and virtualised long chat/task histories",
    "rules": [
      "Introduce bounded DOM lists and virtualised long chat/task histories through the shared design-token and component layer without changing existing behaviour.",
      "Apply bounded DOM lists and virtualised long chat/task histories consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while bounded DOM lists and virtualised long chat/task histories is active.",
      "Verify bounded DOM lists and virtualised long chat/task histories with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV117-C1",
      "UIV117-C2",
      "UIV117-C3",
      "UIV117-C4"
    ]
  },
  {
    "version": 118,
    "program": "ui-overhaul",
    "theme": "Interface performance",
    "focus": "idle UI that performs no polling or layout work",
    "rules": [
      "Introduce idle UI that performs no polling or layout work through the shared design-token and component layer without changing existing behaviour.",
      "Apply idle UI that performs no polling or layout work consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while idle UI that performs no polling or layout work is active.",
      "Verify idle UI that performs no polling or layout work with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV118-C1",
      "UIV118-C2",
      "UIV118-C3",
      "UIV118-C4"
    ]
  },
  {
    "version": 119,
    "program": "ui-overhaul",
    "theme": "Reliability",
    "focus": "deterministic error states with retry and recovery actions",
    "rules": [
      "Introduce deterministic error states with retry and recovery actions through the shared design-token and component layer without changing existing behaviour.",
      "Apply deterministic error states with retry and recovery actions consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while deterministic error states with retry and recovery actions is active.",
      "Verify deterministic error states with retry and recovery actions with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV119-C1",
      "UIV119-C2",
      "UIV119-C3",
      "UIV119-C4"
    ]
  },
  {
    "version": 120,
    "program": "ui-overhaul",
    "theme": "Reliability",
    "focus": "stale update guards for chat, preview and settings patches",
    "rules": [
      "Introduce stale update guards for chat, preview and settings patches through the shared design-token and component layer without changing existing behaviour.",
      "Apply stale update guards for chat, preview and settings patches consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while stale update guards for chat, preview and settings patches is active.",
      "Verify stale update guards for chat, preview and settings patches with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV120-C1",
      "UIV120-C2",
      "UIV120-C3",
      "UIV120-C4"
    ]
  },
  {
    "version": 121,
    "program": "ui-overhaul",
    "theme": "Reliability",
    "focus": "safe persistence with corrupt-state recovery",
    "rules": [
      "Introduce safe persistence with corrupt-state recovery through the shared design-token and component layer without changing existing behaviour.",
      "Apply safe persistence with corrupt-state recovery consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while safe persistence with corrupt-state recovery is active.",
      "Verify safe persistence with corrupt-state recovery with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV121-C1",
      "UIV121-C2",
      "UIV121-C3",
      "UIV121-C4"
    ]
  },
  {
    "version": 122,
    "program": "ui-overhaul",
    "theme": "Reliability",
    "focus": "crash-safe teardown and reconnection for background work",
    "rules": [
      "Introduce crash-safe teardown and reconnection for background work through the shared design-token and component layer without changing existing behaviour.",
      "Apply crash-safe teardown and reconnection for background work consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while crash-safe teardown and reconnection for background work is active.",
      "Verify crash-safe teardown and reconnection for background work with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV122-C1",
      "UIV122-C2",
      "UIV122-C3",
      "UIV122-C4"
    ]
  },
  {
    "version": 123,
    "program": "ui-overhaul",
    "theme": "Installer and first run",
    "focus": "a custom installer surface consistent with the product identity",
    "rules": [
      "Introduce a custom installer surface consistent with the product identity through the shared design-token and component layer without changing existing behaviour.",
      "Apply a custom installer surface consistent with the product identity consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while a custom installer surface consistent with the product identity is active.",
      "Verify a custom installer surface consistent with the product identity with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV123-C1",
      "UIV123-C2",
      "UIV123-C3",
      "UIV123-C4"
    ]
  },
  {
    "version": 124,
    "program": "ui-overhaul",
    "theme": "Installer and first run",
    "focus": "first-run setup that explains AI, privacy and defaults briefly",
    "rules": [
      "Introduce first-run setup that explains AI, privacy and defaults briefly through the shared design-token and component layer without changing existing behaviour.",
      "Apply first-run setup that explains AI, privacy and defaults briefly consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while first-run setup that explains AI, privacy and defaults briefly is active.",
      "Verify first-run setup that explains AI, privacy and defaults briefly with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV124-C1",
      "UIV124-C2",
      "UIV124-C3",
      "UIV124-C4"
    ]
  },
  {
    "version": 125,
    "program": "ui-overhaul",
    "theme": "Installer and first run",
    "focus": "welcome content that is useful and dismissible in one action",
    "rules": [
      "Introduce welcome content that is useful and dismissible in one action through the shared design-token and component layer without changing existing behaviour.",
      "Apply welcome content that is useful and dismissible in one action consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while welcome content that is useful and dismissible in one action is active.",
      "Verify welcome content that is useful and dismissible in one action with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV125-C1",
      "UIV125-C2",
      "UIV125-C3",
      "UIV125-C4"
    ]
  },
  {
    "version": 126,
    "program": "ui-overhaul",
    "theme": "Installer and first run",
    "focus": "update and uninstall feedback that never blocks the browser",
    "rules": [
      "Introduce update and uninstall feedback that never blocks the browser through the shared design-token and component layer without changing existing behaviour.",
      "Apply update and uninstall feedback that never blocks the browser consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while update and uninstall feedback that never blocks the browser is active.",
      "Verify update and uninstall feedback that never blocks the browser with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV126-C1",
      "UIV126-C2",
      "UIV126-C3",
      "UIV126-C4"
    ]
  },
  {
    "version": 127,
    "program": "ui-overhaul",
    "theme": "Final UI release gate",
    "focus": "a full visual regression pass across all major surfaces",
    "rules": [
      "Introduce a full visual regression pass across all major surfaces through the shared design-token and component layer without changing existing behaviour.",
      "Apply a full visual regression pass across all major surfaces consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while a full visual regression pass across all major surfaces is active.",
      "Verify a full visual regression pass across all major surfaces with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV127-C1",
      "UIV127-C2",
      "UIV127-C3",
      "UIV127-C4"
    ]
  },
  {
    "version": 128,
    "program": "ui-overhaul",
    "theme": "Final UI release gate",
    "focus": "a full keyboard and screen-reader pass with no dead controls",
    "rules": [
      "Introduce a full keyboard and screen-reader pass with no dead controls through the shared design-token and component layer without changing existing behaviour.",
      "Apply a full keyboard and screen-reader pass with no dead controls consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while a full keyboard and screen-reader pass with no dead controls is active.",
      "Verify a full keyboard and screen-reader pass with no dead controls with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV128-C1",
      "UIV128-C2",
      "UIV128-C3",
      "UIV128-C4"
    ]
  },
  {
    "version": 129,
    "program": "ui-overhaul",
    "theme": "Final UI release gate",
    "focus": "a full performance pass against the idle and active budgets",
    "rules": [
      "Introduce a full performance pass against the idle and active budgets through the shared design-token and component layer without changing existing behaviour.",
      "Apply a full performance pass against the idle and active budgets consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while a full performance pass against the idle and active budgets is active.",
      "Verify a full performance pass against the idle and active budgets with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV129-C1",
      "UIV129-C2",
      "UIV129-C3",
      "UIV129-C4"
    ]
  },
  {
    "version": 130,
    "program": "ui-overhaul",
    "theme": "Final UI release gate",
    "focus": "a final installed-app pass proving the overhaul shipped",
    "rules": [
      "Introduce a final installed-app pass proving the overhaul shipped through the shared design-token and component layer without changing existing behaviour.",
      "Apply a final installed-app pass proving the overhaul shipped consistently across browser chrome, AI sidebar, settings and artifact surfaces with no runtime network resources.",
      "Preserve keyboard operation, visible focus, reduced-motion and high-contrast behaviour while a final installed-app pass proving the overhaul shipped is active.",
      "Verify a final installed-app pass proving the overhaul shipped with a user-visible Playwright scenario, including the four check IDs and a recorded pass marker."
    ],
    "checks": [
      "UIV130-C1",
      "UIV130-C2",
      "UIV130-C3",
      "UIV130-C4"
    ]
  }
];

const DEBLOAT_VERSION_SPEC = [
  {
    "version": 131,
    "program": "debloat",
    "theme": "Process topology",
    "focus": "baseline process count and working set",
    "rules": [
      "Measure baseline process count and working set against the recorded baseline before changing it.",
      "Apply baseline process count and working set without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep baseline process count and working set bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for baseline process count and working set and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV131-C1",
      "DV131-C2",
      "DV131-C3",
      "DV131-C4"
    ]
  },
  {
    "version": 132,
    "program": "debloat",
    "theme": "Process topology",
    "focus": "background renderer reuse",
    "rules": [
      "Measure background renderer reuse against the recorded baseline before changing it.",
      "Apply background renderer reuse without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep background renderer reuse bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for background renderer reuse and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV132-C1",
      "DV132-C2",
      "DV132-C3",
      "DV132-C4"
    ]
  },
  {
    "version": 133,
    "program": "debloat",
    "theme": "Process topology",
    "focus": "utility process minimisation",
    "rules": [
      "Measure utility process minimisation against the recorded baseline before changing it.",
      "Apply utility process minimisation without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep utility process minimisation bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for utility process minimisation and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV133-C1",
      "DV133-C2",
      "DV133-C3",
      "DV133-C4"
    ]
  },
  {
    "version": 134,
    "program": "debloat",
    "theme": "Process topology",
    "focus": "windowless helper elimination",
    "rules": [
      "Measure windowless helper elimination against the recorded baseline before changing it.",
      "Apply windowless helper elimination without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep windowless helper elimination bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for windowless helper elimination and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV134-C1",
      "DV134-C2",
      "DV134-C3",
      "DV134-C4"
    ]
  },
  {
    "version": 135,
    "program": "debloat",
    "theme": "Startup deferral",
    "focus": "lazy source-spec loading",
    "rules": [
      "Measure lazy source-spec loading against the recorded baseline before changing it.",
      "Apply lazy source-spec loading without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep lazy source-spec loading bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for lazy source-spec loading and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV135-C1",
      "DV135-C2",
      "DV135-C3",
      "DV135-C4"
    ]
  },
  {
    "version": 136,
    "program": "debloat",
    "theme": "Startup deferral",
    "focus": "deferred provider catalogue refresh",
    "rules": [
      "Measure deferred provider catalogue refresh against the recorded baseline before changing it.",
      "Apply deferred provider catalogue refresh without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep deferred provider catalogue refresh bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for deferred provider catalogue refresh and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV136-C1",
      "DV136-C2",
      "DV136-C3",
      "DV136-C4"
    ]
  },
  {
    "version": 137,
    "program": "debloat",
    "theme": "Startup deferral",
    "focus": "delayed settings hydration",
    "rules": [
      "Measure delayed settings hydration against the recorded baseline before changing it.",
      "Apply delayed settings hydration without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep delayed settings hydration bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for delayed settings hydration and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV137-C1",
      "DV137-C2",
      "DV137-C3",
      "DV137-C4"
    ]
  },
  {
    "version": 138,
    "program": "debloat",
    "theme": "Startup deferral",
    "focus": "on-demand artifact renderer loading",
    "rules": [
      "Measure on-demand artifact renderer loading against the recorded baseline before changing it.",
      "Apply on-demand artifact renderer loading without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep on-demand artifact renderer loading bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for on-demand artifact renderer loading and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV138-C1",
      "DV138-C2",
      "DV138-C3",
      "DV138-C4"
    ]
  },
  {
    "version": 139,
    "program": "debloat",
    "theme": "Renderer scheduling",
    "focus": "idle callback batching",
    "rules": [
      "Measure idle callback batching against the recorded baseline before changing it.",
      "Apply idle callback batching without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep idle callback batching bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for idle callback batching and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV139-C1",
      "DV139-C2",
      "DV139-C3",
      "DV139-C4"
    ]
  },
  {
    "version": 140,
    "program": "debloat",
    "theme": "Renderer scheduling",
    "focus": "passive event listeners",
    "rules": [
      "Measure passive event listeners against the recorded baseline before changing it.",
      "Apply passive event listeners without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep passive event listeners bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for passive event listeners and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV140-C1",
      "DV140-C2",
      "DV140-C3",
      "DV140-C4"
    ]
  },
  {
    "version": 141,
    "program": "debloat",
    "theme": "Renderer scheduling",
    "focus": "reduced timer cardinality",
    "rules": [
      "Measure reduced timer cardinality against the recorded baseline before changing it.",
      "Apply reduced timer cardinality without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep reduced timer cardinality bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for reduced timer cardinality and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV141-C1",
      "DV141-C2",
      "DV141-C3",
      "DV141-C4"
    ]
  },
  {
    "version": 142,
    "program": "debloat",
    "theme": "Renderer scheduling",
    "focus": "occluded renderer throttling",
    "rules": [
      "Measure occluded renderer throttling against the recorded baseline before changing it.",
      "Apply occluded renderer throttling without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep occluded renderer throttling bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for occluded renderer throttling and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV142-C1",
      "DV142-C2",
      "DV142-C3",
      "DV142-C4"
    ]
  },
  {
    "version": 143,
    "program": "debloat",
    "theme": "Memory bounds",
    "focus": "site registry budget reduction",
    "rules": [
      "Measure site registry budget reduction against the recorded baseline before changing it.",
      "Apply site registry budget reduction without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep site registry budget reduction bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for site registry budget reduction and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV143-C1",
      "DV143-C2",
      "DV143-C3",
      "DV143-C4"
    ]
  },
  {
    "version": 144,
    "program": "debloat",
    "theme": "Memory bounds",
    "focus": "diagnostic cache bound",
    "rules": [
      "Measure diagnostic cache bound against the recorded baseline before changing it.",
      "Apply diagnostic cache bound without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep diagnostic cache bound bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for diagnostic cache bound and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV144-C1",
      "DV144-C2",
      "DV144-C3",
      "DV144-C4"
    ]
  },
  {
    "version": 145,
    "program": "debloat",
    "theme": "Memory bounds",
    "focus": "chat history window cap",
    "rules": [
      "Measure chat history window cap against the recorded baseline before changing it.",
      "Apply chat history window cap without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep chat history window cap bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for chat history window cap and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV145-C1",
      "DV145-C2",
      "DV145-C3",
      "DV145-C4"
    ]
  },
  {
    "version": 146,
    "program": "debloat",
    "theme": "Memory bounds",
    "focus": "image payload cap",
    "rules": [
      "Measure image payload cap against the recorded baseline before changing it.",
      "Apply image payload cap without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep image payload cap bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for image payload cap and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV146-C1",
      "DV146-C2",
      "DV146-C3",
      "DV146-C4"
    ]
  },
  {
    "version": 147,
    "program": "debloat",
    "theme": "GPU and compositor",
    "focus": "GPU raster watchdog settings",
    "rules": [
      "Measure GPU raster watchdog settings against the recorded baseline before changing it.",
      "Apply GPU raster watchdog settings without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep GPU raster watchdog settings bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for GPU raster watchdog settings and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV147-C1",
      "DV147-C2",
      "DV147-C3",
      "DV147-C4"
    ]
  },
  {
    "version": 148,
    "program": "debloat",
    "theme": "GPU and compositor",
    "focus": "transform-only motion",
    "rules": [
      "Measure transform-only motion against the recorded baseline before changing it.",
      "Apply transform-only motion without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep transform-only motion bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for transform-only motion and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV148-C1",
      "DV148-C2",
      "DV148-C3",
      "DV148-C4"
    ]
  },
  {
    "version": 149,
    "program": "debloat",
    "theme": "GPU and compositor",
    "focus": "shadow and blur reduction",
    "rules": [
      "Measure shadow and blur reduction against the recorded baseline before changing it.",
      "Apply shadow and blur reduction without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep shadow and blur reduction bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for shadow and blur reduction and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV149-C1",
      "DV149-C2",
      "DV149-C3",
      "DV149-C4"
    ]
  },
  {
    "version": 150,
    "program": "debloat",
    "theme": "GPU and compositor",
    "focus": "layer count minimisation",
    "rules": [
      "Measure layer count minimisation against the recorded baseline before changing it.",
      "Apply layer count minimisation without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep layer count minimisation bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for layer count minimisation and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV150-C1",
      "DV150-C2",
      "DV150-C3",
      "DV150-C4"
    ]
  },
  {
    "version": 151,
    "program": "debloat",
    "theme": "Network idle",
    "focus": "prewarm suppression when idle",
    "rules": [
      "Measure prewarm suppression when idle against the recorded baseline before changing it.",
      "Apply prewarm suppression when idle without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep prewarm suppression when idle bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for prewarm suppression when idle and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV151-C1",
      "DV151-C2",
      "DV151-C3",
      "DV151-C4"
    ]
  },
  {
    "version": 152,
    "program": "debloat",
    "theme": "Network idle",
    "focus": "connection pool reuse",
    "rules": [
      "Measure connection pool reuse against the recorded baseline before changing it.",
      "Apply connection pool reuse without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep connection pool reuse bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for connection pool reuse and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV152-C1",
      "DV152-C2",
      "DV152-C3",
      "DV152-C4"
    ]
  },
  {
    "version": 153,
    "program": "debloat",
    "theme": "Network idle",
    "focus": "search cache ttl",
    "rules": [
      "Measure search cache ttl against the recorded baseline before changing it.",
      "Apply search cache ttl without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep search cache ttl bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for search cache ttl and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV153-C1",
      "DV153-C2",
      "DV153-C3",
      "DV153-C4"
    ]
  },
  {
    "version": 154,
    "program": "debloat",
    "theme": "Network idle",
    "focus": "offline-first internal pages",
    "rules": [
      "Measure offline-first internal pages against the recorded baseline before changing it.",
      "Apply offline-first internal pages without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep offline-first internal pages bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for offline-first internal pages and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV154-C1",
      "DV154-C2",
      "DV154-C3",
      "DV154-C4"
    ]
  },
  {
    "version": 155,
    "program": "debloat",
    "theme": "AI transport",
    "focus": "stream chunk coalescing",
    "rules": [
      "Measure stream chunk coalescing against the recorded baseline before changing it.",
      "Apply stream chunk coalescing without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep stream chunk coalescing bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for stream chunk coalescing and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV155-C1",
      "DV155-C2",
      "DV155-C3",
      "DV155-C4"
    ]
  },
  {
    "version": 156,
    "program": "debloat",
    "theme": "AI transport",
    "focus": "bounded retry backoff",
    "rules": [
      "Measure bounded retry backoff against the recorded baseline before changing it.",
      "Apply bounded retry backoff without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep bounded retry backoff bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for bounded retry backoff and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV156-C1",
      "DV156-C2",
      "DV156-C3",
      "DV156-C4"
    ]
  },
  {
    "version": 157,
    "program": "debloat",
    "theme": "AI transport",
    "focus": "context pruning",
    "rules": [
      "Measure context pruning against the recorded baseline before changing it.",
      "Apply context pruning without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep context pruning bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for context pruning and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV157-C1",
      "DV157-C2",
      "DV157-C3",
      "DV157-C4"
    ]
  },
  {
    "version": 158,
    "program": "debloat",
    "theme": "AI transport",
    "focus": "memory extraction scheduling",
    "rules": [
      "Measure memory extraction scheduling against the recorded baseline before changing it.",
      "Apply memory extraction scheduling without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep memory extraction scheduling bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for memory extraction scheduling and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV158-C1",
      "DV158-C2",
      "DV158-C3",
      "DV158-C4"
    ]
  },
  {
    "version": 159,
    "program": "debloat",
    "theme": "Artifact registry",
    "focus": "preview host eviction",
    "rules": [
      "Measure preview host eviction against the recorded baseline before changing it.",
      "Apply preview host eviction without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep preview host eviction bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for preview host eviction and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV159-C1",
      "DV159-C2",
      "DV159-C3",
      "DV159-C4"
    ]
  },
  {
    "version": 160,
    "program": "debloat",
    "theme": "Artifact registry",
    "focus": "single-file output budget",
    "rules": [
      "Measure single-file output budget against the recorded baseline before changing it.",
      "Apply single-file output budget without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep single-file output budget bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for single-file output budget and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV160-C1",
      "DV160-C2",
      "DV160-C3",
      "DV160-C4"
    ]
  },
  {
    "version": 161,
    "program": "debloat",
    "theme": "Artifact registry",
    "focus": "report block cap",
    "rules": [
      "Measure report block cap against the recorded baseline before changing it.",
      "Apply report block cap without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep report block cap bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for report block cap and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV161-C1",
      "DV161-C2",
      "DV161-C3",
      "DV161-C4"
    ]
  },
  {
    "version": 162,
    "program": "debloat",
    "theme": "Artifact registry",
    "focus": "stale artifact disposal",
    "rules": [
      "Measure stale artifact disposal against the recorded baseline before changing it.",
      "Apply stale artifact disposal without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep stale artifact disposal bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for stale artifact disposal and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV162-C1",
      "DV162-C2",
      "DV162-C3",
      "DV162-C4"
    ]
  },
  {
    "version": 163,
    "program": "debloat",
    "theme": "DOM and CSS",
    "focus": "selector simplification",
    "rules": [
      "Measure selector simplification against the recorded baseline before changing it.",
      "Apply selector simplification without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep selector simplification bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for selector simplification and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV163-C1",
      "DV163-C2",
      "DV163-C3",
      "DV163-C4"
    ]
  },
  {
    "version": 164,
    "program": "debloat",
    "theme": "DOM and CSS",
    "focus": "stylesheet split deferral",
    "rules": [
      "Measure stylesheet split deferral against the recorded baseline before changing it.",
      "Apply stylesheet split deferral without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep stylesheet split deferral bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for stylesheet split deferral and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV164-C1",
      "DV164-C2",
      "DV164-C3",
      "DV164-C4"
    ]
  },
  {
    "version": 165,
    "program": "debloat",
    "theme": "DOM and CSS",
    "focus": "list virtualisation",
    "rules": [
      "Measure list virtualisation against the recorded baseline before changing it.",
      "Apply list virtualisation without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep list virtualisation bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for list virtualisation and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV165-C1",
      "DV165-C2",
      "DV165-C3",
      "DV165-C4"
    ]
  },
  {
    "version": 166,
    "program": "debloat",
    "theme": "DOM and CSS",
    "focus": "layout thrash removal",
    "rules": [
      "Measure layout thrash removal against the recorded baseline before changing it.",
      "Apply layout thrash removal without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep layout thrash removal bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for layout thrash removal and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV166-C1",
      "DV166-C2",
      "DV166-C3",
      "DV166-C4"
    ]
  },
  {
    "version": 167,
    "program": "debloat",
    "theme": "Timers and animation",
    "focus": "sweep interval tuning",
    "rules": [
      "Measure sweep interval tuning against the recorded baseline before changing it.",
      "Apply sweep interval tuning without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep sweep interval tuning bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for sweep interval tuning and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV167-C1",
      "DV167-C2",
      "DV167-C3",
      "DV167-C4"
    ]
  },
  {
    "version": 168,
    "program": "debloat",
    "theme": "Timers and animation",
    "focus": "timer deduplication",
    "rules": [
      "Measure timer deduplication against the recorded baseline before changing it.",
      "Apply timer deduplication without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep timer deduplication bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for timer deduplication and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV168-C1",
      "DV168-C2",
      "DV168-C3",
      "DV168-C4"
    ]
  },
  {
    "version": 169,
    "program": "debloat",
    "theme": "Timers and animation",
    "focus": "reduced-motion fast path",
    "rules": [
      "Measure reduced-motion fast path against the recorded baseline before changing it.",
      "Apply reduced-motion fast path without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep reduced-motion fast path bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for reduced-motion fast path and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV169-C1",
      "DV169-C2",
      "DV169-C3",
      "DV169-C4"
    ]
  },
  {
    "version": 170,
    "program": "debloat",
    "theme": "Timers and animation",
    "focus": "visibility-aware animation pause",
    "rules": [
      "Measure visibility-aware animation pause against the recorded baseline before changing it.",
      "Apply visibility-aware animation pause without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep visibility-aware animation pause bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for visibility-aware animation pause and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV170-C1",
      "DV170-C2",
      "DV170-C3",
      "DV170-C4"
    ]
  },
  {
    "version": 171,
    "program": "debloat",
    "theme": "Storage and I/O",
    "focus": "batched writes",
    "rules": [
      "Measure batched writes against the recorded baseline before changing it.",
      "Apply batched writes without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep batched writes bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for batched writes and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV171-C1",
      "DV171-C2",
      "DV171-C3",
      "DV171-C4"
    ]
  },
  {
    "version": 172,
    "program": "debloat",
    "theme": "Storage and I/O",
    "focus": "atomic profile save debounce",
    "rules": [
      "Measure atomic profile save debounce against the recorded baseline before changing it.",
      "Apply atomic profile save debounce without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep atomic profile save debounce bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for atomic profile save debounce and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV172-C1",
      "DV172-C2",
      "DV172-C3",
      "DV172-C4"
    ]
  },
  {
    "version": 173,
    "program": "debloat",
    "theme": "Storage and I/O",
    "focus": "history index compaction",
    "rules": [
      "Measure history index compaction against the recorded baseline before changing it.",
      "Apply history index compaction without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep history index compaction bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for history index compaction and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV173-C1",
      "DV173-C2",
      "DV173-C3",
      "DV173-C4"
    ]
  },
  {
    "version": 174,
    "program": "debloat",
    "theme": "Storage and I/O",
    "focus": "log volume cap",
    "rules": [
      "Measure log volume cap against the recorded baseline before changing it.",
      "Apply log volume cap without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep log volume cap bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for log volume cap and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV174-C1",
      "DV174-C2",
      "DV174-C3",
      "DV174-C4"
    ]
  },
  {
    "version": 175,
    "program": "debloat",
    "theme": "Installer and runtime",
    "focus": "package asset deduplication",
    "rules": [
      "Measure package asset deduplication against the recorded baseline before changing it.",
      "Apply package asset deduplication without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep package asset deduplication bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for package asset deduplication and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV175-C1",
      "DV175-C2",
      "DV175-C3",
      "DV175-C4"
    ]
  },
  {
    "version": 176,
    "program": "debloat",
    "theme": "Installer and runtime",
    "focus": "unused dependency removal",
    "rules": [
      "Measure unused dependency removal against the recorded baseline before changing it.",
      "Apply unused dependency removal without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep unused dependency removal bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for unused dependency removal and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV176-C1",
      "DV176-C2",
      "DV176-C3",
      "DV176-C4"
    ]
  },
  {
    "version": 177,
    "program": "debloat",
    "theme": "Installer and runtime",
    "focus": "smaller install payload",
    "rules": [
      "Measure smaller install payload against the recorded baseline before changing it.",
      "Apply smaller install payload without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep smaller install payload bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for smaller install payload and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV177-C1",
      "DV177-C2",
      "DV177-C3",
      "DV177-C4"
    ]
  },
  {
    "version": 178,
    "program": "debloat",
    "theme": "Installer and runtime",
    "focus": "startup switch audit",
    "rules": [
      "Measure startup switch audit against the recorded baseline before changing it.",
      "Apply startup switch audit without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep startup switch audit bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for startup switch audit and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV178-C1",
      "DV178-C2",
      "DV178-C3",
      "DV178-C4"
    ]
  },
  {
    "version": 179,
    "program": "debloat",
    "theme": "Final resource gate",
    "focus": "50% CPU and RAM reduction proof",
    "rules": [
      "Measure 50% CPU and RAM reduction proof against the recorded baseline before changing it.",
      "Apply 50% CPU and RAM reduction proof without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep 50% CPU and RAM reduction proof bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for 50% CPU and RAM reduction proof and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV179-C1",
      "DV179-C2",
      "DV179-C3",
      "DV179-C4"
    ]
  },
  {
    "version": 180,
    "program": "debloat",
    "theme": "Final resource gate",
    "focus": "50% GPU and power-proxy reduction proof with functional regression gate",
    "rules": [
      "Measure 50% GPU and power-proxy reduction proof with functional regression gate against the recorded baseline before changing it.",
      "Apply 50% GPU and power-proxy reduction proof with functional regression gate without removing a user-visible control or weakening an existing offline/privacy contract.",
      "Keep 50% GPU and power-proxy reduction proof with functional regression gate bounded and reversible through a named runtime budget, flag or pure helper that can be unit-tested.",
      "Verify the resource delta for 50% GPU and power-proxy reduction proof with functional regression gate and rerun the full functional smoke after the change."
    ],
    "checks": [
      "DV180-C1",
      "DV180-C2",
      "DV180-C3",
      "DV180-C4"
    ]
  }
];

function validateNextGenSpec() {
  const errors = [];
  const all = [...UI_VERSION_SPEC, ...DEBLOAT_VERSION_SPEC];
  const ids = new Set();
  all.forEach((entry, index) => {
    const expected = index < UI_VERSION_SPEC.length ? UI_FIRST_VERSION + index : DEBLOAT_FIRST_VERSION + (index - UI_VERSION_SPEC.length);
    if (entry.version !== expected) errors.push('V' + entry.version + ': expected V' + expected);
    if (!Array.isArray(entry.rules) || entry.rules.length !== 4 || entry.rules.some((r) => typeof r !== 'string' || !r.trim())) errors.push('V' + entry.version + ': expected four non-empty rules');
    if (!Array.isArray(entry.checks) || entry.checks.length !== 4) errors.push('V' + entry.version + ': expected four check IDs');
    entry.checks.forEach((id, i) => {
      const want = (entry.version >= 131 ? 'DV' : 'UIV') + entry.version + '-C' + (i + 1);
      if (id !== want) errors.push('V' + entry.version + ': expected ' + want + ', got ' + id);
      if (ids.has(id)) errors.push('duplicate check ID ' + id);
      ids.add(id);
    });
  });
  if (UI_VERSION_SPEC.length !== 80) errors.push('UI ladder must contain 80 tiers');
  if (DEBLOAT_VERSION_SPEC.length !== 50) errors.push('Debloat ladder must contain 50 tiers');
  return { ok: errors.length === 0, errors };
}

module.exports = {
  UI_FIRST_VERSION, UI_LAST_VERSION, DEBLOAT_FIRST_VERSION, DEBLOAT_LAST_VERSION,
  UI_VERSION_SPEC, DEBLOAT_VERSION_SPEC,
  validateNextGenSpec, validate: validateNextGenSpec,
  uiEntry: (version) => UI_VERSION_SPEC.find((e) => e.version === version) || null,
  debloatEntry: (version) => DEBLOAT_VERSION_SPEC.find((e) => e.version === version) || null,
};
