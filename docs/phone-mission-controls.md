# Phone mission controls

Tasks run on the phone using the same simulations as the computer. Touch controls use the canvas and a bottom control deck, with positioning on the left and actions on the right for independent thumbs. Action buttons use task-specific icons, live labels and immediate HOLD/HOLDING feedback. They do not require motion permission. A range slider remains available for precise positioning without obscuring the scene. Releasing a touch, losing pointer capture, backgrounding, or pausing releases all held actions.

| Mission | Position control | Action and feedback |
| --- | --- | --- |
| Apollo 11 | Drag landing position or slide | Hold **Fire engine** to brake descent; release to fall. Aim for the clear zone. |
| Surveyor 3 | No unnecessary steering | Hold **Fire engines**, watching the speed gauge; release to descend. |
| Apollo 14 | **Mirror angle** slider or canvas drag | No hold button. Leave the beam aligned while signal lock fills. |
| Apollo 15 | Touch glowing parts or slide | Hold **Lower rover**, **Unfold wheels**, then **Fit seats** as each step changes. |
| Apollo 16 | Steering slider/canvas with one thumb | Hold **Drive** with the other thumb; weave around cones. |
| Apollo 17 | Touch glowing repair or slide | Hold **Tape crack**, **Fit map**, then **Clamp patch**. |
| Ingenuity | Slide toward the ring | Hold **Lift** to rise; release to coast down. Independent movement and lift. |
| InSight | Touch object, slide robot arm | Hold **Grab instrument**, **Lower instrument**, **Grab shield**, then **Lower shield**. |
| Opportunity | Slide to follow the gust | No hold button; wind clears panels while the rover is aligned. |
| Phoenix | Touch trench, then ice | Hold **Scrape trench** for three layers; the button changes to **Collect ice** when exposed. |
| Sojourner | Touch glowing part or slide | Hold **Deflate airbags**, **Lower ramp**, then **Roll down ramp**. |
| Spirit | Explicit **Reversed steering** slider | Hold **Drive backward**; preserve the original reversed-steering challenge. |
| Viking 1 | Slide scoop between soil and lab | Button alternates **Scoop soil** and **Pour into lab** for two samples. |
| Viking 2 | Precision **Camera focus** slider | No hold button. Find sharp frost, then leave the slider still to lock. |

Canvas touch-and-hold is enabled for construction and sampling tasks. Flight and driving tasks use a dedicated action button so touching the position control never accidentally fires an engine or starts moving. The first canvas pointer owns positioning; a second thumb can independently hold the action. All coordinates are converted from the actual canvas bounds into the original 800-pixel task space, respecting narrower task ranges.
