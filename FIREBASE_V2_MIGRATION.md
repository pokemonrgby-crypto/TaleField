# Firebase Functions v2 Migration Guide

## Overview
All backend Firebase Functions (excluding auth) have been successfully migrated from v1 to v2 (2nd generation) modular SDK, following the latest 2025 Firebase documentation.

## What Changed

### 1. Import Statements
**Before (v1):**
```javascript
import * as functions from "firebase-functions";
import { HttpsError } from "firebase-functions/v1/https";
```

**After (v2):**
```javascript
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
```

### 2. Callable Functions (onCall)
**Before (v1):**
```javascript
export const myFunction = functions
  .region("asia-northeast3")
  .runWith({ timeoutSeconds: 60 })
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new HttpsError("unauthenticated", "...");
    const uid = context.auth.uid;
    const params = MySchema.parse(data);
    // ...
  });
```

**After (v2):**
```javascript
export const myFunction = onCall({
  region: "asia-northeast3",
  timeoutSeconds: 60
}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "...");
    const uid = request.auth.uid;
    const params = MySchema.parse(request.data);
    // ...
});
```

**Key Changes:**
- Options moved to first parameter as object
- `(data, context)` → `(request)`
- `context.auth` → `request.auth`
- `data` → `request.data`

### 3. Firestore Triggers
**Before (v1):**
```javascript
export const onUpdate = functions.firestore
    .document('collection/{docId}')
    .onUpdate(async (change, context) => {
        const before = change.before.data();
        const after = change.after.data();
        const docId = context.params.docId;
        // ...
    });
```

**After (v2):**
```javascript
export const onUpdate = onDocumentUpdated('collection/{docId}', async (event) => {
        const before = event.data.before.data();
        const after = event.data.after.data();
        const docId = event.params.docId;
        // ...
    });
```

**Key Changes:**
- `(change, context)` → `(event)`
- `change.before` → `event.data.before`
- `change.after` → `event.data.after`
- `context.params` → `event.params`

### 4. Scheduled Functions
**Before (v1):**
```javascript
export const scheduledJob = functions.pubsub
    .schedule('every 60 minutes')
    .onRun(async (context) => {
        // ...
    });
```

**After (v2):**
```javascript
export const scheduledJob = onSchedule('every 60 minutes', async (event) => {
    // ...
});
```

**Key Changes:**
- Much simpler syntax
- `(context)` → `(event)`
- No need for `.pubsub` chain

## Migrated Functions

### Callable Functions (15 total)
1. **AI Generation:**
   - `genShin` - Generate new deity
   - `genArtifact` - Generate new artifact

2. **Game Actions:**
   - `apiPlayCard` - Play a card
   - `apiReact` - React to opponent's action
   - `apiEndTurn` - End current turn
   - `playerAction` - Handle GodField actions (ATTACK, DEFEND, PRAY, etc.)

3. **Room Management:**
   - `createRoom` - Create game room
   - `joinRoom` - Join existing room
   - `setPlayerReady` - Set player ready status
   - `startGame` - Start the game
   - `leaveRoom` - Leave room

4. **Deletion:**
   - `deleteCard` - Delete user card (backward compatibility)
   - `deleteArtifact` - Delete artifact
   - `deleteShin` - Delete deity

5. **Bot Support:**
   - `createBotRoom` - Create room with bots
   - `executeBotTurn` - Execute bot turn

### Firestore Triggers (2 total)
1. `onResolvePhase` - Process game stack when phase changes to 'resolve'
2. `scheduleResolve` - Auto-transition from 'reaction' to 'resolve' after 7 seconds

### Scheduled Functions (1 total)
1. `cleanupEmptyRooms` - Remove empty rooms every 60 minutes

## Benefits of v2

### Performance
- **Cloud Run Infrastructure:** Better scalability and faster cold starts
- **Concurrency:** Up to 1,000 requests per instance (vs 1 in v1)
- **Timeouts:** HTTP functions can run up to 60 minutes (vs 9 minutes in v1)

### Resources
- **Instance Sizes:** Up to 16GB RAM and 4 vCPUs (vs 8GB/2vCPU in v1)
- **Better Monitoring:** Native Cloud Run monitoring and logging

### Developer Experience
- **Cleaner Syntax:** More modular and easier to read
- **Better TypeScript Support:** Improved type definitions
- **Modern Patterns:** Aligns with Firebase's modular SDK approach

## Deployment

The functions are ready to deploy with:
```bash
firebase deploy --only functions
```

## Testing

All migrated functions:
- ✅ Pass syntax validation
- ✅ Module imports successfully
- ✅ Maintain backward compatibility

## Client-Side Changes

⚠️ **IMPORTANT:** Client-side code does NOT need to change! The migration is server-side only.

Firebase v2 functions are fully compatible with existing client calls:
```javascript
// This still works the same way
const callable = httpsCallable(functions, 'genArtifact');
const result = await callable({ prompt: "...", powerCap: 10 });
```

## References

- [Firebase Functions v2 Official Docs](https://firebase.google.com/docs/functions/2nd-gen-upgrade)
- [Version Comparison](https://firebase.google.com/docs/functions/version-comparison)
- [Callable Functions Guide](https://firebase.google.com/docs/functions/callable)
- [Firestore Triggers](https://firebase.google.com/docs/functions/firestore-events)
- [Scheduled Functions](https://firebase.google.com/docs/functions/schedule-functions)

## Rollback

If needed, rollback is simple:
1. Revert the commit
2. Redeploy functions

Both v1 and v2 functions can coexist during migration if needed.

---

**Migration Date:** October 2025  
**Firebase Functions SDK Version:** 5.0.1  
**Node.js Version:** 20
