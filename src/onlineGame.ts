import { FirebaseError } from "firebase/app";
import { get, onValue, ref, runTransaction } from "firebase/database";
import { database, firebaseDatabaseUrl } from "./firebase";
import {
  createRoomState,
  isRoomData,
  joinRoomState,
  playRoomMove,
  reclaimSeat,
  resetRoom,
  resolveSide,
  type RoomData,
} from "./multiplayerGame";
import type { Player } from "./gameLogic";

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class RoomError extends Error {
  constructor(
    public kind: "invalid" | "full" | "permission" | "connection",
    message: string,
    public diagnostics?: JoinDiagnostics,
  ) {
    super(message);
  }
}

export type JoinDiagnostics = {
  roomCode: string;
  uid: string;
  firebasePath: string;
  snapshotExists: boolean | null;
  snapshotValue: unknown;
  firebaseErrorCode: string;
  firebaseErrorMessage: string;
  transactionCommitted: boolean | null;
  transactionCallbackValue: unknown;
  transactionSnapshotValue: unknown;
};

export type MoveDiagnostics = {
  firebaseErrorCode: string;
  firebaseErrorMessage: string;
  uid: string;
  side: Player;
  roomCode: string;
  currentTurn: Player;
  firebasePath: string;
  transactionCommitted: boolean | null;
};

export class MoveError extends Error {
  constructor(message: string, public diagnostics: MoveDiagnostics) {
    super(message);
  }
}

const guestJoinsInFlight = new Map<string, Promise<Player>>();

function makeRoomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => ROOM_ALPHABET[byte % ROOM_ALPHABET.length]).join("");
}

function roomReference(roomCode: string) {
  return ref(database, `rooms/${roomCode}`);
}

export function normaliseRoomCode(value: string) {
  return value.trim().toUpperCase();
}

export function roomCodeFromInviteUrl(url: string) {
  const rawRoomCode = new URL(url).searchParams.get("room") ?? "";
  const roomCode = normaliseRoomCode(rawRoomCode);
  console.info("[Othello guest] Invite URL parsed", {
    rawRoomCode: JSON.stringify(rawRoomCode),
    roomCode,
    firebasePath: roomCode ? `/rooms/${roomCode}` : "",
  });
  return roomCode;
}

function firebaseFailure(error: unknown, diagnostics: JoinDiagnostics) {
  const code = error instanceof FirebaseError
    ? error.code
    : typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "unknown";
  const message = error instanceof Error ? error.message : String(error);
  console.error("[Othello guest] Firebase join failed", {
    uid: diagnostics.uid,
    roomCode: diagnostics.roomCode,
    firebasePath: diagnostics.firebasePath,
    databaseURL: firebaseDatabaseUrl,
    code,
    message,
  });

  if (code.toLowerCase().replaceAll("_", "-").includes("permission-denied")) {
    return new RoomError(
      "permission",
      `Firebase denied access to ${diagnostics.firebasePath} (${code}): ${message}`,
      diagnostics,
    );
  }
  return new RoomError("connection", `Firebase join failed (${code}): ${message}`, diagnostics);
}

export async function createOnlineRoom(uid: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const roomCode = makeRoomCode();
    try {
      const result = await runTransaction(
        roomReference(roomCode),
        (current) => current === null ? createRoomState(uid) : undefined,
        { applyLocally: false },
      );
      if (result.committed) return roomCode;
    } catch {
      throw new RoomError("connection", "Could not create the room. Check your Firebase connection and try again.");
    }
  }
  throw new RoomError("connection", "Could not create a unique room. Please try again.");
}

async function performGuestJoin(
  roomCode: string,
  uid: string,
  preferredSide?: Player,
  onDiagnostics?: (diagnostics: JoinDiagnostics) => void,
): Promise<Player> {
  const code = normaliseRoomCode(roomCode);
  let diagnostics: JoinDiagnostics = {
    roomCode: code,
    uid,
    firebasePath: `/rooms/${code}`,
    snapshotExists: null,
    snapshotValue: null,
    firebaseErrorCode: "",
    firebaseErrorMessage: "",
    transactionCommitted: null,
    transactionCallbackValue: null,
    transactionSnapshotValue: null,
  };
  const updateDiagnostics = (changes: Partial<JoinDiagnostics>) => {
    diagnostics = { ...diagnostics, ...changes };
    onDiagnostics?.(diagnostics);
  };
  updateDiagnostics({});

  if (!/^[A-Z2-9]{8}$/.test(code)) {
    console.error("[Othello guest] Rejected malformed room code", {
      received: JSON.stringify(roomCode),
      parsed: JSON.stringify(code),
    });
    const message = `This invitation link has an invalid room code (${JSON.stringify(code)}).`;
    updateDiagnostics({ firebaseErrorCode: "invalid-room-code", firebaseErrorMessage: message });
    throw new RoomError("invalid", message, diagnostics);
  }

  try {
    console.info("[Othello guest] Reading room before join", {
      uid,
      roomCode: code,
      firebasePath: `/rooms/${code}`,
      databaseURL: firebaseDatabaseUrl,
    });
    const beforeJoin = await get(roomReference(code));
    const snapshotValue = beforeJoin.val();
    updateDiagnostics({
      snapshotExists: beforeJoin.exists(),
      snapshotValue,
    });
    console.info("[Othello guest] Initial room read completed", {
      uid,
      roomCode: code,
      firebasePath: `/rooms/${code}`,
      exists: beforeJoin.exists(),
    });
    if (!beforeJoin.exists()) {
      const message = `Room ${code} does not exist or is no longer available.`;
      updateDiagnostics({ firebaseErrorCode: "snapshot-not-found", firebaseErrorMessage: message });
      throw new RoomError("invalid", message, diagnostics);
    }
    if (!isRoomData(snapshotValue)) {
      const message = `Room ${code} exists, but its data is not compatible with this game version.`;
      updateDiagnostics({ firebaseErrorCode: "invalid-room-data", firebaseErrorMessage: message });
      throw new RoomError("invalid", message, diagnostics);
    }

    const existingSide = resolveSide(snapshotValue, uid);
    if (existingSide) {
      updateDiagnostics({ transactionCommitted: false });
      return existingSide;
    }

    // The player holds no seat under this uid. That happens the first time a
    // guest joins, but also when a returning player's anonymous session was
    // cleared (e.g. Safari Private Browsing) and Firebase issued them a fresh
    // uid. In the latter case we reclaim the seat they previously held rather
    // than rejecting them as a stranger. A saved side (from localStorage) is
    // authoritative; without one, an occupied white seat is treated as a
    // returning guest reclaiming white.
    const reclaimTarget: Player | null =
      preferredSide && snapshotValue.players[preferredSide]
        ? preferredSide
        : !preferredSide && snapshotValue.players.white
          ? "white"
          : null;

    if (reclaimTarget) {
      let reclaimCallbacks = 0;
      const reclaimResult = await runTransaction(
        roomReference(code),
        (current) => {
          reclaimCallbacks += 1;
          const currentRoom = isRoomData(current)
            ? current
            : current === null && reclaimCallbacks === 1
              ? snapshotValue
              : null;
          if (!currentRoom) return undefined;
          if (resolveSide(currentRoom, uid) === reclaimTarget) return currentRoom;
          return reclaimSeat(currentRoom, uid, reclaimTarget) ?? undefined;
        },
        { applyLocally: false },
      );
      const reclaimed = reclaimResult.snapshot.val();
      updateDiagnostics({ transactionCommitted: reclaimResult.committed, transactionSnapshotValue: reclaimed });
      if (isRoomData(reclaimed) && resolveSide(reclaimed, uid) === reclaimTarget) return reclaimTarget;
      const message = "This room already has a different white player.";
      updateDiagnostics({ firebaseErrorCode: "reclaim-failed", firebaseErrorMessage: message });
      throw new RoomError("full", message, diagnostics);
    }

    if (snapshotValue.players.white) {
      const message = "This room already has a different white player.";
      updateDiagnostics({ firebaseErrorCode: "room-full", firebaseErrorMessage: message });
      throw new RoomError("full", message, diagnostics);
    }

    let callbackCount = 0;
    const result = await runTransaction(
      roomReference(code),
      (current) => {
        callbackCount += 1;
        updateDiagnostics({ transactionCallbackValue: current });

        // A transaction's first local callback can receive null even after get()
        // has successfully read the room. Seed that first proposal from the
        // validated server snapshot; Firebase will retry with the authoritative
        // value before committing if the server has changed.
        const currentRoom = isRoomData(current)
          ? current
          : current === null && callbackCount === 1
            ? snapshotValue
            : null;
        if (!currentRoom) return undefined;
        return joinRoomState(currentRoom, uid) ?? undefined;
      },
      { applyLocally: false },
    );
    const room = result.snapshot.val();
    updateDiagnostics({
      transactionCommitted: result.committed,
      transactionSnapshotValue: room,
    });
    if (!isRoomData(room)) {
      const message = "The join transaction returned invalid room data.";
      updateDiagnostics({ firebaseErrorCode: "invalid-transaction-snapshot", firebaseErrorMessage: message });
      throw new RoomError("connection", message, diagnostics);
    }
    const side = resolveSide(room, uid);
    if (side) return side;
    if (room.players.white?.uid !== uid) {
      const message = "This room already has a different white player.";
      updateDiagnostics({ firebaseErrorCode: "room-full", firebaseErrorMessage: message });
      throw new RoomError("full", message, diagnostics);
    }
    const message = `The join transaction did not assign this guest (committed: ${result.committed}).`;
    updateDiagnostics({ firebaseErrorCode: "join-not-assigned", firebaseErrorMessage: message });
    throw new RoomError("connection", message, diagnostics);
  } catch (error) {
    if (error instanceof RoomError) throw error;
    const code = error instanceof FirebaseError
      ? error.code
      : typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "unknown";
    const message = error instanceof Error ? error.message : String(error);
    updateDiagnostics({ firebaseErrorCode: code, firebaseErrorMessage: message });
    throw firebaseFailure(error, diagnostics);
  }
}

export function joinOnlineRoom(
  roomCode: string,
  uid: string,
  preferredSide?: Player,
  onDiagnostics?: (diagnostics: JoinDiagnostics) => void,
): Promise<Player> {
  const code = normaliseRoomCode(roomCode);
  const attemptKey = `${code}:${uid}`;
  const existingAttempt = guestJoinsInFlight.get(attemptKey);
  if (existingAttempt) return existingAttempt;

  const attempt = performGuestJoin(code, uid, preferredSide, onDiagnostics).finally(() => {
    guestJoinsInFlight.delete(attemptKey);
  });
  guestJoinsInFlight.set(attemptKey, attempt);
  return attempt;
}

export function subscribeToRoom(
  roomCode: string,
  onRoom: (room: RoomData) => void,
  onError: () => void,
) {
  return onValue(
    roomReference(roomCode),
    (snapshot) => {
      const room = snapshot.val();
      if (isRoomData(room)) onRoom(room);
      else onError();
    },
    onError,
  );
}

export function subscribeToConnection(onConnection: (connected: boolean) => void) {
  return onValue(ref(database, ".info/connected"), (snapshot) => onConnection(snapshot.val() === true));
}

export async function submitOnlineMove(
  roomCode: string,
  row: number,
  col: number,
  side: Player,
  uid: string,
  currentTurn: Player,
  onDiagnostics?: (diagnostics: MoveDiagnostics) => void,
) {
  const code = normaliseRoomCode(roomCode);
  const roomRef = roomReference(code);
  let diagnostics: MoveDiagnostics = {
    firebaseErrorCode: "",
    firebaseErrorMessage: "",
    uid,
    side,
    roomCode: code,
    currentTurn,
    firebasePath: `/rooms/${code}`,
    transactionCommitted: null,
  };
  const updateDiagnostics = (changes: Partial<MoveDiagnostics>) => {
    diagnostics = { ...diagnostics, ...changes };
    onDiagnostics?.(diagnostics);
  };

  try {
    console.info("[Othello move] Reading latest room before transaction", diagnostics);
    const latestSnapshot = await get(roomRef);
    const latestRoom = latestSnapshot.val();
    if (!latestSnapshot.exists() || !isRoomData(latestRoom)) {
      const message = "The latest server room is missing or invalid.";
      updateDiagnostics({ firebaseErrorCode: "invalid-room-snapshot", firebaseErrorMessage: message });
      throw new MoveError(message, diagnostics);
    }
    updateDiagnostics({ currentTurn: latestRoom.turn });

    if (resolveSide(latestRoom, uid) !== side) {
      const message = `Authenticated UID ${uid} is not the stored ${side} player.`;
      updateDiagnostics({ firebaseErrorCode: "player-uid-mismatch", firebaseErrorMessage: message });
      throw new MoveError(message, diagnostics);
    }
    if (latestRoom.turn !== side) {
      const message = `The server turn is ${latestRoom.turn}, not ${side}.`;
      updateDiagnostics({ firebaseErrorCode: "stale-turn", firebaseErrorMessage: message });
      throw new MoveError(message, diagnostics);
    }
    if (!playRoomMove(latestRoom, row, col, side, uid)) {
      const message = "The selected move is not legal in the latest server room.";
      updateDiagnostics({ firebaseErrorCode: "illegal-server-move", firebaseErrorMessage: message });
      throw new MoveError(message, diagnostics);
    }

    let callbackCount = 0;
    const result = await runTransaction(
      roomRef,
      (current) => {
        callbackCount += 1;
        const currentRoom = isRoomData(current)
          ? current
          : current === null && callbackCount === 1
            ? latestRoom
            : null;
        if (!currentRoom || resolveSide(currentRoom, uid) !== side || currentRoom.turn !== side) return undefined;
        return playRoomMove(currentRoom, row, col, side, uid) ?? undefined;
      },
      { applyLocally: false },
    );
    updateDiagnostics({ transactionCommitted: result.committed });
    if (!result.committed) {
      const message = "Firebase did not commit the move transaction.";
      updateDiagnostics({ firebaseErrorCode: "transaction-not-committed", firebaseErrorMessage: message });
      throw new MoveError(message, diagnostics);
    }
    console.info("[Othello move] Transaction committed", diagnostics);
    return true;
  } catch (error) {
    if (error instanceof MoveError) throw error;
    const errorCode = error instanceof FirebaseError
      ? error.code
      : typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "unknown";
    const errorMessage = error instanceof Error ? error.message : String(error);
    updateDiagnostics({ firebaseErrorCode: errorCode, firebaseErrorMessage: errorMessage });
    console.error("[Othello move] Firebase transaction failed", diagnostics);
    throw new MoveError(`Move transaction failed (${errorCode}): ${errorMessage}`, diagnostics);
  }
}

export async function requestOnlineRematch(roomCode: string, uid: string) {
  try {
    const result = await runTransaction(
      roomReference(roomCode),
      (current) => isRoomData(current) ? resetRoom(current, uid) ?? undefined : undefined,
      { applyLocally: false },
    );
    return result.committed;
  } catch {
    throw new RoomError("connection", "The rematch could not be started. Please try again.");
  }
}

export function makeInviteLink(roomCode: string) {
  const invite = new URL(window.location.origin + window.location.pathname);
  invite.searchParams.set("room", roomCode);
  return invite.toString();
}
