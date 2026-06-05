import React, { useState } from 'react';
import { CardsGameState, Card } from '../types';
import { ShieldCheck, HelpCircle, RefreshCw, Layers, Trophy, Play } from 'lucide-react';
import { db } from '../utils/firebase';
import { ref, update, runTransaction } from 'firebase/database';

interface SpadesGameProps {
  cardsGameState: CardsGameState;
  myName: string;
  onPushSystemMessage: (text: string) => void;
  onOpenResetModal: () => void;
}

const SUIT_EMOJIS: Record<string, string> = { 'S': '♠️', 'H': '♥️', 'D': '♦️', 'C': '♣️' };
const RANK_LABELS: Record<number, string> = {
  14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: '10', 9: '9', 8: '8', 7: '7',
  6: '6', 5: '5', 4: '4', 3: '3', 2: '2'
};

export const SpadesGame: React.FC<SpadesGameProps> = ({
  cardsGameState,
  myName,
  onPushSystemMessage,
  onOpenResetModal
}) => {
  const [deckCount, setDeckCount] = useState<2 | 3>(2);

  const initGame = (playerCount: 2 | 3) => {
    let deck: Card[] = [];
    const suits: Array<'S' | 'H' | 'D' | 'C'> = ['S', 'H', 'D', 'C'];
    
    // Create base deck
    for (const suit of suits) {
      for (let rank = 2; rank <= 14; rank++) {
        deck.push({ suit, rank });
      }
    }

    // Shuffle deck
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = deck[i]!;
      deck[i] = deck[j]!;
      deck[j] = temp;
    }

    let playerNames = ['immu', 'sappii'];
    if (playerCount === 3) {
      playerNames = ['immu', 'sappii', 'tharkuri'];
      // Filter out 2 of Clubs so we have 51 total cards divisible by 3 players
      deck = deck.filter(c => !(c.suit === 'C' && c.rank === 2));
    }

    const hands: Record<string, Card[]> = {};
    playerNames.forEach(name => { hands[name] = []; });

    deck.forEach((card, idx) => {
      const targetPlayer = playerNames[idx % playerCount]!;
      hands[targetPlayer].push(card);
    });

    // Sort hands: Spades first, then Hearts, then Diamonds, then Clubs, ranks sorted descending
    const suitWeight: Record<string, number> = { 'S': 4, 'H': 3, 'D': 2, 'C': 1 };
    playerNames.forEach(name => {
      hands[name]?.sort((a, b) => {
        if (a.suit === b.suit) {
          return b.rank - a.rank;
        }
        return (suitWeight[b.suit] || 0) - (suitWeight[a.suit] || 0);
      });
    });

    // Find who contains Ace of Spades (S 14) to start the first trick
    let starter = playerNames[0]!;
    for (const player of playerNames) {
      if (hands[player]?.some(c => c.suit === 'S' && c.rank === 14)) {
        starter = player;
        break;
      }
    }

    const scores: Record<string, number> = {};
    playerNames.forEach(name => { scores[name] = 0; });

    // Set Cards game state
    update(ref(db), {
      cardsGameState: {
        status: 'playing',
        playerCount,
        playerNames,
        turn: starter,
        ledSuit: '',
        table: {},
        hands,
        scores
      }
    });

    onPushSystemMessage(`⚔️ NEW SPADES ROUND INITIALIZED FOR ${playerCount} PLAYERS!`);
  };

  const handlePlayCard = (cardIdx: number) => {
    if (!cardsGameState || cardsGameState.turn !== myName) {
      alert("IT IS NOT YOUR TURN!");
      return;
    }

    const myHand = cardsGameState.hands?.[myName] || [];
    const card = myHand[cardIdx];
    if (!card) return;

    const ledSuit = cardsGameState.ledSuit || '';

    // RULE check: Follow Suit if available!
    if (ledSuit && card.suit !== ledSuit) {
      const hasLedSuit = myHand.some(c => c.suit === ledSuit);
      if (hasLedSuit) {
        alert(`RULES ERROR: YOU MUST FOLLOW THE LED SUIT: ${SUIT_EMOJIS[ledSuit]}!`);
        return;
      }
    }

    // Play card
    const freshHand = [...myHand];
    freshHand.splice(cardIdx, 1);

    const updatedTable = { ...(cardsGameState.table || {}) };
    updatedTable[myName] = card;

    const updates: Partial<CardsGameState> = {
      hands: { ...(cardsGameState.hands || {}), [myName]: freshHand },
      table: updatedTable
    };

    if (!ledSuit) {
      updates.ledSuit = card.suit;
    }

    // Determine Turn / Trick completion
    const participants = cardsGameState.playerNames || [];
    const playedCount = Object.keys(updatedTable).length;

    if (playedCount === participants.length) {
      // Trick is finished
      updates.turn = 'resolving';
      update(ref(db, 'cardsGameState'), updates).then(() => {
        // Resolve after 2 seconds
        setTimeout(() => {
          resolveTrick(updatedTable, updates.ledSuit || cardsGameState.ledSuit, participants);
        }, 2000);
      });
    } else {
      // Pass to next player
      const myIdx = participants.indexOf(myName);
      const nextPlayer = participants[(myIdx + 1) % participants.length]!;
      updates.turn = nextPlayer;
      update(ref(db, 'cardsGameState'), updates);
    }
  };

  const resolveTrick = (tableCards: Record<string, Card>, led: string, players: string[]) => {
    const isCut = Object.values(tableCards).some(c => c.suit === 'S');
    const targetSuit = isCut ? 'S' : led;

    let trickWinner = '';
    let maxRanking = -1;

    for (const player of players) {
      const card = tableCards[player];
      if (!card) continue;

      let scoreVal = 0;
      if (isCut) {
        if (card.suit === 'S') scoreVal = card.rank + 100;
      } else {
        if (card.suit === targetSuit) scoreVal = card.rank;
      }

      if (scoreVal > maxRanking) {
        maxRanking = scoreVal;
        trickWinner = player;
      }
    }

    // Increment score of trickWinner
    runTransaction(ref(db, `cardsGameState/scores/${trickWinner}`), (current) => {
      return (current || 0) + 1;
    }).then(() => {
      // Check if hands are final/empty
      const firstPlayerHand = cardsGameState.hands?.[players[0]!] || [];
      const isEnded = firstPlayerHand.length <= 1 && Object.keys(tableCards).length === players.length;

      if (isEnded) {
        update(ref(db, 'cardsGameState'), {
          table: null,
          ledSuit: '',
          turn: 'game_over',
          status: 'finished'
        });
        onPushSystemMessage(`🏁 Spades game completed!`);
      } else {
        update(ref(db, 'cardsGameState'), {
          table: {},
          ledSuit: '',
          turn: trickWinner
        });
        const winningCard = (tableCards[trickWinner] as Card);
        onPushSystemMessage(`♠️ ${trickWinner.toUpperCase()} won the trick with a ${SUIT_EMOJIS[winningCard?.suit || '']}${RANK_LABELS[winningCard?.rank || 0]}!`);
      }
    });
  };

  if (!cardsGameState || cardsGameState.status === 'setup' || !cardsGameState.status) {
    return (
      <div className="bg-[var(--card-bg)] backdrop-blur-md rounded-2xl p-8 border border-[var(--border-color)] shadow-2xl text-center space-y-6">
        <h2 className="text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-[var(--primary-color)] to-[var(--secondary-color)] tracking-widest uppercase">
          SPADES ARENA 🃏
        </h2>
        <p className="text-xs text-stone-400 max-w-sm mx-auto leading-relaxed uppercase tracking-wider">
          A dynamic real-time trick-taking multiplayer game. Must follow lead suit if possible. Spades represent trumps (Cuts).
        </p>

        <div className="flex gap-3 max-w-xs mx-auto">
          <button
            onClick={() => initGame(2)}
            className="w-full py-3 bg-gradient-to-r from-[var(--primary-color)] to-[var(--secondary-color)] text-white hover:brightness-110 font-bold text-xs rounded-xl tracking-widest uppercase shadow-lg shadow-[var(--glow-shadow)] transition-all flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Layers className="w-4 h-4" />
            2 PLAYERS
          </button>
          <button
            onClick={() => initGame(3)}
            className="w-full py-3 bg-white/5 hover:bg-white/10 text-[var(--accent-color)] font-bold text-xs rounded-xl border border-[var(--accent-color)]/20 hover:border-white/20 transition-all uppercase flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            3 PLAYERS
          </button>
        </div>
      </div>
    );
  }

  // Finished state
  if (cardsGameState.status === 'finished') {
    const scores = cardsGameState.scores || {};
    const participants = cardsGameState.playerNames || [];
    const winnerName = participants.reduce((a, b) => ((scores[a] || 0) > (scores[b] || 0)) ? a : b, participants[0] || '');

    return (
      <div className="bg-[var(--card-bg)] backdrop-blur-md rounded-2xl p-8 border border-[var(--border-color)] shadow-2xl text-center space-y-6">
        <div className="w-16 h-16 bg-[var(--accent-color)]/10 rounded-full flex items-center justify-center mx-auto animate-bounce text-[var(--accent-color)]">
          <Trophy className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-black text-white tracking-widest uppercase">ROUND FINISHED!</h2>
        <p className="text-sm font-black text-[var(--accent-color)] tracking-wider">
          🏆 {winnerName.toUpperCase()} CONQUERED THE ARENA!
        </p>

        <div className="grid grid-cols-2 gap-4 max-w-xs mx-auto py-3">
          {participants.map(p => (
            <div key={p} className="p-3 bg-black/40 rounded-xl border border-white/5 space-y-1">
              <span className="text-[10px] text-stone-500 font-extrabold uppercase tracking-widest">{p}</span>
              <span className="block text-2xl font-black text-white">{scores[p] || 0}</span>
            </div>
          ))}
        </div>

        <div className="flex gap-2 max-w-xs mx-auto">
          <button
            onClick={() => initGame(cardsGameState.playerCount as 2 | 3 || 2)}
            className="w-full py-3.5 bg-gradient-to-r from-[var(--primary-color)] to-[var(--secondary-color)] text-white font-bold text-xs rounded-xl tracking-widest uppercase transition-all"
          >
            PLAY AGAIN
          </button>
        </div>
      </div>
    );
  }

  // Active game play UI
  const participants = cardsGameState.playerNames || [];
  const currentTurn = cardsGameState.turn || '';
  const myHand = cardsGameState.hands?.[myName] || [];
  const table = cardsGameState.table || {};
  const isMyTurn = currentTurn === myName;
  const scores = cardsGameState.scores || {};

  return (
    <div className="bg-[var(--card-bg)] backdrop-blur-sm rounded-2xl p-5 border border-[var(--border-color)] shadow-2xl space-y-5">
      
      {/* Competitors scoreboard row */}
      <div className="flex flex-wrap gap-2 justify-center">
        {participants.map(p => {
          const isUserTurn = currentTurn === p;
          const userHandCount = cardsGameState.hands?.[p]?.length || 0;
          return (
            <div
              key={p}
              className={`px-4 py-3 bg-black/40 rounded-xl border text-center transition-all ${
                isUserTurn
                  ? 'border-[var(--primary-color)] shadow-lg shadow-[var(--glow-shadow)] scale-105'
                  : 'border-white/5'
              }`}
            >
              <div className="text-[10px] text-stone-500 font-black tracking-widest uppercase">{p === myName ? 'YOU' : p.toUpperCase()}</div>
              <div className="text-lg font-black text-white">{scores[p] || 0} PTS</div>
              <div className="text-[9px] text-stone-400 mt-0.5 font-bold">{userHandCount} CARDS</div>
            </div>
          );
        })}
      </div>

      {/* Table Area (played cards in trick) */}
      <div className="py-6 rounded-2xl bg-black/45 border border-white/5 relative flex flex-col items-center justify-center min-h-[160px] shadow-inner space-y-4">
        {Object.keys(table).length === 0 ? (
          <span className="text-xs text-stone-600 font-black tracking-widest uppercase animate-pulse">
            TABLE IS DRY -- READY SQUAD
          </span>
        ) : (
          <div className="flex justify-center items-center gap-6">
            {Object.entries(table).map(([pName, val]) => {
              const cardItem = val as Card;
              const isRed = cardItem.suit === 'H' || cardItem.suit === 'D';
              return (
                <div key={pName} className="flex flex-col items-center gap-1.5">
                  <span className="text-[10px] text-stone-500 font-bold uppercase tracking-wider">{pName}</span>
                  <div
                    className={`w-14 h-20 rounded-xl bg-gradient-to-b from-stone-900 to-black border border-white/10 shadow-lg justify-center items-center flex flex-col relative overflow-hidden select-none ${
                      isRed ? 'text-[var(--primary-color)]' : 'text-stone-300'
                    }`}
                  >
                    <span className="text-xl font-bold tracking-tighter">{RANK_LABELS[cardItem.rank]}</span>
                    <span className="text-2xl mt-0.5">{SUIT_EMOJIS[cardItem.suit]}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {cardsGameState.ledSuit && (
          <span className="text-[9px] bg-white/5 border border-white/10 px-3 py-1 rounded-full text-stone-400 font-bold uppercase tracking-wide">
            LED SUIT: {SUIT_EMOJIS[cardsGameState.ledSuit]} {cardsGameState.ledSuit}
          </span>
        )}
      </div>

      {/* Turn instruction banner */}
      <div className="text-center">
        {isMyTurn ? (
          <span className="text-xs font-black text-[var(--accent-color)] tracking-wider uppercase animate-pulse flex items-center justify-center gap-1">
            ⚡ YOUR TURN! CHOOSE AND PLAY A VALID CARD
          </span>
        ) : currentTurn === 'resolving' ? (
          <span className="text-xs font-black text-amber-400 tracking-wider uppercase flex items-center justify-center gap-1.5">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" /> RESOLVING TRICK SCORINGS...
          </span>
        ) : (
          <span className="text-xs font-bold text-stone-400 tracking-wider uppercase">
            WAITING FOR {currentTurn.toUpperCase()}...
          </span>
        )}
      </div>

      {/* Played card deck list */}
      <div className="space-y-2">
        <div className="text-[10px] text-stone-500 font-extrabold tracking-widest uppercase">YOUR PALETTE ({myHand.length} CARDS)</div>
        <div className="flex gap-2 overflow-x-auto pb-3 pt-1 select-none scrollbar-thin">
          {myHand.map((c, idx) => {
            const isRed = c.suit === 'H' || c.suit === 'D';
            const ledSuit = cardsGameState.ledSuit;
            const canPlay = isMyTurn && (!ledSuit || c.suit === ledSuit || !myHand.some(x => x.suit === ledSuit));

            return (
              <button
                key={idx}
                disabled={!canPlay || currentTurn === 'resolving'}
                onClick={() => handlePlayCard(idx)}
                style={{ contentVisibility: 'auto' }}
                className={`w-14 h-20 rounded-xl bg-gradient-to-b from-stone-900 to-stone-950 border border-white/5 flex flex-col justify-center items-center relative overflow-hidden transition-all duration-200 cursor-pointer shrink-0 ${
                  isRed ? 'text-[var(--primary-color)]' : 'text-stone-300'
                } ${
                  canPlay 
                    ? 'hover:-translate-y-3 hover:border-[var(--accent-color)] focus:border-[var(--accent-color)] hover:shadow-lg hover:shadow-[var(--accent-color)]/10 scale-100'
                    : 'opacity-30 cursor-not-allowed scale-95'
                }`}
              >
                <span className="text-lg font-black tracking-tighter">{RANK_LABELS[c.rank]}</span>
                <span className="text-2xl mt-0.5">{SUIT_EMOJIS[c.suit]}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
