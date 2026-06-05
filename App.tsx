import React, { useState, useEffect } from 'react';
import { MovieGameState, MovieItem } from '../types';
import { convertTamilishToTamil, getLetterCountExact, getSegments } from '../utils/transliteration';
import { MOVIE_COLLECTION } from '../data/movies';
import { Play, Shuffle, HelpCircle, Award, Volume2, Key, Lightbulb } from 'lucide-react';

interface MovieGameProps {
  gameState: MovieGameState;
  myName: string;
  partnerName: string;
  onUpdateState: (updates: Partial<MovieGameState>) => void;
  onPushSystemMessage: (text: string) => void;
}

export const MovieGame: React.FC<MovieGameProps> = ({
  gameState,
  myName,
  partnerName,
  onUpdateState,
  onPushSystemMessage
}) => {
  const [movieInput, setMovieInput] = useState('');
  const [hintInput, setHintInput] = useState('');
  const [guessInput, setGuessInput] = useState('');
  const [tamilPreview, setTamilPreview] = useState('TYPE TAMIL NAME OR THANLISH HERE');
  const [feedback, setFeedback] = useState({ text: '', type: 'error' as 'error' | 'success' });
  const [aiGenerating, setAiGenerating] = useState(false);

  useEffect(() => {
    // Sync transliteration preview whenever movieInput changes
    if (movieInput.trim()) {
      const found = MOVIE_COLLECTION.find(
        m => m.eng.toLowerCase() === movieInput.trim().toLowerCase()
      );
      if (found) {
        setTamilPreview(found.tamil);
        if (found.hero && !hintInput) {
          setHintInput(`HINT: ${found.hero.toUpperCase()}`);
        }
      } else {
        setTamilPreview(convertTamilishToTamil(movieInput));
      }
    } else {
      setTamilPreview('TYPE TAMIL NAME OR THANLISH HERE');
    }
  }, [movieInput]);

  const handleSuggestRandom = () => {
    const randomObj = MOVIE_COLLECTION[Math.floor(Math.random() * MOVIE_COLLECTION.length)];
    setMovieInput(randomObj.eng);
    setTamilPreview(randomObj.tamil);
    if (randomObj.hero) {
      setHintInput(`GUESS THE HERO: ${randomObj.hero.toUpperCase()}`);
    } else {
      setHintInput('GUESS THE TAMIL MOVIE!');
    }
  };

  const handleStartGame = () => {
    const raw = movieInput.trim();
    if (!raw) {
      alert("ENTER MOVIE IN ENGLISH OR THANLISH!");
      return;
    }

    const foundMovie = MOVIE_COLLECTION.find(
      m => m.eng.toLowerCase() === raw.toLowerCase()
    );

    let finalEng = raw;
    let finalTamil = "";

    if (foundMovie) {
      finalEng = foundMovie.eng;
      finalTamil = foundMovie.tamil;
    } else {
      finalTamil = convertTamilishToTamil(raw);
      if (!finalTamil) {
        alert("PLEASE ENTER THE TAMIL NAME OR THANLISH!");
        return;
      }
    }

    onUpdateState({
      movieEng: finalEng,
      movieTamil: finalTamil,
      hint: hintInput,
      status: 'guessing'
    });
  };

  const checkGuess = () => {
    const guessRaw = guessInput.trim().toLowerCase();
    const normalizedGuess = guessRaw.replace(/[^a-z0-9]/g, '');
    const normalizedAnswer = (gameState.movieEng || "").toLowerCase().replace(/[^a-z0-9]/g, '');

    if (normalizedGuess === normalizedAnswer && normalizedGuess !== "") {
      const isImmu = myName === 'immu';
      onUpdateState({
        score1: isImmu ? gameState.score1 + 1 : gameState.score1,
        score2: !isImmu ? gameState.score2 + 1 : gameState.score2,
        turn: myName,
        status: 'set',
        movieEng: '',
        movieTamil: '',
        hint: ''
      });
      onPushSystemMessage(`${myName.toUpperCase()} GUESSED IT RIGHT: "${gameState.movieEng.toUpperCase()}"!`);
      setGuessInput('');
      setFeedback({ text: '', type: 'success' });
    } else {
      setFeedback({ text: 'WRONG SPELLING! TRY AGAIN', type: 'error' });
    }
  };

  const giveUp = () => {
    setFeedback({
      text: `ANSWER: ${(gameState.movieEng || "").toUpperCase()}`,
      type: 'success'
    });

    const partnerScoreKey = myName === 'immu' ? 'score2' : 'score1';
    const isPartnerImmu = partnerName === 'immu';
    
    onPushSystemMessage(`${myName.toUpperCase()} GAVE UP! Point goes to ${partnerName.toUpperCase()}.`);

    setTimeout(() => {
      onUpdateState({
        score1: isPartnerImmu ? gameState.score1 + 1 : gameState.score1,
        score2: !isPartnerImmu ? gameState.score2 + 1 : gameState.score2,
        turn: myName,
        status: 'set',
        movieEng: '',
        movieTamil: '',
        hint: ''
      });
      setFeedback({ text: '', type: 'success' });
      setGuessInput('');
    }, 2500);
  };

  const awardManualPoint = () => {
    const isPartnerImmu = partnerName === 'immu';
    
    onUpdateState({
      score1: isPartnerImmu ? gameState.score1 + 1 : gameState.score1,
      score2: !isPartnerImmu ? gameState.score2 + 1 : gameState.score2,
      turn: partnerName,
      status: 'set',
      movieEng: '',
      movieTamil: '',
      hint: ''
    });

    onPushSystemMessage(`${myName.toUpperCase()} AWARDED A POINT TO ${partnerName.toUpperCase()} AND PASSED THE TURN!`);
  };

  // Modern AI Hint generator using server side call (Gemini proxy)
  const generateAiHint = async () => {
    if (aiGenerating) return;
    setAiGenerating(true);
    try {
      const response = await fetch('/api/ai-hint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          movieName: gameState.movieEng,
          tamilName: gameState.movieTamil
        })
      });
      if (response.ok) {
        const data = await response.json();
        if (data.hint) {
          onUpdateState({ hint: data.hint });
          onPushSystemMessage(`⚡ AI Game Master generated a hint!`);
        }
      } else {
        alert("Server AI slow right now, please try again!");
      }
    } catch (e) {
      console.error(e);
    } finally {
      setAiGenerating(false);
    }
  };

  // Mask exact string logic with React styling
  const renderMaskedString = (str: string) => {
    if (!str) return null;
    const tokens = getSegments(str);
    
    let firstIdx = -1;
    let lastIdx = -1;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].trim() !== '') {
        if (firstIdx === -1) firstIdx = i;
        lastIdx = i;
      }
    }

    return (
      <div className="flex flex-wrap justify-center gap-2 items-center my-4 select-none px-4" style={{ fontFamily: "Latha, sans-serif" }}>
        {tokens.map((char, idx) => {
          if (char.trim() === '') {
            return <div key={idx} className="w-6 h-1 bg-transparent" />;
          } else if (idx === firstIdx || idx === lastIdx) {
            return (
              <span
                key={idx}
                className="text-3xl md:text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-[var(--primary-color)] to-[var(--secondary-color)] drop-shadow-[0_2px_10px_var(--glow-shadow)] animate-pulse"
              >
                {char}
              </span>
            );
          } else {
            return (
              <span
                key={idx}
                className="text-3xl md:text-4xl font-extrabold text-[var(--accent-color)] h-12 flex items-end justify-center px-1 border-b-4 border-[var(--accent-color)] min-w-[24px]"
              >
                _
              </span>
            );
          }
        })}
      </div>
    );
  };

  const isMyTurn = gameState.turn === myName;
  const letterCount = getLetterCountExact(gameState.movieTamil);

  return (
    <div className="space-y-4">
      {gameState.status === 'set' ? (
        isMyTurn ? (
          // Enter movie name phase (Active player turn)
          <div className="bg-[var(--card-bg)] backdrop-blur-md rounded-2xl p-6 border border-[var(--border-color)] shadow-2xl relative overflow-hidden transition-all duration-300">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="text-sm font-extrabold tracking-widest text-white uppercase flex items-center gap-2">
                  <Play className="w-4 h-4 text-[var(--primary-color)]" />
                  YOUR TURN TO CHOOSE
                </h3>
                <p className="text-xs text-stone-400 mt-1">Select from preset or type your custom title below</p>
              </div>
              <span className="bg-gradient-to-r from-[var(--primary-color)] to-[var(--secondary-color)] text-white text-xs font-black px-3 py-1 rounded-full uppercase tracking-wider">
                SENDER
              </span>
            </div>

            <div className="p-4 rounded-xl bg-black/40 border border-white/5 space-y-3">
              <input
                type="text"
                value={movieInput}
                onChange={(e) => setMovieInput(e.target.value)}
                placeholder="TYPE TAMIL MOVIE NAME IN ENGLISH OR REGULAR LETTERS"
                className="w-full bg-transparent border-0 outline-none text-center focus:ring-0 text-lg font-black tracking-normal text-white placeholder-stone-600 uppercase"
                list="movies-presets"
              />
              <datalist id="movies-presets">
                {MOVIE_COLLECTION.map((m, idx) => (
                  <option key={idx} value={m.eng} />
                ))}
              </datalist>

              <div className="py-2 border-t border-white/5 text-center">
                <span className="text-xs text-stone-400 block mb-1 font-bold">TAMIL PREVIEW:</span>
                <span className="inline-block text-[var(--accent-color)] font-extrabold text-lg transition-all" style={{ fontFamily: "Latha, sans-serif" }}>
                  {tamilPreview}
                </span>
              </div>
            </div>

            <div className="mt-4 flex flex-col sm:flex-row gap-2 items-center">
              <button
                onClick={handleSuggestRandom}
                className="w-full sm:w-auto px-4 py-3 bg-white/5 hover:bg-white/10 text-[var(--accent-color)] hover:text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 border border-[var(--accent-color)]/20 hover:border-white/20 transition-all duration-300 uppercase shrink-0"
              >
                <Shuffle className="w-4 h-4" />
                RANDOM
              </button>

              <input
                type="text"
                value={hintInput}
                onChange={(e) => setHintInput(e.target.value)}
                placeholder="OPTIONAL CLUE/HINT (E.G. ACTOR NAME)"
                className="w-full flex-1 bg-black/35 border border-white/5 focus:border-[var(--primary-color)] rounded-xl px-4 py-3 text-xs placeholder-stone-600 text-white font-bold outline-none uppercase tracking-wider"
              />

              <button
                onClick={handleStartGame}
                className="w-full sm:w-auto px-6 py-3 bg-gradient-to-r from-[var(--primary-color)] to-[var(--secondary-color)] text-white hover:brightness-110 font-bold text-xs rounded-xl tracking-widest uppercase shadow-lg shadow-[var(--glow-shadow)] transition-all flex items-center justify-center gap-2"
              >
                <Play className="w-4 h-4 fill-current" />
                START
              </button>
            </div>
          </div>
        ) : (
          // Waiting phase (In-active player)
          <div className="bg-[var(--card-bg)] backdrop-blur-md rounded-2xl p-8 border border-[var(--border-color)] shadow-lg text-center space-y-3">
            <div className="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center mx-auto animate-bounce">
              <HelpCircle className="w-6 h-6 text-[var(--accent-color)]" />
            </div>
            <h3 className="text-sm font-extrabold text-white tracking-widest uppercase">WAITING...</h3>
            <p className="text-xs text-stone-400 uppercase tracking-widest">
              {gameState.turn.toUpperCase()} IS CURRENTLY CHOOSING A SECRET MOVIE
            </p>
          </div>
        )
      ) : (
        // Guessing active phase
        <div className="bg-[var(--card-bg)] backdrop-blur-md rounded-2xl p-6 border border-[var(--border-color)] shadow-2xl relative overflow-hidden transition-all duration-300">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h3 className="text-sm font-extrabold tracking-widest text-white uppercase">GUESS THE MOVIE</h3>
              <p className="text-xs text-stone-400 mt-1">First and last letters are revealed as clues</p>
            </div>
            <span className="bg-[var(--accent-color)]/25 border border-[var(--accent-color)]/40 text-[var(--accent-color)] text-xs font-black px-3 py-1 rounded-full uppercase tracking-wider animate-pulse">
              {gameState.turn === myName ? 'GUESSER ACTIVE' : 'YOUR CLUE'}
            </span>
          </div>

          <div className="space-y-4">
            {/* Visual letters board */}
            {renderMaskedString(gameState.movieTamil)}

            <div className="flex justify-center">
              <span className="text-[10px] bg-[var(--accent-color)]/10 text-[var(--accent-color)] border border-[var(--accent-color)]/20 font-black px-4 py-1.5 rounded-lg tracking-widest uppercase">
                {letterCount} TAMIL {letterCount === 1 ? 'LETTER' : 'LETTERS'}
              </span>
            </div>

            {gameState.hint && (
              <div className="p-3 bg-white/5 rounded-xl border border-white/5 flex items-start gap-2.5">
                <span className="text-xs font-black text-[var(--primary-color)] shrink-0 uppercase tracking-widest mt-0.5">Clue:</span>
                <p className="text-xs text-stone-200 font-bold uppercase tracking-wider leading-relaxed">{gameState.hint}</p>
              </div>
            )}

            {!isMyTurn ? (
              // User is guesser
              <div className="space-y-3 pt-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={guessInput}
                    onChange={(e) => setGuessInput(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && checkGuess()}
                    placeholder="TYPE YOUR ANSWER IN ENGLISH"
                    className="w-full bg-black/40 border border-white/5 focus:border-[var(--primary-color)] rounded-xl px-4 py-3.5 text-sm placeholder-stone-600 text-white font-extrabold outline-none tracking-widest uppercase focus:bg-black/60 transition-all"
                  />
                </div>

                <div className="flex gap-2 flex-col sm:flex-row">
                  <button
                    onClick={checkGuess}
                    className="w-full py-3.5 bg-gradient-to-r from-[var(--primary-color)] to-[var(--secondary-color)] text-white hover:brightness-110 font-bold text-xs rounded-xl tracking-widest uppercase shadow-lg shadow-[var(--glow-shadow)] transition-all flex items-center justify-center gap-1.5"
                  >
                    <Award className="w-4 h-4" />
                    SUBMIT ANSWER
                  </button>
                  <button
                    onClick={giveUp}
                    className="w-full sm:w-1/3 py-3.5 bg-white/5 hover:bg-white/10 text-stone-400 hover:text-white rounded-xl font-bold text-xs border border-white/10 transition-all uppercase"
                  >
                    GIVE UP
                  </button>
                </div>

                {feedback.text && (
                  <p className={`text-center text-xs font-black uppercase tracking-wider py-1 ${
                    feedback.type === 'error' ? 'text-[var(--primary-color)]' : 'text-[var(--accent-color)] animate-bounce'
                  }`}>
                    {feedback.text}
                  </p>
                )}
              </div>
            ) : (
              // User is the setter waiting for guess
              <div className="space-y-4 pt-4 border-t border-white/5 text-center">
                <div className="text-xs text-stone-400 font-bold uppercase tracking-widest flex items-center justify-center gap-2">
                  <span>Secret answer:</span>
                  <span className="text-[var(--primary-color)] font-black text-sm">{gameState.movieEng.toUpperCase()}</span>
                </div>
                
                <div className="flex gap-2 flex-col sm:flex-row justify-center">
                  <button
                    onClick={generateAiHint}
                    disabled={aiGenerating}
                    className="w-full sm:w-auto px-5 py-3 bg-[var(--accent-color)]/10 hover:bg-[var(--accent-color)]/20 text-[var(--accent-color)] rounded-xl font-bold text-xs border border-[var(--accent-color)]/30 hover:border-[var(--accent-color)]/50 transition-all flex items-center justify-center gap-2 uppercase tracking-wide"
                  >
                    <Lightbulb className={`w-4 h-4 ${aiGenerating ? 'animate-bounce' : ''}`} />
                    {aiGenerating ? 'AI Writing hint...' : '🤖 Generate AI Clue'}
                  </button>

                  <button
                    onClick={awardManualPoint}
                    className="w-full sm:w-auto px-5 py-3 bg-white/5 hover:bg-white/10 text-stone-400 hover:text-white rounded-xl font-bold text-xs border border-white/10 transition-all flex items-center justify-center gap-2 uppercase tracking-wide"
                  >
                    Award Point &amp; Pass
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
