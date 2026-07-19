"use client";

import { useMemo, useState } from "react";
import { applyMove, countPieces, createInitialBoard, getValidMoves, otherPlayer, type Board, type Player } from "./gameLogic";

const COLUMNS = "ABCDEFGH";
const playerLabel = (player: Player) => player === "black" ? "Black" : "White";

export function OthelloGame() {
  const [board, setBoard] = useState<Board>(() => createInitialBoard());
  const [turn, setTurn] = useState<Player>("black");
  const [isFinished, setIsFinished] = useState(false);
  const [notice, setNotice] = useState("Black makes the first move.");

  const validMoves = useMemo(() => getValidMoves(board, turn), [board, turn]);
  const moveMap = useMemo(() => new Map(validMoves.map((move) => [`${move.row}-${move.col}`, move])), [validMoves]);
  const scores = useMemo(() => countPieces(board), [board]);
  const spacesLeft = 64 - scores.black - scores.white;

  function playMove(row: number, col: number) {
    if (isFinished) return;
    const move = moveMap.get(`${row}-${col}`);
    if (!move) return;

    const nextBoard = applyMove(board, move, turn);
    const opponent = otherPlayer(turn);
    const opponentMoves = getValidMoves(nextBoard, opponent);
    const currentMoves = getValidMoves(nextBoard, turn);
    setBoard(nextBoard);

    if (opponentMoves.length) {
      setTurn(opponent);
      setNotice(`${playerLabel(turn)} placed a piece and turned ${move.flips.length}.`);
    } else if (currentMoves.length) {
      setNotice(`${playerLabel(opponent)} has no legal move, so their turn is passed.`);
    } else {
      setIsFinished(true);
      setNotice("No legal moves remain. The game is complete.");
    }
  }

  function restart() {
    setBoard(createInitialBoard());
    setTurn("black");
    setIsFinished(false);
    setNotice("Black makes the first move.");
  }

  const winner = scores.black === scores.white ? "A perfect draw" : `${scores.black > scores.white ? "Black" : "White"} wins`;

  return (
    <main className="game-shell">
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />

      <header className="brand">
        <div className="brand-mark" aria-hidden="true"><span /><span /></div>
        <div><p className="eyebrow">A game for two</p><h1>Nocturne</h1></div>
      </header>

      <section className="game-layout" aria-label="Othello game">
        <aside className="game-panel">
          <div className="turn-card" aria-live="polite">
            <p className="section-label">Now playing</p>
            <div className="turn-line">
              <span className={`mini-piece ${turn}`} aria-hidden="true" />
              <h2>{isFinished ? "Game complete" : `${playerLabel(turn)}’s turn`}</h2>
            </div>
            <p className="turn-note">{isFinished ? winner : `${validMoves.length} ${validMoves.length === 1 ? "move" : "moves"} available`}</p>
          </div>

          <div className="score-card">
            <p className="section-label">The score</p>
            <div className="scores">
              <div className={turn === "black" && !isFinished ? "score active" : "score"}>
                <span className="mini-piece black" aria-hidden="true" /><span>Black</span><strong>{scores.black}</strong>
              </div>
              <div className={turn === "white" && !isFinished ? "score active" : "score"}>
                <span className="mini-piece white" aria-hidden="true" /><span>White</span><strong>{scores.white}</strong>
              </div>
            </div>
            <p className="spaces-left">{spacesLeft} spaces remain</p>
          </div>

          <div className="rules-note">
            <p className="section-label">How to play</p>
            <p>Choose a glowing space to surround your opponent’s pieces. Every piece caught in between becomes yours.</p>
          </div>

          <button className="restart-button" type="button" onClick={restart}><span aria-hidden="true">↻</span> Restart game</button>
        </aside>

        <div className="board-column">
          <div className="board-wrap">
            <div className="column-labels" aria-hidden="true">{[...COLUMNS].map((letter) => <span key={letter}>{letter}</span>)}</div>
            <div className="board-row">
              <div className="row-labels" aria-hidden="true">{Array.from({ length: 8 }, (_, index) => <span key={index}>{index + 1}</span>)}</div>
              <div className="board" role="grid" aria-label="Othello board">
                {board.map((row, rowIndex) => row.map((cell, colIndex) => {
                  const move = moveMap.get(`${rowIndex}-${colIndex}`);
                  const coordinate = `${COLUMNS[colIndex]}${rowIndex + 1}`;
                  return (
                    <button
                      className={`cell${move ? " legal" : ""}`}
                      key={coordinate}
                      type="button"
                      role="gridcell"
                      disabled={!move || isFinished}
                      onClick={() => playMove(rowIndex, colIndex)}
                      aria-label={cell ? `${coordinate}, ${cell} piece` : move ? `${coordinate}, legal move, captures ${move.flips.length}` : `${coordinate}, empty`}
                    >
                      {cell && <span className={`piece ${cell}`} aria-hidden="true" />}
                      {move && !isFinished && <span className="move-hint" aria-hidden="true" />}
                    </button>
                  );
                }))}
              </div>
            </div>
          </div>

          <p className="game-notice" aria-live="polite">{notice}</p>

          {isFinished && (
            <div className="result-card" role="status">
              <p className="eyebrow">Final score · {scores.black}—{scores.white}</p>
              <h2>{winner}</h2>
              <p>{scores.black === scores.white ? "Some evenings are meant to be shared." : "A beautifully played match."}</p>
              <button type="button" onClick={restart}>Play again</button>
            </div>
          )}
        </div>
      </section>

      <footer>Stay awhile. Take your turn.</footer>
    </main>
  );
}
