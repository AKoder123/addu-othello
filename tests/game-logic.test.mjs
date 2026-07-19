import assert from "node:assert/strict";
import test from "node:test";
import { applyMove, countPieces, createInitialBoard, getValidMoves } from "../src/gameLogic.ts";
import {
  createRoomState,
  decodeBoard,
  joinRoomState,
  playRoomMove,
  resetRoom,
  resolveSide,
} from "../src/multiplayerGame.ts";

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

test("assigns the creator to black and the invitee to white", () => {
  const waitingRoom = createRoomState("addu-device", 1);
  assert.equal(waitingRoom.status, "waiting");
  assert.equal(resolveSide(waitingRoom, "addu-device"), "black");

  const joinedRoom = joinRoomState(waitingRoom, "chellun-device", 2);
  assert.ok(joinedRoom);
  assert.equal(joinedRoom.status, "playing");
  assert.equal(resolveSide(joinedRoom, "chellun-device"), "white");
  assert.equal(joinRoomState(joinedRoom, "chellun-device"), joinedRoom);
  assert.equal(joinRoomState(joinedRoom, "third-device"), null);
});

test("online moves enforce turn, identity, and the existing legal-move rules", () => {
  const room = joinRoomState(createRoomState("addu-device", 1), "chellun-device", 2);
  assert.ok(room);
  assert.equal(playRoomMove(room, 2, 3, "white", "chellun-device"), null);
  assert.equal(playRoomMove(room, 0, 0, "black", "addu-device"), null);

  const moved = playRoomMove(room, 2, 3, "black", "addu-device", 3);
  assert.ok(moved);
  assert.equal(moved.turn, "white");
  assert.deepEqual(countPieces(decodeBoard(moved.board)), { black: 4, white: 1 });
  assert.equal(playRoomMove(moved, 2, 3, "black", "addu-device", 4), null);

  const whiteMove = getValidMoves(decodeBoard(moved.board), "white")[0];
  const replied = playRoomMove(moved, whiteMove.row, whiteMove.col, "white", "chellun-device", 5);
  assert.ok(replied);
  assert.equal(replied.turn, "black");
  assert.equal(replied.revision, 2);
});

test("a rematch resets the same room for both players", () => {
  const room = joinRoomState(createRoomState("addu-device", 1), "chellun-device", 2);
  assert.ok(room);
  const moved = playRoomMove(room, 2, 3, "black", "addu-device", 3);
  assert.ok(moved);
  const reset = resetRoom(moved, "chellun-device", 4);
  assert.ok(reset);
  assert.equal(reset.turn, "black");
  assert.equal(reset.status, "playing");
  assert.equal(reset.rematches, 1);
  assert.deepEqual(countPieces(decodeBoard(reset.board)), { black: 2, white: 2 });
});
