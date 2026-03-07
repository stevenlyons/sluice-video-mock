# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**video-dvr** helps simulate internet video playback for use in player integration testing. It allows the developer to specify how the video delivery and playback should behave to factilite testing and validation of the player. 

## Process

New features will have a Product Requirements Document (PRD) added to the docs/prd directory. The PRD will list the high-level requirements, goals, and experience expectations of the feature. From the information in the PRD, create a matching Technical Design Document (TDD) that includes architecture, technical information, data types, build commands, and other information. The TDD documents should be put in the docs/tdd directory and named the same as the source PRD document. If there are open questions from processing the PRD, ask the user.

When implementing a TDD, create a git branch using the name of the feature. 

Keep track of the TDDs that are implemented in file called FEATURES.md. Add a checkbox for each TDD when it is created. When the TDD is implemented, check the checkbox.  

After the TDD implementation, be sure to update documentation such as: CLAUDE.md, README.md, and any other associated docs. 

## Commands

```bash
npm install        # Install dependencies
node app.js        # Start the server (default port 3030)
node app.js 8080   # Start the server on port 8080
npm start          # Same as node app.js
```

Tests use the Node.js built-in test runner (`node --test`). Run with:

```bash
npm test
```

Test file is colocated with the module it tests: `lib/logic.test.js` covers all pure logic functions in `lib/logic.js`.

## Architecture

The entire server is a single file: `app.js`. It uses **Koa** as the HTTP framework and **koa-throttle2** for simulating delays.

### Request Flow

1. A request arrives with a path like `/s5-p30-e404/media.m3u8` or `/my-scenario/media.m3u8`
2. The path (directory portion) is the **spec identifier** — resolved once and cached in `specCache`
3. `loadSpecification(filepath)` resolves the spec:
   - Checks for `specs/<name>.json` — if found, reads and returns its `operations` array
   - Otherwise falls back to `parseSpecification(filepath)` for inline spec strings
4. The filename determines the request type:
   - `media.m3u8` → serve static master playlist from `media/`
   - `rendition.m3u8` → dynamically generate an HLS rendition playlist based on total calculated duration
   - `media.mpd` → dynamically generate a DASH MPD manifest based on total calculated duration
   - `*.ts` / `*.m4s` → segment request; look up the segment number in the **timeline** and apply the action (delay or error)

### Spec Loading

Two modes for specifying playback behavior:

**Inline spec strings** — encoded directly in the URL path, parsed by `parseSpecification(path)`:
- `s<N>` → `{ op: 'startup', delay: N }`
- `p<N>` → `{ op: 'playback', time: N }`
- `r<N>` → `{ op: 'rebuffer', delay: N }`
- `e<code>` → `{ op: 'error', code: N }`

**Named spec files** — JSON files in `specs/` directory, referenced by name in the URL:
```json
{ "description": "...", "operations": [ { "op": "startup", "delay": 5 }, ... ] }
```
The `operations` array uses the same format as inline parsing output.

### Segment Timeline

`createSegmentTimeline(operations)` maps operations to specific segment numbers. Only segments with special behavior (delay or error) appear in the timeline array — everything else is nominal playback. The timeline is cached in `timelineCache`.

### Delay Mechanism

Delays are implemented by **throttling the byte delivery rate** via `koa-throttle2` (not via `sleep`). The chunk size is calculated so the single physical file (`media/0.ts`) takes the desired number of seconds to transfer.

### Key Constants

- `segmentLength = 5` (seconds) — hardcoded; all segment math derives from this
- HLS segment requests (`*.ts`) physically serve `media/0.ts`; DASH segment requests (`*.m4s`) physically serve `media/0.m4s`
