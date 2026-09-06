# Handoff mobile experience

Design direction, September 6, 2026. This specifies the experience for the existing milestones; it does not introduce a task system or provide implemented screen components.

## The experience to build

Handoff should feel calm, personal, and immediately useful to a tired parent or busy caregiver. Its memorable moment is opening a child's page and understanding the recent care without digging through a log. Voice should look inviting and save effort; touch entry should feel equally deliberate.

Use a warm editorial direction: a soft background, strong readable type, a distinctive handoff summary card, generous spacing, and a small set of meaningful care icons. Keep the full journal available while giving the most useful facts more prominence.

The home is a care dashboard. It must not be a generic checkbox list, a wall of identical database cards, or an AI chat box that makes the user discover commands.

## 1. Child dashboard

Visual priority:

1. **Child identity and care context.** Name, workspace, and declared active caregivers. Keep the selected child visible during every capture and review action.
2. **Handoff invitation.** When there are unread changes, show “Catch up on Milo's care” with the count and a short factual preview. Before taking care, this is the primary action.
3. **Recent essentials.** Three compact, readable summaries of the latest recorded feed, sleep, and diaper. Label them as recorded facts and include time/source access.
4. **Record update.** A large labeled microphone control with the hint “Say a few things. Review them together.” When already caring and authorized to contribute, this is the primary creation action.
5. **Quick care entry.** Four large icon-and-label actions: Feed, Diaper, Sleep, and Note; Milestone is available under More. These open a focused sheet instead of a generic form page.
6. **Recent updates and moments.** A few journal entries with human attribution and any ready attachments, then “View all activity.” Follow-up tasks, if later approved, belong in a secondary section.

Illustrative hierarchy with synthetic content; layout proportions are guidance, not literal UI text to hardcode:

```text
┌──────────────────────────────────────┐
│ Milo                  Maple Daycare  │
│ Alex is caring · last synced 09:05    │
│                                      │
│ CATCH UP ON MILO'S CARE               │
│ 3 updates since your last handoff     │
│ Latest recorded feed: 60 ml at 02:00  │
│                         Read handoff │
│                                      │
│ Feed          Sleep         Diaper   │
│ 60 ml         08:00–08:40    Wet      │
│ at 02:00      recorded nap   at 08:50 │
│                                      │
│         [mic] Record update          │
│ Say a few things. Review together.   │
│                                      │
│ [Feed]   [Diaper]   [Sleep]   [Note]  │
│                                      │
│ A moment from today                  │
│ “Dada” — first word, reported by Alex│
│                    View all activity │
└──────────────────────────────────────┘
```

For first use, show an inviting empty state with one example and a real entry action. Do not fill blank data with fictional feeds or display zeros as observations. Reader/guardian views prioritize the handoff and omit unauthorized creation actions. Daycare staff first see an easy-to-scan child roster, then the same child dashboard; no AI guesses which child a recording belongs to.

## 2. Quick care entry

Tapping Feed opens a bottom sheet with a clear title, optional amount/unit, occurrence time control, and **Save feed**. Show only fields relevant to that event. Offer **Now**, **Earlier**, and **Time unknown** with no occurrence time silently selected. Empty amount means unspecified, never zero. Familiar choices can reduce typing, but previously used amounts/times are suggestions requiring selection.

Diaper uses explicit Wet/Stool/Both choices, optional detail, and time. Sleep offers the supported reported start/end/interval states without implying that a timer has already been built. Milestones get space for a quote; notes remain simple. Keep dismissal and unsaved changes clear.

Use a visible saved state and a correction action. If Save is queued or fails, keep the user's input and label the state accurately. For the current MVP, durable offline recovery covers recordings; do not imply offline manual writes are saved on the server. Extend the outbox explicitly before promising the same offline durability for manual forms.

A common manual observation should take only selecting the action, entering/selecting known facts, and saving. The user should not navigate through a wizard, an AI conversation, or a required recording to do this.

## 3. Inviting voice capture

Use a labeled **Record update** action, not an unexplained floating microphone. Near it, rotate a small set of task-relevant examples such as “Fed 60 ml at two, then had a wet diaper.” Do not imply that speaking will immediately publish facts.

After an explicit recording action, show the selected child, elapsed time, a restrained live audio indicator, **Stop**, and **Cancel**. A tap interaction should work one-handed; holding a button is not required. Explain microphone permission when first needed. If denied, keep **Type instead** and quick entry available with a clear path to settings.

After Stop, show **Preparing your update**, followed by compact editable event cards. Emphasize amount, unit, and date/time with readable chips or fields. Ambiguity receives a specific prompt such as “Which day was 2 am?” Each card can be edited or removed before **Save 2 updates**. Let the user inspect the transcript without making it dominate the screen.

Keep processing indicators truthful: local file saved, uploading, transcribing, preparing draft, or ready for review. A simple overall status can hide infrastructure details from ordinary users while still distinguishing “saved on this phone” from “shared.” On failure, preserve the recording and offer retry or manual entry.

After confirmation, a brief, quiet transition places the new entries in the journal and offers **Add photo or video**. Never auto-publish, auto-start recording on app open, or use a streak/reward to pressure people into recording more.

## 4. The handoff itself

The brief should be more readable than scrolling the underlying journal:

- A clear heading and exact boundary: “Since your last handoff” or the disclosed first-use window.
- **Recent essentials:** latest known care facts, explicitly labeled when they precede the change window.
- **Updates:** confirmed changes grouped into concise factual entries, with corrections/deletions identified.
- **Moments:** reported milestones and optional images; preserve source attribution and avoid claiming unverified developmental conclusions.
- **Still processing:** known pending recordings, so the brief does not look more complete than it is.
- A persistent, plainly labeled **I've read this — start care** action when appropriate. The recipient can read without starting care.

Each entry can expand to its source event. Do not hide unacknowledged entries merely to keep the page short; show remaining updates and preserve the snapshot acknowledgement rules. If new updates arrive, retain the current snapshot and offer a refresh. Follow-up tasks, if approved later, remain separate from the acknowledgement action.

## 5. Visual and interaction system

Initial token direction: warm oat background (`#F5F1E8`), deep green primary/text (`#183F35`), warm paper surfaces (`#FFFCF6`), and a restrained clay accent (`#CC704F`). These are starting design values, not a claim that every combination passes contrast checks. Test the actual text/background combinations, light/dark states, and disabled controls before shipping.

Use a readable bundled humanist sans serif for controls/body, with a soft editorial serif for a small number of large headings if the pairing remains clear at large text sizes. Choose licensed font assets during implementation; avoid adding several font families or making a remote font download a prerequisite for reading a brief.

Use a shared spacing scale, large rounded primary controls, restrained shadows, and a subtle tonal treatment on the handoff card. Keep decoration away from dense factual text. Use icon plus label plus state; color is supplementary. Avoid decorative charts, progress rings, and scoring a child's care completeness.

Use a proposed minimum 48 logical-unit touch target for primary controls, adequate separation, and a reachable bottom action area that respects the keyboard and safe area. Support text scaling, screen-reader labels, keyboard/focus on the invitation web page, and reduced motion. Motion should communicate recording/saving/navigation state and should never block reading or require sound. Provide a calm dark appearance for night use, with separately checked contrast.

## 6. Data and component boundaries

The dashboard needs authorized latest-known facts, not an inference from the first page of journal results. Add a read-only `GET /v1/children/:childId/overview` projection over existing tables for latest confirmed feed/sleep/diaper, a small recent-activity preview, active declared sessions, and the caller's unacknowledged-change count. Preserve unknown occurrence times and exclude planned notes from completed-care summaries. Show a separate recently reported unknown-time entry when it cannot reliably be ranked as the latest occurrence.

The overview is a live view, not an acknowledged handoff snapshot. Tapping Read handoff creates/loads the bounded brief through the existing handoff service. The overview never advances the cursor and needs no new canonical table. Keep its queries tenant/child scoped; do not expose other authors' raw drafts or a guardian's inaccessible child.

Shared presentation: `CareSnapshot`, `QuickCareActions`, `HandoffCard`, `EventCard`, `RecordButton`. Shared feature composition: `CareDashboardScreen`, `QuickEntrySheet`, `RecordScreen`, `ReviewCaptureScreen`, `HandoffScreen`. App shells choose navigation and capabilities. Components do not calculate authorization or query the database.

## 7. Acceptance gates

Targets to measure during development and pilot observation; none is an achieved result yet:

| Check | Target |
| --- | --- |
| Understand recent care | At least 4 of 5 representative users identify the latest recorded feed and its time/uncertainty within 5 seconds |
| Discover voice | At least 4 of 5 find how to record an update without coaching within 5 seconds |
| Manual quick entry | Median <=10 seconds to save a simple known-time diaper observation in five observed runs, excluding network delay; no fabricated defaults |
| Correct a voice draft | At least 4 of 5 can correct a quantity and uncertain date without returning to the recorder |
| Understand handoff action | At least 4 of 5 distinguish reviewing a brief, starting care, and completing a future task |
| Inclusive interaction | Main flows work with large text, screen reader labels, reduced motion, and denied microphone permission on both native platforms |
| Honest state | Review empty, populated, unknown-time, offline, processing, failed, revoked-access, and read-only screens; none implies unconfirmed facts were shared |

Small samples are directional. Ask why a participant chooses voice or touch and whether the interface saves effort. Voice adoption is an observation, not a target to inflate by hiding alternatives. An attractive mockup alone is insufficient: test the full interaction with realistic synthetic data and review it on both platforms.
