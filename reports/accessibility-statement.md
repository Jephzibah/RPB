# Developer Accessibility Review and Signoff

Complete this sheet for the exact revision being delivered. Deque axe is automated evidence, not a substitute for the manual checks below.

## Review details

| Field | Value |
| --- | --- |
| Operating system | [OS and version] |
| Browser | [browser and version] |
| Viewports tested | [desktop, tablet, mobile widths] |
| axe-core version | [version from report] |

Automated report: [axe-results.json](./axe-results.json)

## Automated axe review

- [ ] The report was produced for the URL and commit recorded above.
- [ ] Every critical, serious, moderate, and minor violation has been resolved or recorded under Known issues.
- [ ] Every `incomplete` result was manually reviewed and its disposition recorded below.
- [ ] The terminal counts agree with the saved JSON report.

Incomplete-result disposition:

| Rule / element | Disposition and evidence |
| --- | --- |
| [rule and selector, or "None"] | [resolved, not applicable, or known issue] |

## Manual visual and responsive review

- [ ] Text, controls, icons, focus indicators, and interaction states have sufficient visual contrast.
- [ ] Hover, focus, active, expanded, disabled, validation, and error states remain understandable without color alone.
- [ ] Content reflows without loss, overlap, or horizontal page scrolling at narrow/mobile widths and browser zoom.
- [ ] Text remains readable when text spacing and browser zoom are increased.
- [ ] Images and responsive media do not obscure or clip meaningful content.
- [ ] With reduced motion enabled, smooth scrolling and nonessential transitions or animations are suppressed.

## Manual keyboard review

- [ ] The skip link is the first focusable control, becomes visible on focus, and moves navigation to the main content.
- [ ] Tab and Shift+Tab follow a logical order and every interactive control has a visible focus indicator.
- [ ] Links, buttons, the mobile navigation control, forms, and other controls work without a pointer.
- [ ] Accordions, when present, use heading-wrapped buttons and expose the correct expanded state and controlled panel.
- [ ] No component traps focus or unexpectedly moves focus.

## Structure and accessible-name review

- [ ] The accessibility tree exposes one main landmark and uniquely named Primary and Footer navigation landmarks.
- [ ] Headings form a meaningful outline and accordion triggers participate in that outline.
- [ ] Controls expose accurate names, roles, values, expanded states, and relationships.
- [ ] Exactly the active page navigation item uses `aria-current="page"`.
- [ ] Informative images have meaningful alternatives; image-only links have accessible names.
- [ ] Decorative images beside visible link text use `alt=""` and are omitted from the accessibility tree.

## Known issues

| Issue / WCAG criterion | Impact | Resolution, owner, and due date |
| --- | --- | --- |
| [issue, or "None"] | [impact] | [resolution details] |

## Developer attestation

I confirm that I ran the automated report, completed the applicable manual checks above, and accurately recorded any known limitations for the tested revision.

- Developer: [name]
- Tested commit: [git commit hash]
- Date: [YYYY-MM-DD]
