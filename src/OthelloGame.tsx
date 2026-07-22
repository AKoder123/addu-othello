import { useEffect, useMemo, useRef, useState } from "react";
import { countPieces, getValidMoves, type Player } from "./gameLogic";
import { getPlayerUid } from "./firebase";
import { decodeBoard, playerName, type RoomData } from "./multiplayerGame";
import {
  RoomError,
  MoveError,
  createOnlineRoom,
  joinOnlineRoom,
  makeInviteLink,
  requestOnlineRematch,
  roomCodeFromInviteUrl,
  submitOnlineMove,
  subscribeToConnection,
  subscribeToRoom,
  type JoinDiagnostics,
  type MoveDiagnostics,
} from "./onlineGame";

const COLUMNS = "ABCDEFGH";
type View = "home" | "joining" | "waiting" | "game" | "error";

function identityKey(roomCode: string) {
  return `nocturne-player-${roomCode}`;
}

function saveIdentity(roomCode: string, uid: string, side: Player) {
  localStorage.setItem(identityKey(roomCode), JSON.stringify({ uid, side }));
}

function loadIdentity(roomCode: string): { uid: string; side: Player } | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(identityKey(roomCode)) ?? "null");
    if (parsed && typeof parsed.uid === "string" && (parsed.side === "black" || parsed.side === "white")) {
      return { uid: parsed.uid, side: parsed.side };
    }
  } catch {
    // Ignore malformed identity data and fall back to a fresh join.
  }
  return null;
}

function friendlyError(error: unknown) {
  if (error instanceof RoomError || error instanceof MoveError) return error.message;
  return "Firebase could not be reached. Please check the setup and try again.";
}

export function OthelloGame() {
  const invitationCode = useMemo(() => roomCodeFromInviteUrl(window.location.href), []);
  const [view, setView] = useState<View>(invitationCode ? "joining" : "home");
  const [roomCode, setRoomCode] = useState(invitationCode);
  const [room, setRoom] = useState<RoomData | null>(null);
  const [side, setSide] = useState<Player | null>(null);
  const [uid, setUid] = useState("");
  const [connected, setConnected] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [localNotice, setLocalNotice] = useState("");
  const [joinDiagnostics, setJoinDiagnostics] = useState<JoinDiagnostics>({
    roomCode: invitationCode,
    uid: "",
    firebasePath: invitationCode ? `/rooms/${invitationCode}` : "",
    snapshotExists: null,
    snapshotValue: null,
    firebaseErrorCode: "",
    firebaseErrorMessage: "",
    transactionCommitted: null,
    transactionCallbackValue: null,
    transactionSnapshotValue: null,
  });
  const [moveDiagnostics, setMoveDiagnostics] = useState<MoveDiagnostics | null>(null);
  const roomUnsubscribe = useRef<(() => void) | null>(null);
  const invitationHandled = useRef(false);
  const joinAttemptKey = useRef("");
  const movePending = useRef(false);

  useEffect(() => subscribeToConnection(setConnected), []);
  useEffect(() => () => roomUnsubscribe.current?.(), []);

  function watchRoom(code: string) {
    roomUnsubscribe.current?.();
    roomUnsubscribe.current = subscribeToRoom(
      code,
      (nextRoom) => {
        setRoom(nextRoom);
        setLocalNotice("");
        setView(nextRoom.players.white ? "game" : "waiting");
      },
      () => {
        setErrorMessage("The room connection was lost or this room is no longer available.");
        setView("error");
      },
    );
  }

  async function joinInvitation(code: string) {
    setView("joining");
    setErrorMessage("");
    try {
      const playerUid = await getPlayerUid();
      const attemptKey = `${code}:${playerUid}`;
      if (joinAttemptKey.current === attemptKey) return;
      joinAttemptKey.current = attemptKey;
      setJoinDiagnostics((current) => ({ ...current, roomCode: code, uid: playerUid, firebasePath: `/rooms/${code}` }));
      console.info("[Othello guest] Anonymous authentication complete", {
        uid: playerUid,
        roomCode: code,
      });
      const playerSide = await joinOnlineRoom(code, playerUid, loadIdentity(code)?.side, setJoinDiagnostics);
      saveIdentity(code, playerUid, playerSide);
      setUid(playerUid);
      setSide(playerSide);
      setRoomCode(code);
      watchRoom(code);
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "unknown";
      const message = error instanceof Error ? error.message : String(error);
      setJoinDiagnostics((current) => ({
        ...(error instanceof RoomError && error.diagnostics ? error.diagnostics : current),
        firebaseErrorCode: error instanceof RoomError && error.diagnostics?.firebaseErrorCode
          ? error.diagnostics.firebaseErrorCode
          : code,
        firebaseErrorMessage: error instanceof RoomError && error.diagnostics?.firebaseErrorMessage
          ? error.diagnostics.firebaseErrorMessage
          : message,
      }));
      setErrorMessage(friendlyError(error));
      setView("error");
    }
  }

  useEffect(() => {
    if (!invitationCode || invitationHandled.current) return;
    invitationHandled.current = true;
    void joinInvitation(invitationCode);
  }, [invitationCode]);

  async function createGame() {
    if (busy) return;
    setBusy(true);
    setErrorMessage("");
    try {
      const playerUid = await getPlayerUid();
      const code = await createOnlineRoom(playerUid);
      saveIdentity(code, playerUid, "black");
      window.history.replaceState({}, "", makeInviteLink(code));
      setUid(playerUid);
      setSide("black");
      setRoomCode(code);
      watchRoom(code);
    } catch (error) {
      setErrorMessage(friendlyError(error));
      setView("error");
    } finally {
      setBusy(false);
    }
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(makeInviteLink(roomCode));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setLocalNotice("The link could not be copied. Select it below and copy it manually.");
    }
  }

  function leaveRoom() {
    roomUnsubscribe.current?.();
    roomUnsubscribe.current = null;
    window.history.replaceState({}, "", window.location.pathname);
    setRoom(null);
    setRoomCode("");
    setSide(null);
    setLocalNotice("");
    setErrorMessage("");
    setView("home");
  }

  const board = useMemo(() => room ? decodeBoard(room.board) : null, [room]);
  const validMoves = useMemo(() => board && room ? getValidMoves(board, room.turn) : [], [board, room]);
  const moveMap = useMemo(() => new Map(validMoves.map((move) => [`${move.row}-${move.col}`, move])), [validMoves]);
  const scores = useMemo(() => board ? countPieces(board) : { black: 2, white: 2 }, [board]);
  const spacesLeft = 64 - scores.black - scores.white;
  const isMyTurn = Boolean(room && side && room.status === "playing" && room.turn === side);

  async function playMove(row: number, col: number) {
    if (!room || !side || !uid || !isMyTurn || !connected || busy || movePending.current) return;
    movePending.current = true;
    setBusy(true);
    setLocalNotice("");
    setMoveDiagnostics(null);
    try {
      const accepted = await submitOnlineMove(roomCode, row, col, side, uid, room.turn, setMoveDiagnostics);
      if (!accepted) setLocalNotice("That move is no longer available. The board has been refreshed.");
    } catch (error) {
      if (error instanceof MoveError) setMoveDiagnostics(error.diagnostics);
      setLocalNotice(friendlyError(error));
    } finally {
      movePending.current = false;
      setBusy(false);
    }
  }

  async function rematch() {
    if (!uid || busy) return;
    setBusy(true);
    setLocalNotice("");
    try {
      const accepted = await requestOnlineRematch(roomCode, uid);
      if (!accepted) setLocalNotice("The rematch could not be started.");
    } catch (error) {
      setLocalNotice(friendlyError(error));
    } finally {
      setBusy(false);
    }
  }

  const winner = room?.winner === "draw"
    ? "A perfect draw"
    : room?.winner
      ? `${playerName(room.winner)} wins`
      : scores.black === scores.white
        ? "A perfect draw"
        : `${playerName(scores.black > scores.white ? "black" : "white")} wins`;

  return (
    <main className="game-shell">
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />

      <header className="brand">
        <div className="brand-mark" aria-hidden="true"><span /><span /></div>
        <div className="brand-copy">
          <p className="eyebrow">A game for two</p>
          <h1>Nocturne</h1>
          <p className="matchup">Addu vs Chellun Kutty</p>
        </div>
        {view !== "home" && (
          <span className={`connection-pill ${connected ? "online" : "offline"}`}>
            <span aria-hidden="true" />{connected ? "Connected" : "Connecting"}
          </span>
        )}
      </header>

      {view === "home" && (
        <section className="lobby-card" aria-labelledby="welcome-title">
          <p className="section-label">Private online match</p>
          <h2 id="welcome-title">An evening of Othello,<br />wherever you are.</h2>
          <p>Create a private room for Addu and share the invitation with Chellun Kutty.</p>
          <div className="lobby-pair" aria-label="Players">
            <span><i className="mini-piece black" />Addu</span>
            <b>vs</b>
            <span><i className="mini-piece white" />Chellun Kutty</span>
          </div>
          <button className="primary-button" type="button" onClick={createGame} disabled={busy}>
            {busy ? "Creating your room…" : "Create Game"}
          </button>
        </section>
      )}

      {view === "joining" && (
        <section className="lobby-card status-card" aria-live="polite">
          <div className="loading-rings" aria-hidden="true"><span /><span /></div>
          <p className="section-label">Invitation found</p>
          <h2>Joining the match…</h2>
          <p>Preparing Chellun Kutty’s white pieces.</p>
        </section>
      )}

      {view === "waiting" && (
        <section className="lobby-card waiting-card" aria-live="polite">
          <p className="section-label">Room {roomCode}</p>
          <h2>Your table is ready.</h2>
          <p>Addu is seated with the black pieces. Send this private invitation to Chellun Kutty.</p>
          <div className="invite-field">
            <input aria-label="Invitation link" value={makeInviteLink(roomCode)} readOnly />
            <button type="button" onClick={copyInvite}>{copied ? "Copied!" : "Copy Invite Link"}</button>
          </div>
          <div className="waiting-line"><span className="waiting-dot" /> Waiting for Chellun Kutty to join…</div>
          <button className="text-button" type="button" onClick={leaveRoom}>Back to home</button>
        </section>
      )}

      {view === "error" && (
        <section className="lobby-card status-card" role="alert">
          <p className="section-label">Unable to join</p>
          <h2>This match can’t be opened.</h2>
          <p>{errorMessage}</p>
          <div className="join-diagnostics" aria-label="Temporary guest join diagnostics">
            <strong>Temporary join diagnostics</strong>
            <dl>
              <div><dt>Parsed room code</dt><dd>{joinDiagnostics.roomCode || "(empty)"}</dd></div>
              <div><dt>Authenticated UID</dt><dd>{joinDiagnostics.uid || "(authentication did not complete)"}</dd></div>
              <div><dt>Firebase path</dt><dd>{joinDiagnostics.firebasePath || "(not created)"}</dd></div>
              <div><dt>snapshot.exists()</dt><dd>{joinDiagnostics.snapshotExists === null ? "not read" : String(joinDiagnostics.snapshotExists)}</dd></div>
              <div><dt>Firebase error code</dt><dd>{joinDiagnostics.firebaseErrorCode || "(none)"}</dd></div>
              <div><dt>Firebase error message</dt><dd>{joinDiagnostics.firebaseErrorMessage || "(none)"}</dd></div>
              <div><dt>Transaction committed</dt><dd>{joinDiagnostics.transactionCommitted === null ? "not run" : String(joinDiagnostics.transactionCommitted)}</dd></div>
            </dl>
            <p>snapshot.val()</p>
            <pre>{joinDiagnostics.snapshotValue === null ? "null" : JSON.stringify(joinDiagnostics.snapshotValue, null, 2)}</pre>
            <p>Transaction callback value</p>
            <pre>{joinDiagnostics.transactionCallbackValue === null ? "null" : JSON.stringify(joinDiagnostics.transactionCallbackValue, null, 2)}</pre>
            <p>Transaction snapshot value</p>
            <pre>{joinDiagnostics.transactionSnapshotValue === null ? "null" : JSON.stringify(joinDiagnostics.transactionSnapshotValue, null, 2)}</pre>
          </div>
          <button className="primary-button" type="button" onClick={leaveRoom}>Return Home</button>
        </section>
      )}

      {view === "game" && room && board && side && (
        <section className="game-layout" aria-label="Online Othello game">
          <aside className="game-panel">
            <div className="room-strip">
              <span>Room</span><strong>{roomCode}</strong><em>{side === "black" ? "You are Addu" : "You are Chellun Kutty"}</em>
            </div>
            <div className="turn-card" aria-live="polite">
              <p className="section-label">Now playing</p>
              <div className="turn-line">
                <span className={`mini-piece ${room.turn}`} aria-hidden="true" />
                <h2>{room.status === "finished" ? "Game complete" : `${playerName(room.turn)}’s turn`}</h2>
              </div>
              <p className="turn-note">
                {room.status === "finished" ? winner : isMyTurn ? `Your turn · ${validMoves.length} ${validMoves.length === 1 ? "move" : "moves"}` : `Waiting for ${playerName(room.turn)}`}
              </p>
            </div>

            <div className="score-card">
              <p className="section-label">The score</p>
              <div className="scores">
                <div className={room.turn === "black" && room.status !== "finished" ? "score active" : "score"}>
                  <span className="mini-piece black" aria-hidden="true" /><span>Addu</span><strong>{scores.black}</strong>
                </div>
                <div className={room.turn === "white" && room.status !== "finished" ? "score active" : "score"}>
                  <span className="mini-piece white" aria-hidden="true" /><span>Chellun Kutty</span><strong>{scores.white}</strong>
                </div>
              </div>
              <p className="spaces-left">{spacesLeft} spaces remain</p>
            </div>

            <div className="panel-actions">
              <button className="restart-button" type="button" onClick={copyInvite}>{copied ? "Invite copied" : "Copy invite link"}</button>
              <button className="text-button" type="button" onClick={leaveRoom}>Leave room</button>
            </div>
          </aside>

          <div className="board-column">
            <div className="board-wrap">
              <div className="column-labels" aria-hidden="true">{[...COLUMNS].map((letter) => <span key={letter}>{letter}</span>)}</div>
              <div className="board-row">
                <div className="row-labels" aria-hidden="true">{Array.from({ length: 8 }, (_, index) => <span key={index}>{index + 1}</span>)}</div>
                <div className={`board${!isMyTurn ? " board-waiting" : ""}`} role="grid" aria-label="Othello board">
                  {board.map((row, rowIndex) => row.map((cell, colIndex) => {
                    const move = moveMap.get(`${rowIndex}-${colIndex}`);
                    const coordinate = `${COLUMNS[colIndex]}${rowIndex + 1}`;
                    return (
                      <button
                        className={`cell${move ? " legal" : ""}`}
                        key={coordinate}
                        type="button"
                        role="gridcell"
                        disabled={!move || !isMyTurn || !connected || busy}
                        onClick={() => playMove(rowIndex, colIndex)}
                        aria-label={cell ? `${coordinate}, ${playerName(cell)} piece` : move ? `${coordinate}, legal move for ${playerName(room.turn)}, captures ${move.flips.length}` : `${coordinate}, empty`}
                      >
                        {cell && (
                          <span className={`piece ${cell}`} aria-hidden="true">
                            <span className="coin">
                              <span className="coin-face black" />
                              <span className="coin-face white" />
                            </span>
                          </span>
                        )}
                        {move && room.status !== "finished" && <span className="move-hint" aria-hidden="true" />}
                      </button>
                    );
                  }))}
                </div>
              </div>
            </div>

            <p className="game-notice" aria-live="polite">{localNotice || room.notice}</p>

            {moveDiagnostics?.firebaseErrorMessage && (
              <div className="join-diagnostics move-diagnostics" role="alert" aria-label="Temporary move diagnostics">
                <strong>Temporary move diagnostics</strong>
                <dl>
                  <div><dt>Firebase error code</dt><dd>{moveDiagnostics.firebaseErrorCode || "(none)"}</dd></div>
                  <div><dt>Firebase error message</dt><dd>{moveDiagnostics.firebaseErrorMessage}</dd></div>
                  <div><dt>Authenticated UID</dt><dd>{moveDiagnostics.uid}</dd></div>
                  <div><dt>Player side</dt><dd>{moveDiagnostics.side}</dd></div>
                  <div><dt>Room code</dt><dd>{moveDiagnostics.roomCode}</dd></div>
                  <div><dt>Current server turn</dt><dd>{moveDiagnostics.currentTurn}</dd></div>
                  <div><dt>Firebase path</dt><dd>{moveDiagnostics.firebasePath}</dd></div>
                  <div><dt>Transaction committed</dt><dd>{moveDiagnostics.transactionCommitted === null ? "not completed" : String(moveDiagnostics.transactionCommitted)}</dd></div>
                </dl>
              </div>
            )}

            {room.status === "finished" && (
              <div className="result-card" role="status">
                <p className="eyebrow">Final score · {scores.black}—{scores.white}</p>
                <h2>{winner}</h2>
                <p>{room.winner === "draw" ? "Some evenings are meant to be shared." : "A beautifully played match."}</p>
                <button type="button" onClick={rematch} disabled={busy}>{busy ? "Starting…" : "Play a rematch"}</button>
              </div>
            )}
          </div>
        </section>
      )}

      <footer>Stay awhile. Take your turn.</footer>
    </main>
  );
}
