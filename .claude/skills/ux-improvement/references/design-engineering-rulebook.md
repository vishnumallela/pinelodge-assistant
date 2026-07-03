# Design Engineering Rulebook

Use this reference as the implementation standard for UX improvement work.

## Table of Contents

- [Section 1: Philosophy](#section-1-philosophy-rules-1-10)
- [Section 2: Typography](#section-2-typography-rules-11-20)
- [Section 3: Color & Visual](#section-3-color--visual-rules-21-30)
- [Section 4: Spacing & Layout](#section-4-spacing--layout-rules-31-40)
- [Section 5: Animation & Motion](#section-5-animation--motion-rules-41-50)
- [Section 6: Inputs & Forms](#section-6-inputs--forms-rules-51-60)
- [Section 7: Tables & Lists](#section-7-tables--lists-rules-61-70)
- [Section 8: Modals, Popovers & Overlays](#section-8-modals-popovers--overlays-rules-71-80)
- [Section 9: Enterprise Trust Patterns](#section-9-enterprise-trust-patterns-rules-81-90)
- [Section 10: Collaboration & Process](#section-10-collaboration--process-rules-91-100)
- [Pre-Ship Checklist](#pre-ship-checklist)

## Section 1: Philosophy (Rules 1-10)

1. Good UX is boring UI. Familiarity beats novelty.
2. Design is objective, not subjective. It has rules, constraints, and measurable outcomes.
3. Ship what works. Iterate to greatness. Perfect is the enemy of shipped.
4. Every change in one component ripples through the product. Think maintenance from day one.
5. The interface must feel like it was built by someone who cares about every pixel.
6. Reduce cognitive load above all else. One direction to scan, one idea per section.
7. Density is acceptable in enterprise tools. Noise is not.
8. Use whitespace to separate sections, not borders.
9. Every screen must be scannable in under 3 seconds.
10. If a user has to think about how to use it, the design has failed.

## Section 2: Typography (Rules 11-20)

11. Use one font family everywhere. Never mix.
12. Body text: `14-15px`, line-height `1.5`, color `gray-900`.
13. Secondary text: `13px`, color `gray-500`.
14. Headings: `font-weight: 600`, not bold.
15. Be bold with type when it serves hierarchy. Confident typography beats decorative type.
16. All text must have a minimum contrast ratio of 4.5:1 against its background.
17. Never use more than three font sizes on a single screen.
18. Line length should not exceed 75 characters for body text.
19. Use `antialiased` on the body element for smoother font rendering.
20. Right-align numbers and action menus. Left-align everything else.

## Section 3: Color & Visual (Rules 21-30)

21. Maximum three semantic colors: Primary (brand), Secondary (`gray-900`), Destructive (`red-600`).
22. Backgrounds: `white` or `gray-50`. No gradients on page backgrounds.
23. Cards: `white` with `1px gray-200` border OR subtle `gray-50` background. Pick one and stick to it.
24. If using dark mode, never use pure black (`#000`). Use brand color at 1-10% lightness.
25. Status indicators use a colored dot (4px) + text. Never color-only.
26. Shadows must follow a hierarchy: rest -> dropdown -> modal, increasing in depth.
27. Never use drop shadows on text.
28. Hover states use background color shifts, not border color shifts.
29. Disabled states use `opacity: 0.5` + `cursor: not-allowed`, never a different color.
30. Loading skeletons use the same shape as the content they replace.

## Section 4: Spacing & Layout (Rules 31-40)

31. Strict 4px or 8px grid. No arbitrary `7px` or `13px` gaps.
32. Section padding: `24px` or `32px`. Card padding: `16px` or `20px`.
33. Minimum `16px` padding between text and any container edge.
34. Padding creates internal space. Margin creates external space. Use them intentionally.
35. One-dimensional scrolling only. No horizontal carousels unless absolutely necessary.
36. Consistently align text left. Right-align only numbers and action menus.
37. One primary action per view. Secondary actions must be visually subordinate.
38. Sticky headers must have a `1px` bottom border to separate from scrolling content.
39. Page headers are single-line: title + count badge + primary action. No subtitles.
40. Every row in a table must be scannable in 0.5 seconds.

## Section 5: Animation & Motion (Rules 41-50)

41. Never use `transition: all`. Specify exact properties.
42. Never use `ease-in` on UI elements. Use `ease-out` or `cubic-bezier(0.23, 1, 0.32, 1)`.
43. Never animate from `scale(0)`. Start from `scale(0.97)` + `opacity: 0`.
44. Buttons must feel alive: `transform: scale(0.97)` on `:active` with `160ms ease-out`.
45. Popovers scale from their trigger origin, not the center of the screen.
46. Keep UI animations under 300ms. Dropdowns 150-250ms, modals 200-300ms.
47. Use `@starting-style` for entry animations. No `useEffect` mount hacks.
48. Skip animation entirely on keyboard-triggered actions.
49. Respect `prefers-reduced-motion`. If the user requests less motion, honor it immediately.
50. Toast exit uses `ease-in`; everything else uses `ease-out`.

## Section 6: Inputs & Forms (Rules 51-60)

51. Input rest state: `1px gray-300` border.
52. Input focus state: brand color border + soft outer glow (`box-shadow: 0 0 0 2px rgba(brand, 0.15)`).
53. Never use placeholders as labels. Placeholders disappear; labels stay.
54. Helper text goes below the input, never inside it.
55. Error messages are inline, below the field, not top-of-page banners.
56. Every form button says exactly what it does: "Save Changes" not "Submit."
57. Replace jargon with verbs. "Set up" not "Provision." "Send Invite" not "Execute."
58. Complex forms use step indicators if more than three steps.
59. Autofocus the first field in a modal when it opens.
60. Disable the submit button until required fields are valid.

## Section 7: Tables & Lists (Rules 61-70)

61. Sticky header with `1px gray-200` bottom border.
62. Row height: `48-52px`. Not cramped, not wasteful.
63. Hover state: `gray-50` background. No row borders on hover.
64. Actions column: right-aligned, always last. Icon button + dropdown.
65. Never show more than one action button per row by default.
66. Bulk actions appear in a floating bar only when rows are selected.
67. Empty state: illustration + one line of text + CTA button.
68. If filters return zero results, show the active search term + [Clear Filters] button.
69. Never show a generic "No data" when filters are active.
70. Status columns use a colored dot + text. Never color-only.

## Section 8: Modals, Popovers & Overlays (Rules 71-80)

71. Modals enter from `scale(0.95)` + `opacity: 0`, never `scale(0)`.
72. Modals use `0 8px 30px rgba(0,0,0,0.12)` shadow.
73. Drawers slide from edge with `cubic-bezier(0.32, 0.72, 0, 1)`.
74. Popovers use `0 4px 12px rgba(0,0,0,0.08)` shadow and scale from trigger.
75. `Esc` closes any overlay and returns focus to the trigger element.
76. Trap focus inside modals. Tab cycles within, never escapes to the page.
77. Clicking the backdrop closes the overlay.
78. Profile popover contains role badge and identity details. Sidebar does not.
79. Sidebar shows only name + avatar. Role is contextual, not persistent chrome.
80. Never stack more than two modals deep.

## Section 9: Enterprise Trust Patterns (Rules 81-90)

81. Every scoped object shows its parent scope: `Customer: [Name]` or `Supplier: [Name]`.
82. Every uploaded file shows uploader identity: gradient avatar + full email + timestamp.
83. File cards show: name + size + uploader + timestamp + status.
84. Review/approval flows show reviewer avatar + decision timestamp + comment.
85. Audit trail is visible UI, not hidden log. Every change shows who and when.
86. If data sources conflict, surface the conflict clearly. Do not silently pick one.
87. Delete requires confirmation. Bulk delete requires typing "DELETE".
88. Send/irreversible actions have a 5-second undo toast.
89. Change notes appear in-app when workflows update.
90. The app works exactly as the user assumes it should. No surprises.

## Section 10: Collaboration & Process (Rules 91-100)

91. Share prototypes early and often. Deploy to staging so design can feel, not just see.
92. If a design tweak takes under 5 minutes, do it immediately. Do not ticket it.
93. If something is hard to implement, research alternatives and present them, not excuses.
94. Mockups never specify 100% of cases. Build judgment for the gaps.
95. Learn why design system choices exist. Ask why, not just what.
96. If designers want to code, enable them. It is an investment.
97. If you block designers from coding, you must promptly address every design ticket.
98. Scope is the only reliable lever when behind schedule. Discuss it with trust.
99. Keyboard shortcuts have zero animation: `/` for search, `Esc` to close, `?` for help.
100. Before shipping, run the pre-ship checklist. Every screen, every time.

## Pre-Ship Checklist

- [ ] No `transition: all` anywhere
- [ ] No `ease-in` on interactive elements
- [ ] Every button has `:active` state (`scale(0.97)`)
- [ ] Modals enter from `scale(0.95)` + `opacity: 0`
- [ ] Popovers scale from trigger origin
- [ ] No animation on keyboard shortcuts
- [ ] All copy uses verbs, not jargon
- [ ] Error states inline, not banners
- [ ] Loading states are skeletons
- [ ] Tables: sticky headers, hover states
- [ ] Filters match data type
- [ ] Search autofocused
- [ ] Scoped objects show parent context
- [ ] Uploads show uploader (avatar + email)
- [ ] `antialiased` on body
- [ ] Semantic markup throughout
- [ ] Keyboard nav, focus traps, reduced motion
- [ ] Core Web Vitals pass
