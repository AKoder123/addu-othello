import {
  applyMove,
  countPieces,
  createInitialBoard,
  getValidMoves,
  otherPlayer,
  type Board,
  type Player,
} from "./gameLogic.ts";

export type RoomStatus = "waiting" | "playing" | "finished";
export type Winner = Player | "draw";

export type RoomData = {
  board: string;
  turn: Player;
  status: RoomStatus;
  notice: string;
  players: {
    black: { name: "Addu"; uid: string };
    white?: { name: "Chellun Kutty"; uid: string };
  };
  winner?: Winner;
  createdAt: number;
  updatedAt: number;
  revision: number;
  rematches: number;
};

export const playerName = (player: Player) => player === "black" ? "Addu" : "Chellun Kutty";

export function encodeBoard(board: Board) {
  return board.flat().map((cell) => cell === "black" ? "b" : cell === "white" ? "w" : "-").join("");
}

export function decodeBoard(value: string): Board {
  if (!/^[bw-]{64}$/.test(value)) throw new Error("Invalid board data");
  return Array.from({ length: 8 }, (_, row) =>
    Array.from({ length: 8 }, (_, col) => {
      const cell = value[row * 8 + col];
      return cell === "b" ? "black" : cell === "w" ? "white" : null;
    }),
  );
}

export function createRoomState(uid: string, now = Date.now()): RoomData {
  return {
    board: encodeBoard(createInitialBoard()),
    turn: "black",
    status: "waiting",
    notice: "Waiting for Chellun Kutty to join.",
    players: { black: { name: "Addu", uid } },
    createdAt: now,
    updatedAt: now,
    revision: 0,
    rematches: 0,
  };
}

export function resolveSide(room: RoomData, uid: string): Player | null {
  if (room.players.black.uid === uid) return "black";
  if (room.players.white?.uid === uid) return "white";
  return null;
}

export function joinRoomState(room: RoomData, uid: string, now = Date.now()): RoomData | null {
  if (resolveSide(room, uid)) return room;
  if (room.players.white || room.status !== "waiting") return null;
  return {
    ...room,
    players: {
      ...room.players,
      white: { name: "Chellun Kutty", uid },
    },
    status: "playing",
    notice: "Addu makes the first move.",
    updatedAt: now,
  };
}

export function reclaimSeat(room: RoomData, uid: string, side: Player, now = Date.now()): RoomData | null {
  const seat = room.players[side];
  if (!seat) return null;
  if (seat.uid === uid) return room;
  return {
    ...room,
    players: {
      ...room.players,
      [side]: { ...seat, uid },
    },
    updatedAt: now,
  };
}

export function playRoomMove(
  room: RoomData,
  row: number,
  col: number,
  side: Player,
  uid: string,
  now = Date.now(),
): RoomData | null {
  if (
    room.status !== "playing" ||
    room.turn !== side ||
    !room.players.white ||
    resolveSide(room, uid) !== side
  ) return null;

  const board = decodeBoard(room.board);
  const move = getValidMoves(board, side).find((candidate) => candidate.row === row && candidate.col === col);
  if (!move) return null;

  const nextBoard = applyMove(board, move, side);
  const opponent = otherPlayer(side);
  const opponentMoves = getValidMoves(nextBoard, opponent);
  const currentMoves = getValidMoves(nextBoard, side);

  let turn = opponent;
  let status: RoomStatus = "playing";
  let notice = `${playerName(side)} placed a piece and turned ${move.flips.length}.`;
  let winner: Winner | undefined;

  if (!opponentMoves.length && currentMoves.length) {
    turn = side;
    notice = `${playerName(opponent)} has no legal move, so their turn is passed.`;
  } else if (!opponentMoves.length && !currentMoves.length) {
    status = "finished";
    const scores = countPieces(nextBoard);
    winner = scores.black === scores.white ? "draw" : scores.black > scores.white ? "black" : "white";
    notice = "No legal moves remain. The game is complete.";
  }

  return {
    ...room,
    board: encodeBoard(nextBoard),
    turn,
    status,
    notice,
    ...(winner ? { winner } : {}),
    updatedAt: now,
    revision: room.revision + 1,
  };
}

export function resetRoom(room: RoomData, uid: string, now = Date.now()): RoomData | null {
  if (!room.players.white || !resolveSide(room, uid)) return null;
  const { winner: _winner, ...roomWithoutWinner } = room;
  return {
    ...roomWithoutWinner,
    board: encodeBoard(createInitialBoard()),
    turn: "black",
    status: "playing",
    notice: "Addu makes the first move.",
    updatedAt: now,
    revision: room.revision + 1,
    rematches: room.rematches + 1,
  };
}

export function isRoomData(value: unknown): value is RoomData {
  if (!value || typeof value !== "object") return false;
  const room = value as Partial<RoomData>;
  return typeof room.board === "string" && /^[bw-]{64}$/.test(room.board)
    && (room.turn === "black" || room.turn === "white")
    && (room.status === "waiting" || room.status === "playing" || room.status === "finished")
    && typeof room.notice === "string"
    && typeof room.players?.black?.uid === "string"
    && typeof room.createdAt === "number"
    && typeof room.updatedAt === "number"
    && typeof room.revision === "number"
    && typeof room.rematches === "number";
}
