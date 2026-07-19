import assert from "node:assert/strict";
import test from "node:test";
import { applyMove, countPieces, createInitialBoard, getValidMoves } from "../app/gameLogic.ts";

test("starts with four pieces and four legal moves for black", () => {
  const board = createInitialBoard();
  assert.deepEqual(countPieces(board), { black: 2, white: 2 });
  assert.deepEqual(getValidMoves(board, "black").map(({ row, col }) => [row, col]), [[2, 3], [3, 2], [4, 5], [5, 4]]);
});

test("a legal opening move places and flips the captured piece", () => {
  const board = createInitialBoard();
  const move = getValidMoves(board, "black").find(({ row, col }) => row === 2 && col === 3);
  assert.ok(move);
  const next = applyMove(board, move, "black");
  assert.equal(next[2][3], "black");
  assert.equal(next[3][3], "black");
  assert.deepEqual(countPieces(next), { black: 4, white: 1 });
});

test("captures pieces in all eight directions at once", () => {
  const board = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (const [row, col] of [[1, 1], [1, 3], [1, 5], [3, 1], [3, 5], [5, 1], [5, 3], [5, 5]]) board[row][col] = "black";
  for (const [row, col] of [[2, 2], [2, 3], [2, 4], [3, 2], [3, 4], [4, 2], [4, 3], [4, 4]]) board[row][col] = "white";
  const move = getValidMoves(board, "black").find(({ row, col }) => row === 3 && col === 3);
  assert.ok(move);
  assert.equal(move.flips.length, 8);
  assert.deepEqual(countPieces(applyMove(board, move, "black")), { black: 17, white: 0 });
});

test("returns no moves when the board is full", () => {
  const board = Array.from({ length: 8 }, () => Array(8).fill("black"));
  assert.equal(getValidMoves(board, "black").length, 0);
  assert.equal(getValidMoves(board, "white").length, 0);
});
