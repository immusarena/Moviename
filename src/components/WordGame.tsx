import React, { useState, useEffect } from 'react';
import { WordGameState } from '../types';
import { HelpCircle, Play, Sparkles, Send, Zap, RotateCcw } from 'lucide-react';
import { db } from '../utils/firebase';
import { runTransaction, ref } from 'firebase/database';

interface WordGameProps {
  gameState: WordGameState;
  myName: string;
  partnerName: string;
  onUpdateState: (updates: Partial<WordGameState>) => void;
  onPushSystemMessage: (text: string) => void;
}

export const WordGame: React.FC<WordGameProps> = ({
  gameState,
  myName,
  partnerName,
  onUpdateState,
  onPushSystemMessage
}) => {
  const [letterInput, setLetterInput] = useState('');
  const [raceInput, setRaceInput] = useState('');
  const [checkingWord, setCheckingWord] = useState(false);
  const [feedback, setFeedback] = useState({ text: '', type: 'error' as 'error' | 'success' });

  const myLetterKey = myName === 'immu' ? 'p1Letter' : 'p2Letter';
  const partnerLetterKey = myName === 'immu' ? 'p2Letter' : 'p1Letter';

  const myLetter = gameState[myLetterKey] || '';
  const partnerLetter = gameState[partnerLetterKey] || '';

  const handleSendLetter = () => {
    const got = letterInput.trim().toLowerCase();
    if (!got || got.length > 1 || !/[a-z]/.test(got)) {
      alert("PLEASE ENTER EXACTLY 1 ENGLISH LETTER (A-Z)!");
      return;
    }
    onUpdateState({ [myLetterKey]: got });
    setLetterInput('');
  };

  const handleSetOrder = (start: string, end: string) => {
    onUpdateState({
      status: 'race_phase',
      startLetter: start,
      endLetter: end
    });
  };

  const handleSubmitRaceWord = async () => {
    if (checkingWord) return;
    const word = raceInput.trim().toLowerCase().replace(/[^a-z]/g, '');
    const start = (gameState.startLetter || '').toLowerCase();
    const end = (gameState.endLetter || '').toLowerCase();

    if (word.length < 2 || !word.startsWith(start) || !word.endsWith(end)) {
      setFeedback({
        text: `WORD MUST START WITH ${start.toUpperCase()} AND END WITH ${end.toUpperCase()}!`,
        type: 'error'
      });
      return;
    }

    if (gameState.usedWords && gameState.usedWords[word]) {
      const winner = gameState.usedWords[word] || "PARTNER";
      setFeedback({
        text: `ALREADY USED FOR ${winner.toUpperCase()}!`,
        type: 'error'
      });
      return;
    }

    setCheckingWord(true);
    setFeedback({ text: 'CHECKING DICTIONARY... ⏳', type: 'success' });

    try {
      const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`);
      if (!res.ok) {
        setFeedback({ text: 'NOT A VALID ENGLISH WORD!', type: 'error' });
        setCheckingWord(false);
        return;
      }
    } catch (e) {
      setFeedback({ text: 'DICTIONARY SERVICE SLOW! RETRY.', type: 'error' });
      setCheckingWord(false);
      return;
    }

    // Collision Resolution via Firebase Transaction
    const wordRef = ref(db, `wordGameState/usedWords/${word}`);
    runTransaction(wordRef, (currentValue) => {
      if (currentValue === null) {
        return myName;
      }
      return; // Abort transaction if someone wrote it first
    }).then((result) => {
      setCheckingWord(false);
      if (!result.committed) {
        const firstGuy = result.snapshot.val() || "PARTNER";
        setFeedback({
          text: `TOO LATE! ${firstGuy.toUpperCase()} CLASHED STRIKE FIRST! 🏃💨`,
          type: 'error'
        });
      } else {
        // Success ! Award Points
        const isImmu = myName === 'immu';
        onUpdateState({
          score1: isImmu ? gameState.score1 + 1 : gameState.score1,
          score2: !isImmu ? gameState.score2 + 1 : gameState.score2,
          status: 'letter_phase',
          p1Letter: '',
          p2Letter: '',
          startLetter: '',
          endLetter: ''
        });

        onPushSystemMessage(`👑 ${myName.toUpperCase()} SCORED A POINT IN RACE: "${word.toUpperCase()}"!`);
        setRaceInput('');
        setFeedback({ text: '', type: 'success' });
      }
    }).catch(() => {
      setCheckingWord(false);
      setFeedback({ text: 'NETWORK OR CLOUD SYNC ERROR!', type: 'error' });
    });
  };

  const handleSkipWord = () => {
    onUpdateState({
      status: 'letter_phase',
      p1Letter: '',
      p2Letter: '',
      startLetter: '',
      endLetter: ''
    });
    onPushSystemMessage(`THIS WORD RACE STAGE WAS SKIPPED!`);
  };

  return (
    <div className="space-y-4">
      {gameState.status === 'letter_phase' ? (
        // Choose letter phase
        <div className="bg-[var(--card-bg)] backdrop-blur-md rounded-2xl p-6 border border-[var(--border-color)] shadow-2xl space-y-4">
          <div className="flex justify-between items-center mb-1">
            <div>
              <h3 className="text-sm font-extrabold tracking-widest text-white uppercase flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[var(--accent-color)]" />
                ROUND SET PHASE
              </h3>
              <p className="text-xs text-stone-400 mt-1">Both submit 1 letter to configure layout constraints</p>
            </div>
            <span className="bg-[var(--accent-color)]/25 text-[var(--accent-color)] text-xs font-black px-3 py-1 rounded-full uppercase tracking-wider animate-pulse">
              INPUTTING
            </span>
          </div>

          {!myLetter ? (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-black/40 border border-white/5 flex flex-col items-center">
                <span className="text-[10px] text-stone-500 font-bold uppercase tracking-widest block mb-2">CHOOSE YOUR LETTER (A-Z)</span>
                <input
                  type="text"
                  maxLength={1}
                  value={letterInput}
                  onChange={(e) => setLetterInput(e.target.value.replace(/[^a-zA-Z]/g, ''))}
                  placeholder="?"
                  className="w-16 h-16 text-center bg-white/5 border border-white/10 text-white font-black text-4xl rounded-2xl outline-none focus:border-[var(--primary-color)] uppercase transition-all tracking-normal"
                />
              </div>
              <button
                onClick={handleSendLetter}
                className="w-full py-3.5 bg-gradient-to-r from-[var(--primary-color)] to-[var(--secondary-color)] text-white hover:brightness-110 font-bold text-xs rounded-xl tracking-widest uppercase shadow-lg shadow-[var(--glow-shadow)] transition-all flex items-center justify-center gap-2"
              >
                <Send className="w-4 h-4" />
                SUBMIT CHOICE
              </button>
            </div>
          ) : !partnerLetter ? (
            // Waiting for partner
            <div className="p-6 text-center space-y-3">
              <div className="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center mx-auto animate-bounce">
                <HelpCircle className="w-6 h-6 text-stone-400" />
              </div>
              <h4 className="text-sm font-extrabold text-white tracking-wider">WAITING FOR {partnerName.toUpperCase()}</h4>
              <p className="text-xs text-stone-400">YOU LOCKED IN: <span className="text-[var(--accent-color)] text-lg font-black">{myLetter.toUpperCase()}</span></p>
            </div>
          ) : (
            // Both submitted - Select Direction
            <div className="space-y-4">
              <div className="text-center p-3 rounded-lg bg-green-500/10 text-[var(--accent-color)] font-bold text-xs border border-green-500/10 uppercase tracking-widest">
                🎉 BOTH LETTERS RECEIVED!
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <button
                  onClick={() => handleSetOrder(myLetter, partnerLetter)}
                  className="p-5 bg-gradient-to-br from-white/5 to-white/10 hover:from-[var(--primary-color)]/20 hover:to-[var(--secondary-color)]/20 text-white rounded-xl border border-white/5 hover:border-[var(--primary-color)]/20 text-center font-extrabold space-y-1 transition-all flex flex-col items-center justify-center cursor-pointer group"
                >
                  <span className="text-[10px] text-stone-400 uppercase tracking-widest font-bold group-hover:text-white">ORDER A</span>
                  <div className="text-2xl mt-1 text-[var(--accent-color)] font-black group-hover:text-white">
                    {myLetter.toUpperCase()} <span className="text-stone-500">→</span> {partnerLetter.toUpperCase()}
                  </div>
                </button>

                <button
                  onClick={() => handleSetOrder(partnerLetter, myLetter)}
                  className="p-5 bg-gradient-to-br from-white/5 to-white/10 hover:from-[var(--primary-color)]/20 hover:to-[var(--secondary-color)]/20 text-white rounded-xl border border-white/5 hover:border-[var(--primary-color)]/20 text-center font-extrabold space-y-1 transition-all flex flex-col items-center justify-center cursor-pointer group"
                >
                  <span className="text-[10px] text-stone-400 uppercase tracking-widest font-bold group-hover:text-white">ORDER B</span>
                  <div className="text-2xl mt-1 text-[var(--primary-color)] font-black group-hover:text-white">
                    {partnerLetter.toUpperCase()} <span className="text-stone-500">→</span> {myLetter.toUpperCase()}
                  </div>
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        // Active Racing Phase
        <div className="bg-[var(--card-bg)] backdrop-blur-md rounded-2xl p-6 border border-[var(--accent-color)] rounded-2xl shadow-2xl shadow-[var(--accent-color)]/5 space-y-4">
          <div className="flex justify-between items-center mb-1">
            <div>
              <h3 className="text-sm font-extrabold tracking-widest text-white uppercase flex items-center gap-2">
                <Zap className="text-[var(--accent-color)] w-4 h-4 animate-bounce" />
                WORD SPELLS RACING
              </h3>
              <p className="text-xs text-stone-400 mt-1">Submit any English word with exact constraints</p>
            </div>
            <span className="bg-[var(--accent-color)]/25 text-[var(--accent-color)] text-xs font-black px-3 py-1 rounded-full uppercase tracking-wider">
              RACE LIVE
            </span>
          </div>

          <div className="py-4 bg-black/40 rounded-xl border border-white/5 flex justify-center items-center gap-4 text-center">
            <div>
              <span className="text-[9px] text-stone-500 block uppercase tracking-widest font-bold">STARTS WITH</span>
              <span className="text-4xl font-black text-[var(--accent-color)] drop-shadow-[0_0_15px_rgba(74,222,128,0.4)]">
                {gameState.startLetter.toUpperCase()}
              </span>
            </div>
            <div className="text-stone-500 font-extrabold text-xl">----</div>
            <div>
              <span className="text-[9px] text-stone-500 block uppercase tracking-widest font-bold">ENDS WITH</span>
              <span className="text-4xl font-black text-[var(--primary-color)] drop-shadow-[0_0_15px_rgba(255,75,114,0.4)]">
                {gameState.endLetter.toUpperCase()}
              </span>
            </div>
          </div>

          <div className="space-y-3">
            <input
              type="text"
              value={raceInput}
              disabled={checkingWord}
              onChange={(e) => setRaceInput(e.target.value.replace(/[^a-zA-Z]/g, ''))}
              onKeyPress={(e) => e.key === 'Enter' && handleSubmitRaceWord()}
              placeholder="TYPE THE QUICKEST WORD NOW..."
              className="w-full bg-black/45 border border-white/5 focus:border-[var(--accent-color)] rounded-xl px-4 py-3 text-center text-lg font-black placeholder-stone-600 text-white uppercase outline-none focus:bg-black/60 transition-all tracking-widest"
            />

            <div className="flex gap-2">
              <button
                onClick={handleSubmitRaceWord}
                disabled={checkingWord}
                className="flex-1 py-3.5 bg-gradient-to-r from-[var(--accent-color)] to-[#22c55e] text-black hover:brightness-110 font-bold text-xs rounded-xl tracking-widest uppercase transition-all flex items-center justify-center gap-2 shadow-lg shadow-green-500/10 cursor-pointer disabled:opacity-50"
              >
                <Zap className="w-4 h-4 fill-current" />
                SUBMIT SPEED RUN
              </button>
              <button
                onClick={handleSkipWord}
                className="px-4 py-3.5 bg-white/5 hover:bg-white/10 text-stone-400 hover:text-white rounded-xl font-bold text-xs border border-white/10 transition-all uppercase flex items-center justify-center gap-1 cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                SKIP
              </button>
            </div>

            {feedback.text && (
              <p className={`text-center text-xs font-black uppercase tracking-wider py-1 ${
                feedback.type === 'error' ? 'text-[var(--primary-color)]' : 'text-stone-300'
              }`}>
                {feedback.text}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
