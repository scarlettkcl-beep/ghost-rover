# Mobile control review

Research and source review: 15 November 2026. Scope: the phone rover controller and all 14 phone missions. These are recommendations for this game, not a claim of accessibility conformance or physical-device validation.

## Evidence informing the redesign

- Apple’s [game control guidelines](https://developer.apple.com/design/human-interface-guidelines/game-controls) recommend reachable thumb controls, safe-area awareness, action-representative symbols, contextual visibility, and pressed feedback visible around the finger. They place secondary controls at the top and describe left-side movement as the familiar convention. Their frequent-control minimum is 44×44 **points**; less important controls may be smaller.
- Apple’s [handheld game design session](https://developer.apple.com/videos/play/meet-with-apple/243/) favors anchoring interface components to screen edges rather than scaling an entire desktop layout. It recommends readable type, accommodating device proportions and safe areas, reducing unnecessary virtual buttons, and trying the result on real devices.
- Android’s [accessibility guidance](https://developer.android.com/guide/topics/ui/accessibility/apps) recommends touch areas of at least 48×48 **dp**, and useful descriptions that express a control’s purpose. It also provides text-contrast targets.
- Microsoft’s [game input accessibility guidance](https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/107) recommends alternatives to prolonged holds, repeated presses, and simultaneous inputs, or a way to bypass such tasks. It also recommends cancelling accidental pointer actions before completion and distinguishes essential immediate gameplay input from ordinary button activation.
- W3C’s [target size explanation](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum) describes the web’s 24×24 CSS-pixel AA minimum and its exceptions. That is a compliance floor, not a good primary-game-control design target. Native points/dp and CSS pixels are different units; this project chooses 48 CSS pixels as a practical web hit-area floor and larger main action areas, subject to device testing.

## Findings from the existing implementation

1. **Two-thumb actions are cramped onto one side.** Landing, flight and racing instructions ask players to steer with one thumb while holding an action with the other, but both controls were stacked in the same narrow right-hand panel. Separate positioning on the left from the main action on the right; leave the game unobscured between them. This is the highest-impact game-specific inference from the ergonomic guidance.
2. **Small-screen rules shrink the wrong things.** Mission range controls fell to 38px high; mission menu buttons were 40px; the controller close button was 32px and utility controls were small. Preserve hit areas on short screens. Reduce decoration, padding and duplicate copy before reducing controls.
3. **The mission panel reads like a settings form.** Every task used a standard range input and a paragraph. Keep precise native sliders where appropriate, but give them broad hit areas, strong labels and immediate position feedback. Pair actual action icons with short verbs. Make aim/focus tasks feel distinct from thrust/drive tasks.
4. **Canvas interaction has little discoverability.** Direct touch works for repairs and arm tasks, but a finger can cover the useful object and feedback. Keep direct manipulation as a convenient option while retaining a visible offset control alternative. Do not require tiny canvas targets or introduce gesture-only actions.
5. **Instructions compete with gameplay.** Preserve one concise current-action instruction in a predictable location. Keep the longer explanation available without reducing the playfield or creating a scrollable control deck during time-sensitive input.
6. **Pressed state needs to communicate registration.** Use an outline/glow and movement that remain visible around the thumb, not only a color change under it. Keep it local and immediate. Haptics can be enhancement only; browser support varies and should not be required to understand input.
7. **Exit and setup are too close to routine control work.** Keep Pause available and separate from held action zones. Treat menu actions as ordinary release/click activation, while hold-to-thrust can correctly activate immediately. Release all held state on cancel, rotation, blur, disconnect and task transition.

## Control families to preserve

| Missions | Primary interaction | Additional requirement |
| --- | --- | --- |
| Eagle landing, Grand Prix, Ingenuity, Spirit | Left position/steering; right hold action | Both inputs must remain independent; Spirit keeps its intentional reversed steering |
| Surveyor landing | One large thrust button | Speed feedback must stay visible while holding |
| Mirror, focus, solar-panel cleaning | One broad precise position control | Value stays put on release; no unnecessary action button |
| Unfold rover, repair fender, seismometer, dig ice, roll out, soil lab | Direct manipulation plus offset position/action controls | Clear current action; maintain multi-step feedback and existing timing |

Keep the existing gyro steering axis and direction for rover driving. Keep the cartoon visual style, animations, mission rules, assistance and Skip. The user requested gyro driving; replacing it with a joystick is outside this redesign. A hold-toggle accessibility option and portrait gameplay remain possible later work, rather than silently changing gameplay now.

## Acceptance checks

- At 640×360, 667×375, 844×390 and a taller landscape size, every active control is visible without scrolling the play controls, and the canvas remains undistorted.
- Hit areas are at least 48 CSS pixels in both dimensions where applicable; controls remain inside safe areas with space between unrelated actions.
- Two touches can steer and hold simultaneously. Cancelling either touch does not strand the other; all holds clear on interruption.
- All 14 tasks can finish before automatic assistance using their proposed input method.
- Instructions describe what the control actually does, including reversed steering and stage-specific actions.
- Check actual Android Chrome and iPhone Safari grip, reach, sensor permission flow, browser bars, notch/home gesture conflicts and multi-touch. Desktop emulation does not establish that these feel good on a physical phone.
