export type Player = "black" | "white";
export type Cell = Player | null;
export type Board = Cell[][];
export type Move = { row: number; col: number; flips: [number, number][] };

const DIRECTIONS = [
  [-1, -1], [-1, 0], [-1, 1], [0, -1],
  [0, 1], [1, -1], [1, 0], [1, 1],
] as const;

export const otherPlayer = (player: Player): Player => player === "black" ? "white" : "black";

export function createInitialBoard(): Board {
  const board: Board = Array.from({ length: 8 }, () => Array<Cell>(8).fill(null));
  board[3][3] = "white";
  board[3][4] = "black";
  board[4][3] = "black";
  board[4][4] = "white";
  return board;
}

function isOnBoard(row: number, col: number) {
  return row >= 0 && row < 8 && col >= 0 && col < 8;
}

export function getFlips(board: Board, row: number, col: number, player: Player) {
  if (board[row]?.[col] !== null) return [];
  const opponent = otherPlayer(player);
  const allFlips: [number, number][] = [];

  for (const [rowStep, colStep] of DIRECTIONS) {
    const line: [number, number][] = [];
    let nextRow = row + rowStep;
    let nextCol = col + colStep;
    while (isOnBoard(nextRow, nextCol) && board[nextRow][nextCol] === opponent) {
      line.push([nextRow, nextCol]);
      nextRow += rowStep;
      nextCol += colStep;
    }
    if (line.length && isOnBoard(nextRow, nextCol) && board[nextRow][nextCol] === player) {
      allFlips.push(...line);
    }
  }
  return allFlips;
}

export function getValidMoves(board: Board, player: Player): Move[] {
  const moves: Move[] = [];
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const flips = getFlips(board, row, col, player);
      if (flips.length) moves.push({ row, col, flips });
    }
  }
  return moves;
}

export function applyMove(board: Board, move: Move, player: Player): Board {
  const next = board.map((row) => [...row]);
  next[move.row][move.col] = player;
  for (const [row, col] of move.flips) next[row][col] = player;
  return next;
}

export function countPieces(board: Board) {
  let black = 0;
  let white = 0;
  for (const row of board) {
    for (const cell of row) {
      if (cell === "black") black += 1;
      if (cell === "white") white += 1;
    }
  }
  return { black, white };
}
