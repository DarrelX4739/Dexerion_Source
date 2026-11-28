# DESIGN_SYSTEM.md
## Dexerion — Product Design Standards & Visual Intelligence

**Design philosophy:** Intentional simplicity, functional elegance and exceptional attention to detail.

**Product category:** Premium desktop web browser.

**Brand accent:** SC Teal — #1F6F6B.

**Primary appearance:** Dark-first, monochromatic, minimalist.

**Design references:** Dia, Arc, Zen, Safari, Linear and native desktop applications.

---

## 1. Design mandate

Approach every interface as a senior product designer with expertise in desktop applications, browser interaction design, visual systems and human-computer interaction.

Dexerion must not resemble a generic AI-generated website, SaaS dashboard, template application or experimental coding project.

It should feel like a mature commercial product designed by a dedicated professional design team.

The interface should communicate quality through:

- Exceptional alignment.
- Thoughtful proportions.
- Consistent geometry.
- Restrained visual styling.
- Carefully considered typography.
- Intelligent use of negative space.
- Clear interaction hierarchy.
- Responsive, natural interactions.
- Cohesion across the entire application.

Professional design is not achieved by adding more decoration. It is achieved by making better decisions about every visible element.

## 2. Design references and interpretation

### Dia — Calm intelligence

Study Dia for:

- Natural integration of AI into browsing.
- Approachable interaction design.
- Restrained interface complexity.
- Contextual controls.
- Thoughtful colour customization.
- Clear visual hierarchy.
- Interfaces that feel personal without becoming cluttered.

Apply the principles, not a direct copy of its interface.

### Arc — Product personality

Study Arc for:

- Distinctive product identity.
- Spatial organization.
- Sidebar composition.
- Workspace organization.
- Tab hierarchy.
- Intentional motion.
- Thoughtful transitions between browsing states.

Avoid introducing unnecessary learning curves or hiding essential controls.

### Zen — Immersive browsing

Study Zen for:

- Compact browser chrome.
- Elegant vertical tabs.
- Efficient use of screen space.
- Immersive content presentation.
- Sidebar geometry.
- Visual separation between browser controls and web content.

Preserve accessibility and discoverability when adapting these principles.

### Safari — Restraint and maturity

Study Safari for:

- Quiet browser chrome.
- Consistent control geometry.
- Native-feeling interactions.
- Visual balance.
- Predictable navigation.
- Long-term design consistency.

### Linear — Precision and craftsmanship

Study Linear for:

- Exceptional spacing consistency.
- Typography hierarchy.
- Compact information density.
- Professional iconography.
- Subtle interaction states.
- Refined dark surfaces.
- Visual clarity without excessive decoration.

Linear is a craftsmanship reference, not a browser layout reference.

## 3. Non-negotiable brand identity

Preserve:

- The original Dexerion logo.
- Existing brand recognition.
- SC Teal (#1F6F6B).
- The original typography unless explicitly authorized otherwise.
- The black-and-white visual foundation.
- Existing theme and customization functionality.

SC Teal should be used deliberately, primarily for meaningful interaction states and brand recognition.

Do not flood the interface with teal.

Dark mode must be the primary design and review environment. Existing alternative themes must remain functional.

Dexerion must have its own recognizable identity rather than becoming a clone of Arc, Zen or Dia.

## 4. Prohibited generic AI aesthetics

Treat the following as design warning signs:

- Excessive pill-shaped controls.
- Every element placed inside a rounded card.
- Cards nested inside other cards.
- Random gradients.
- Purple or blue AI-themed gradients.
- Glowing borders.
- Decorative neon lines.
- Unnecessary glassmorphism.
- Oversized headings.
- Excessively large buttons.
- Huge empty margins without purpose.
- Arbitrary corner radii.
- Excessive shadows.
- Generic dashboard layouts.
- Decorative badges.
- Unnecessary section labels.
- Emoji used as application icons.
- Random accent colours.
- Inconsistent icon families.
- Unnecessary marketing copy.
- Gratuitous animations.
- Excessive floating panels.
- Repeated visual separators.
- Fake depth and unnecessary elevation.
- Identical visual treatment for every control.

These techniques are not universally forbidden, but their use requires a clear functional justification.

Never introduce visual complexity merely to make a redesign appear more substantial.

## 5. Browser-first design

Dexerion is a browser, not a website.

The user's primary focus is the content they are browsing.

Browser chrome must support that content without competing with it.

Prioritize:

1. Web content.
2. Navigation.
3. Tab management.
4. Contextual actions.
5. Secondary tools.
6. Decorative elements, only where justified.

Browser controls should feel compact, stable and immediately recognizable.

Avoid turning the browser into a collection of dashboards.

Do not waste vertical space that could be used to display websites or additional tabs.

Do not hide essential controls merely to achieve a cleaner screenshot.

## 6. Geometry and spacing system

Use a deliberate spacing system instead of arbitrary pixel values.

Recommended foundational spacing scale:

- 2px — fine optical adjustments.
- 4px — tightly related elements.
- 8px — standard compact spacing.
- 12px — component separation.
- 16px — comfortable internal spacing.
- 24px — section separation.
- 32px — major layout separation.
- 48px — large structural spacing where appropriate.

These are starting values, not mandatory replacements for established dimensions.

Use optical alignment where mathematical alignment looks incorrect.

Align icons, text, controls and containers to consistent visual axes.

Avoid unexplained gaps and misaligned edges.

Related controls should be visibly grouped without requiring a border around every group.

## 7. Component proportions

Establish consistent component geometry.

Suggested desktop starting ranges:

| Component | Suggested size |
|---|---|
| Compact toolbar control | 28–32px |
| Standard toolbar control | 32–36px |
| Toolbar icon | 16–18px |
| Standard tab row | 30–36px |
| Compact menu item | 28–32px |
| Standard menu item | 32–36px |
| Standard input | 32–40px |
| Small corner radius | 4px |
| Standard corner radius | 6–8px |
| Larger surface radius | 10–12px |

Validate these against the existing application, accessibility requirements and display scaling.

Do not blindly apply these dimensions everywhere.

Visual compactness must not reduce effective hit targets or accessibility.

Reserve fully rounded geometry for components where it has a meaningful purpose.

## 8. Colour and surface architecture

Use semantic colour tokens rather than scattered hardcoded values.

Establish tokens for:

- Application background.
- Browser chrome.
- Sidebar surface.
- Content surface.
- Elevated menu surface.
- Hover surface.
- Selected surface.
- Primary text.
- Secondary text.
- Muted text.
- Subtle borders.
- Focus indicators.
- Brand accent.
- Warning and error states.

Use a small number of clearly differentiated neutral surfaces.

Dark interfaces should not become a collection of unrelated grey boxes.

Use subtle surface changes to communicate hierarchy before introducing borders or shadows.

Maintain accessible text contrast.

Do not modify the exact SC Teal brand value simply to improve contrast. Instead, adjust foreground colours or surrounding surfaces appropriately.

Never rely exclusively on colour to communicate selection, errors or focus.

## 9. Typography

Typography should feel consistent, understated and professional.

Preserve Dexerion's existing font family.

Recommended starting hierarchy:

- Secondary metadata: 11–12px.
- Compact browser controls: 12–13px.
- Standard interface text: 13–14px.
- Settings and reading-oriented text: 14–16px.
- Section headings: 16–20px.
- Major headings: 24–32px where justified.

Avoid oversized headings in ordinary browser interfaces.

Use font weight, contrast and spacing to establish hierarchy before increasing font size.

Maintain consistent line heights.

Prevent clipping, awkward wrapping and inconsistent baselines.

Ensure the authorized Small, Medium and Large font-size settings work correctly without breaking layouts.

Do not add new font dependencies without authorization.

## 10. Iconography

Use a coherent icon system.

Icons should have:

- Consistent stroke weight.
- Consistent optical size.
- Recognizable metaphors.
- Predictable alignment.
- Appropriate visual weight.
- Clear interaction states.

Do not mix unrelated icon styles.

Do not use emojis as substitutes for professionally designed interface icons.

Prefer existing Dexerion assets and established iconography.

Preserve the Dexi mascot for appropriate AI-related interactions.

The mascot should enhance product personality without distracting from browsing.

## 11. Buttons and controls

Buttons should look purpose-built rather than copied from a generic component library.

Distinguish between:

- Primary actions.
- Secondary actions.
- Tertiary actions.
- Icon-only controls.
- Destructive actions.
- Toggle controls.

Not every button needs a visible container.

Not every button needs a border.

Use filled backgrounds primarily when they communicate action hierarchy or selection.

Ensure all controls have appropriate hover, pressed, focus and disabled states.

Avoid excessive scaling or bouncing on hover.

Controls must not shift surrounding layouts during interaction.

Keep related controls visually consistent across the browser, settings, installer and updater.

## 12. Vertical tabs and sidebar

The sidebar is a core Dexerion interaction surface.

It must remain efficient when displaying many tabs.

Design for:

- Clear active-tab recognition.
- Readable tab titles.
- Consistent favicon alignment.
- Compact row heights.
- Predictable close controls.
- Distinct pinned tabs.
- Understandable group boundaries.
- Clear drag-and-drop feedback.
- Smooth scrolling.
- Collapsed and expanded states.
- Long tab titles.
- Large tab counts.

Do not place every tab inside an independently bordered card.

Use spacing, subtle backgrounds and meaningful selection indicators.

Ensure the sidebar remains usable with at least 96 tabs.

The New Tab control must remain accessible.

Preserve existing tab scrolling, grouping, pinning, drag-and-drop and keyboard behavior.

## 13. Tab groups

Tab groups should communicate structure without creating visual clutter.

Group colours should help users recognize relationships.

Avoid excessive coloured backgrounds that overwhelm tab content.

Use compact group headers and clear expansion indicators.

Ensure:

- Group membership is immediately understandable.
- Expanded and collapsed states are visually distinct.
- Group menus are never clipped by the sidebar.
- Colour selectors remain compact.
- Hover interactions have keyboard-accessible alternatives.
- Dragging tabs between groups feels predictable.

Do not redesign grouping behavior without explicit authorization.

## 14. Address bar and toolbar

The address bar is one of the most important browser controls.

It should be immediately recognizable, visually balanced and easy to access.

Preserve:

- URL readability.
- Navigation controls.
- Security indicators.
- Search functionality.
- Suggestions.
- Extension access.
- Existing shortcuts.
- Focus behavior.

Avoid unnecessary decorative elements around the address field.

Toolbar controls should share consistent alignment and geometry.

Separate unrelated actions through subtle spacing rather than excessive dividers.

Never compromise security information for visual minimalism.

## 15. New Tab page

The New Tab page must feel calm, purposeful and unmistakably Dexerion.

Search should remain the primary action.

Preserve the established original layout unless the owner explicitly authorizes a structural redesign.

Preserve:

- Original Dexerion logo.
- Original typography.
- Daily quote and author.
- Date and clock.
- Starred bookmarks.
- Tasks.
- Existing search and AI search functionality.
- Existing task priority logic.
- Three visible tasks before scrolling.

Avoid turning New Tab into a generic productivity dashboard.

Do not introduce large greeting banners, unnecessary cards or ornamental widgets.

Secondary information should remain visually subordinate to search.

Ensure large bookmark collections remain accessible without breaking the layout.

## 16. Menus and popovers

Menus should be compact, readable and predictable.

Use:

- Consistent item heights.
- Aligned icons.
- Clear labels.
- Restrained separators.
- Predictable hover states.
- Clearly visible keyboard focus.
- Appropriate submenu indicators.

Ensure menus are positioned correctly near window edges.

Prevent clipping, overflow and layering issues.

Avoid oversized menu cards with excessive padding.

Colour pickers should take inspiration from Dia's restrained approach while retaining existing Dexerion customization capabilities.

Never make hover the only way to access functionality.

## 17. Settings and Library

Settings should prioritize information clarity rather than decorative presentation.

Prefer structured rows and logically grouped sections over excessive cards.

Use clear labels, concise descriptions and consistent control placement.

Bookmarks, History, Downloads, Accounts and Extensions should feel like mature desktop management interfaces.

Optimize for:

- Scannability.
- Information density.
- Predictable alignment.
- Search accessibility.
- Long content.
- Narrow-window behavior.
- Consistent interaction patterns.

Avoid oversized dashboard-style tiles for ordinary settings.

## 18. AI assistant and Dexi mascot

AI should feel integrated into the browser, not attached as an unrelated chatbot.

The assistant sidebar should have:

- Clear reading hierarchy.
- Comfortable text spacing.
- Compact controls.
- Distinct conversation states.
- Accessible actions.
- Consistent browser styling.

Use the existing Dexi mascot and approved sprite assets where appropriate.

Mascot animations should communicate meaningful states such as thinking or completion.

Avoid continuous decorative animation.

Do not use generic sparkle icons, glowing AI gradients or excessive AI branding.

Respect reduced-motion preferences.

## 19. Installer and updater

The installer and updater must feel like extensions of the same product.

Preserve the custom Dexerion installer identity.

Use:

- Black-and-white foundations.
- SC Teal accents.
- Prominent but restrained logo placement.
- Purpose-built controls.
- Clear progress information.
- Understandable status messages.
- Consistent typography.
- Accessible keyboard navigation.

Avoid decorative white outlines, random teal lines and unnecessary ornaments.

Never change installation or update behavior as part of an unrelated visual redesign.

## 20. Motion design

Animation should communicate state, continuity or spatial relationships.

It should not exist merely to make the interface appear sophisticated.

Recommended starting durations:

- Hover feedback: 80–120ms.
- Button and selection transitions: 100–160ms.
- Menu appearance: 120–180ms.
- Sidebar transitions: 160–240ms.
- Larger spatial transitions: 200–300ms.

Adjust these based on actual interaction testing.

Prefer natural easing and responsive transitions.

Avoid:

- Excessive bouncing.
- Slow staggered entrances.
- Delayed availability of controls.
- Continuous idle animations.
- Layout-shifting hover effects.
- Expensive animated blur.
- Animations that interrupt rapid tab switching.

Respect reduced-motion preferences.

Motion must never introduce measurable interaction regressions.

## 21. Performance as a design requirement

A beautiful browser that feels slower is a failed redesign.

Preserve existing performance settings and browser engine behavior.

Prefer lightweight CSS and existing assets.

Avoid unnecessary:

- Runtime dependencies.
- JavaScript-driven decorative animations.
- Expensive shadows.
- Continuous rendering.
- Large blurred surfaces.
- Layout recalculations.
- Additional work during tab switching.
- Repeated component rendering.

Measure baseline and candidate performance under equivalent conditions.

If a visual change causes a repeatable regression, simplify or revert it.

Do not alter performance-related functionality to compensate for poor design implementation.

## 22. Mandatory design exploration

For substantial redesigns, do not immediately implement the first idea.

Produce at least three genuinely different visual approaches:

1. Conservative refinement of the existing interface.
2. More distinctive browser-specific composition.
3. Experimental but practical premium direction.

Evaluate each approach for:

- Visual quality.
- Brand consistency.
- Information density.
- Usability.
- Accessibility.
- Performance.
- Implementation risk.

Choose the strongest direction based on evidence.

Do not combine every attractive idea into one overloaded interface.

Sometimes the best design decision is to preserve an existing layout and refine its details.

## 23. Mandatory visual verification

Never approve UI based exclusively on source code.

For every substantial UI change:

1. Capture the existing interface.
2. Implement the proposed design.
3. Launch the actual application or its real renderer.
4. Capture the result.
5. Compare matched before-and-after screenshots.
6. Inspect alignment, proportions and hierarchy.
7. Test actual interactions.
8. Identify weaknesses.
9. Refine the design.
10. Repeat verification.

Use realistic content rather than empty demonstration layouts.

Test common and difficult scenarios:

- Many open tabs.
- Multiple tab groups.
- Long titles.
- Large bookmark collections.
- Long task descriptions.
- Narrow windows.
- Short windows.
- Maximized windows.
- Different display scaling.
- Alternate themes.
- Keyboard-only navigation.

Do not present static mockups as evidence of functioning software.

Clearly distinguish native application screenshots from renderer previews.

## 24. Independent visual critique

When possible, use a separate reviewer that has not participated in the implementation.

Give the reviewer actual screenshots and the design requirements.

Ask it to identify:

- Generic AI-generated aesthetics.
- Inconsistent geometry.
- Weak typography.
- Excessive visual noise.
- Poor alignment.
- Unnecessary decoration.
- Confusing hierarchy.
- Wasted screen space.
- Accessibility problems.
- Inconsistent controls.
- Missing functionality.
- Weak product identity.

Require specific observations and actionable corrections.

Do not accept vague feedback such as "looks modern" or "looks polished."

The reviewer must explain why a design succeeds or fails.

## 25. Professional UI evaluation rubric

Score substantial redesigns against the following weighted criteria:

| Criterion | Weight |
|---|---:|
| Visual craftsmanship | 20 |
| Browser usability | 20 |
| Layout and information hierarchy | 15 |
| Brand consistency | 10 |
| Component consistency | 10 |
| Accessibility | 10 |
| Interaction and motion quality | 10 |
| Performance efficiency | 5 |
| Total | 100 |

Target at least 90/100 before recommending a design for final review.

Scores must be supported by specific visual observations and test evidence.

Do not inflate scores to justify completing a task.

A high subjective design score cannot override failed functionality, security, accessibility or performance checks.

## 26. Automatic rejection conditions

Reject or revise a design if:

- It resembles a generic AI-generated dashboard.
- It introduces unnecessary visual complexity.
- It changes unauthorized functionality.
- It hides previously available controls.
- It changes the original logo without permission.
- It introduces an unauthorized font.
- It breaks tab scrolling or task prioritization.
- It clips menus or controls.
- It causes repeatable performance regressions.
- It weakens accessibility.
- It introduces inconsistent component styling.
- It cannot be adequately verified.
- It is materially worse than the original interface.

Do not ship a redesign merely because considerable time has been spent implementing it.

Reverting an unsuccessful design is a valid engineering decision.

## 27. Research standards

Research should be purposeful and evidence-driven.

Use:

- Official browser documentation.
- Product screenshots.
- Official demonstrations.
- Credible design analysis.
- Accessibility standards.
- Human-interface guidelines.
- Relevant user feedback.
- Actual product interaction examples.

Study both successful and unsuccessful design decisions.

Record:

- Source.
- Observed design principle.
- User benefit.
- Potential drawback.
- Relevance to Dexerion.
- Proposed adaptation.

Do not fabricate research findings.

Do not treat the number of sources as a substitute for research quality.

Translate research into concrete design decisions rather than producing generic summaries.

## 28. Design and engineering boundaries

This document governs visual design.

AGENTS.md governs the broader engineering workflow.

Neither document authorizes unrelated functionality changes.

Only implement features explicitly requested by the owner.

For UI-only work, preserve existing:

- Browser functionality.
- Application logic.
- Security boundaries.
- Performance settings.
- User data.
- Keyboard shortcuts.
- Navigation behavior.
- Task prioritization.
- Tab management.
- Installer and updater behavior.

Follow the currently authorized Git branch.

Never merge into main without authorization.

## 29. Final design delivery

For substantial UI work, deliver:

- A concise design rationale.
- Relevant research findings.
- Matched before-and-after screenshots.
- Screenshots of important interaction states.
- Independent visual critique findings.
- Functionality regression results.
- Performance comparison results.
- Accessibility findings.
- Known limitations.
- Relevant commits and branch information.

Explain exactly what makes the new interface better.

Do not describe a design as professional, premium or complete unless the evidence supports that conclusion.

## 30. Ultimate design principle

Dexerion should feel designed, not generated.

Every pixel, control, interaction and transition should appear to belong to the same product.

The best interface is not necessarily the most visually impressive screenshot.

It is the interface that remains beautiful, intuitive, efficient and comfortable after thousands of hours of everyday browsing.

Design with restraint.

Engineer with precision.

Verify with evidence.

Never settle for generic.