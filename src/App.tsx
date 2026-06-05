import { useState, useEffect } from 'react';
import { db } from './utils/firebase';
import { ref, onValue, set, push, onDisconnect, serverTimestamp, update } from 'firebase/database';
import { MovieGameState, WordGameState, CardsGameState } from './types';
import { ParticleBackground } from './components/ParticleBackground';
import { MovieGame } from './components/MovieGame';
import { WordGame } from './components/WordGame';
import { SpadesGame } from './components/SpadesGame';
import { ChatSection } from './components/ChatSection';
import { 
  Trophy, 
  Sparkles, 
  Gamepad2, 
  LogOut, 
  Users, 
  HelpCircle, 
  CheckCircle2, 
  MessageSquare, 
  Copy, 
  X,
  Palette,
  Volume2
} from 'lucide-react';

const themes = [
  {
    name: "Cosmic Twilight",
    vars: {
      '--bg-color': '#0d0614',
      '--card-bg': 'rgba(29, 16, 46, 0.72)',
      '--primary-color': '#FF4B72',
      '--secondary-color': '#FF7694',
      '--accent-color': '#4ade80',
      '--border-color': 'rgba(255, 255, 255, 0.08)',
      '--glow-shadow': 'rgba(255, 75, 114, 0.4)'
    }
  },
  {
    name: "Cyber Horizon",
    vars: {
      '--bg-color': '#050a17',
      '--card-bg': 'rgba(16, 26, 50, 0.75)',
      '--primary-color': '#00d2ff',
      '--secondary-color': '#3a7bd5',
      '--accent-color': '#6FFFE9',
      '--border-color': 'rgba(255, 255, 255, 0.08)',
      '--glow-shadow': 'rgba(0, 210, 255, 0.35)'
    }
  },
  {
    name: "Brutalist Neon",
    vars: {
      '--bg-color': '#0a0a0a',
      '--card-bg': 'rgba(20, 20, 20, 0.85)',
      '--primary-color': '#FF003C',
      '--secondary-color': '#D9002E',
      '--accent-color': '#00FF41',
      '--border-color': 'rgba(255, 255, 255, 0.08)',
      '--glow-shadow': 'rgba(255, 0, 60, 0.4)'
    }
  },
  {
    name: "Royal Violet",
    vars: {
      '--bg-color': '#1a0b2e',
      '--card-bg': 'rgba(35, 15, 60, 0.75)',
      '--primary-color': '#d946ef',
      '--secondary-color': '#a855f7',
      '--accent-color': '#f472b6',
      '--border-color': 'rgba(217, 70, 239, 0.15)',
      '--glow-shadow': 'rgba(217, 70, 239, 0.35)'
    }
  }
];

export default function App() {
  const [activeGame, setActiveGame] = useState<'home' | 'movie' | 'word' | 'cards'>('home');
  const [currentThemeIdx, setCurrentThemeIdx] = useState(0);

  // Decoded user attributes from URL parameters matching original flow
  const [myName, setMyName] = useState('immu');
  const [partnerName, setPartnerName] = useState('sappii');

  // Real-time states
  const [gameState, setGameState] = useState<MovieGameState>({
    turn: 'immu',
    status: 'set',
    score1: 0,
    score2: 0,
    movieEng: '',
    movieTamil: '',
    hint: ''
  });

  const [wordGameState, setWordGameState] = useState<WordGameState>({
    status: 'letter_phase',
    p1Letter: '',
    p2Letter: '',
    startLetter: '',
    endLetter: '',
    score1: 0,
    score2: 0,
    usedWords: {}
  });

  const [cardsGameState, setCardsGameState] = useState<CardsGameState>({
    status: 'setup',
    playerCount: 2,
    playerNames: ['immu', 'sappii'],
    turn: 'immu',
    ledSuit: '',
    table: {},
    hands: {},
    scores: {}
  });

  // Presence tracker states
  const [immuOnline, setImmuOnline] = useState(false);
  const [sappiiOnline, setSappiiOnline] = useState(false);

  // Status Modals
  const [showResetModal, setShowResetModal] = useState(false);
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);

  // Load username matching their original params query rules
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const u = (urlParams.get('u') || 'immu').toLowerCase();
    setMyName(u);

    if (u === 'immu') setPartnerName('sappii');
    else if (u === 'sappii') setPartnerName('immu');
    else if (u === 'tharkuri') setPartnerName('immu'); // Tharkuri pairs with core Immu
  }, []);

  // Update themes & save inside storage
  useEffect(() => {
    const cached = localStorage.getItem('appThemeIndex');
    if (cached) {
      setCurrentThemeIdx(parseInt(cached));
    }
  }, []);

  // Set selected variables to DOM
  const activeTheme = themes[currentThemeIdx] || themes[0];
  useEffect(() => {
    if (activeTheme?.vars) {
      Object.entries(activeTheme.vars).forEach(([key, val]) => {
        document.documentElement.style.setProperty(key, val);
      });
    }
  }, [currentThemeIdx]);

  // Sync state loops from cloud database
  useEffect(() => {
    const movieRef = ref(db, 'gameState');
    const wordRef = ref(db, 'wordGameState');
    const cardsRef = ref(db, 'cardsGameState');

    const unsubMovie = onValue(movieRef, (snap) => {
      const data = snap.val();
      if (data) {
        setGameState(prev => ({
          ...prev,
          ...data
        }));
      }
    });

    const unsubWord = onValue(wordRef, (snap) => {
      const data = snap.val();
      if (data) {
        setWordGameState(prev => ({
          ...prev,
          ...data
        }));
      }
    });

    const unsubCards = onValue(cardsRef, (snap) => {
      const data = snap.val();
      if (data) {
        setCardsGameState(prev => ({
          ...prev,
          ...data
        }));
      }
    });

    return () => {
      unsubMovie();
      unsubWord();
      unsubCards();
    };
  }, []);

  // Presence system execution
  useEffect(() => {
    const connectedRef = ref(db, '.info/connected');
    
    // Listen to self connections
    const unsubscribe = onValue(connectedRef, (snap) => {
      if (snap.val() === true) {
        const myPresenceRef = ref(db, `presence/${myName}`);
        onDisconnect(myPresenceRef).set({ online: false, lastSeen: serverTimestamp() });
        set(myPresenceRef, { online: true, lastSeen: serverTimestamp() });
      }
    });

    // Listen to Immu and Sappii connection paths
    const immuPresRef = ref(db, 'presence/immu');
    const sappiiPresRef = ref(db, 'presence/sappii');

    const unsubImmu = onValue(immuPresRef, (snap) => {
      setImmuOnline(!!snap.val()?.online);
    });

    const unsubSappii = onValue(sappiiPresRef, (snap) => {
      setSappiiOnline(!!snap.val()?.online);
    });

    return () => {
      unsubscribe();
      unsubImmu();
      unsubSappii();
    };
  }, [myName]);

  const cycleTheme = () => {
    const next = (currentThemeIdx + 1) % themes.length;
    setCurrentThemeIdx(next);
    localStorage.setItem('appThemeIndex', next.toString());
  };

  const handleUpdateMovieState = (updates: Partial<MovieGameState>) => {
    update(ref(db, 'gameState'), updates);
  };

  const handleUpdateWordState = (updates: Partial<WordGameState>) => {
    update(ref(db, 'wordGameState'), updates);
  };

  const handlePushSystemMessage = (text: string) => {
    push(ref(db, 'chatMessages'), {
      sender: 'SYSTEM',
      text,
      timestamp: serverTimestamp()
    });
  };

  const copyRefLink = (user: string) => {
    const lnk = `${window.location.origin}${window.location.pathname}?u=${user}`;
    navigator.clipboard.writeText(lnk).then(() => {
      setCopiedLabel(user);
      setTimeout(() => setCopiedLabel(null), 2000);
    });
  };

  const handleConfirmReset = () => {
    if (activeGame === 'movie') {
      // Movie scores reset
      set(ref(db, 'gameState'), {
        turn: 'immu',
        status: 'set',
        score1: 0,
        score2: 0,
        movieEng: '',
        movieTamil: '',
        hint: ''
      });
      set(ref(db, 'chatMessages'), {});
    } else if (activeGame === 'word') {
      // Word racing scores reset
      set(ref(db, 'wordGameState'), {
        status: 'letter_phase',
        p1Letter: '',
        p2Letter: '',
        startLetter: '',
        endLetter: '',
        score1: 0,
        score2: 0,
        usedWords: {}
      });
      set(ref(db, 'chatMessages'), {});
    } else if (activeGame === 'cards') {
      // Card gaming reset
      set(ref(db, 'cardsGameState'), {
        status: 'setup'
      });
    }
    setShowResetModal(false);
  };

  return (
    <div className="relative min-h-screen bg-[#0d0614] text-white flex flex-col items-center justify-start overflow-x-hidden p-3 font-sans" style={{ background: `radial-gradient(circle at top left, #2b1340, var(--bg-color))` }}>
      {/* Dynamic Animated Particle Backdrops */}
      <ParticleBackground 
        primaryColor={activeTheme?.vars?.['--primary-color']} 
        accentColor={activeTheme?.vars?.['--accent-color']} 
      />

      {/* Main UI layout Wrapper limited max-width to center columns seamlessly */}
      <div className="w-full max-w-md my-4 space-y-4 z-10 transition-all duration-500 animate-fadeIn select-all">
        
        {/* Header Top Navigation Menu */}
        <div className="flex justify-between items-center bg-[var(--card-bg)] backdrop-blur-md px-4 py-3 border border-[var(--border-color)] rounded-2xl shadow-xl flex-row select-none">
          <div className="flex items-center gap-2">
            <span className="w-3.5 h-3.5 bg-gradient-to-r from-[var(--primary-color)] to-[var(--secondary-color)] rounded-full animate-ping shrink-0" />
            <h1 className="text-sm font-black tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-[var(--primary-color)] to-[var(--secondary-color)] uppercase">
              IMMU'S PORTAL
            </h1>
          </div>
          
          <button 
            onClick={cycleTheme}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 border border-white/10 hover:border-[var(--primary-color)] rounded-xl text-[10px] font-black tracking-wider transition-all hover:scale-105 cursor-pointer uppercase text-stone-300 hover:text-white shrink-0"
          >
            <Palette className="w-3.5 h-3.5 text-[var(--accent-color)]" />
            THEME
          </button>
        </div>

        {/* Dynamic game router view */}
        {activeGame === 'home' ? (
          // Home Lobby Dashboard
          <div className="space-y-4">
            
            {/* Display Banner matching their profile image */}
            <div className="relative w-full h-44 rounded-2xl overflow-hidden border border-[var(--border-color)] shadow-2xl group cursor-pointer select-none">
              <img 
                src="1000243508.jpg" 
                alt="Immus Portal" 
                className="w-full h-full object-cover brightness-95 group-hover:scale-105 transition-transform duration-700"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent flex flex-col justify-end p-5">
                <span className="text-[10px] text-[var(--accent-color)] font-extrabold tracking-widest uppercase mb-1">
                  OFFICIAL MULTIPLAYER HUB
                </span>
                <h2 className="text-xl font-black text-white uppercase tracking-wider drop-shadow-md">
                  CHOOSE YOUR CHALLENGE
                </h2>
              </div>
            </div>

            {/* List of custom local games */}
            <div className="space-y-3">
              <button
                onClick={() => setActiveGame('movie')}
                className="w-full flex items-center justify-between p-5 bg-[var(--card-bg)] hover:bg-white/5 border border-[var(--border-color)] hover:border-[var(--primary-color)] rounded-2xl transition-all duration-300 hover:-translate-y-1 shadow-md cursor-pointer border-l-4 border-l-[var(--primary-color)] group"
              >
                <div className="text-left">
                  <span className="text-[9px] text-[#FF7694] font-black tracking-widest block uppercase">TAMIL CINEMA</span>
                  <span className="text-base font-extrabold text-white tracking-wide group-hover:text-[var(--primary-color)] transition-colors uppercase">
                    MOVIE GUESSING ROUND
                  </span>
                </div>
                <Gamepad2 className="w-5 h-5 text-stone-500 group-hover:text-[var(--primary-color)] transition-colors shrink-0 ml-2" />
              </button>

              <button
                onClick={() => setActiveGame('word')}
                className="w-full flex items-center justify-between p-5 bg-[var(--card-bg)] hover:bg-white/5 border border-[var(--border-color)] hover:border-[var(--accent-color)] rounded-2xl transition-all duration-300 hover:-translate-y-1 shadow-md cursor-pointer border-l-4 border-l-[var(--accent-color)] group"
              >
                <div className="text-left">
                  <span className="text-[9px] text-[var(--accent-color)] font-black tracking-widest block uppercase">VOCABULARY HYPER</span>
                  <span className="text-base font-extrabold text-white tracking-wide group-hover:text-[var(--accent-color)] transition-colors uppercase">
                    WORD SPEED RACE
                  </span>
                </div>
                <Gamepad2 className="w-5 h-5 text-stone-500 group-hover:text-[var(--accent-color)] transition-colors shrink-0 ml-2" />
              </button>

              <button
                onClick={() => setActiveGame('cards')}
                className="w-full flex items-center justify-between p-5 bg-[var(--card-bg)] hover:bg-white/5 border border-[var(--border-color)] hover:border-amber-400 rounded-2xl transition-all duration-300 hover:-translate-y-1 shadow-md cursor-pointer border-l-4 border-l-amber-400 group"
              >
                <div className="text-left">
                  <span className="text-[9px] text-amber-300 font-black tracking-widest block uppercase">TACTICAL SHUFFLE</span>
                  <span className="text-base font-extrabold text-white tracking-wide group-hover:text-amber-400 transition-colors uppercase">
                    SPADES CARDS GAME 🃏
                  </span>
                </div>
                <Gamepad2 className="w-5 h-5 text-stone-500 group-hover:text-amber-300 transition-colors shrink-0 ml-2 animate-pulse" />
              </button>
            </div>

            {/* Quick Player reference copying utilities matching their requirements */}
            <div className="bg-[var(--card-bg)] backdrop-blur-md rounded-2xl p-5 border border-[var(--border-color)] shadow-xl space-y-4">
              <span className="text-[10px] text-stone-500 font-extrabold tracking-widest block uppercase text-center">
                ACTIVE PLAYERS REFERRERS
              </span>

              <div className="space-y-2">
                {[
                  { id: 'immu', label: '🕹️ IMMU KEY: ?u=immu' },
                  { id: 'sappii', label: '👯 SAPPII KEY: ?u=sappii' },
                  { id: 'tharkuri', label: '🎭 THARKURI KEY: ?u=tharkuri' }
                ].map(p => (
                  <button
                    key={p.id}
                    onClick={() => copyRefLink(p.id)}
                    className="w-full flex justify-between items-center p-3 bg-black/40 hover:bg-black/60 rounded-xl border border-white/5 hover:border-white/10 text-xs font-bold text-stone-200 transition-all select-none hover:-translate-y-0.5 cursor-pointer text-left"
                  >
                    <span>{p.label}</span>
                    <span className="text-[9px] text-[var(--accent-color)] uppercase tracking-wide">
                      {copiedLabel === p.id ? 'COPIED!' : 'COPY URL'}
                    </span>
                  </button>
                ))}
              </div>
            </div>

          </div>
        ) : (
          // General Gameplay layout column
          <div className="space-y-4">
            
            {/* Top row back button & badge */}
            <div className="flex justify-between items-center px-2 select-none shrink-0">
              <button
                onClick={() => setActiveGame('home')}
                className="flex items-center gap-1.5 text-[10px] font-black tracking-widest text-stone-400 hover:text-white uppercase transition-all hover:scale-105 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5 rotate-180" />
                LOBBY
              </button>
              
              <span className="text-xs bg-[var(--primary-color)]/20 border border-[var(--primary-color)]/20 text-[#FF7694] font-black px-4 py-1.5 rounded-full uppercase tracking-widest animate-pulse shadow-md">
                {activeGame === 'movie' ? 'MOVIE GUESSER' : activeGame === 'word' ? 'WORD RACES' : 'SPADES CRAD'}
              </span>
            </div>

            {/* General scoring details */}
            <div className="grid grid-cols-3 gap-3 items-center select-none shrink-0">
              <div className={`p-3 bg-[var(--card-bg)] rounded-2xl border border-[var(--border-color)] text-center transition-all ${
                (activeGame === 'movie' && gameState.turn === 'immu') || (activeGame === 'word' && wordGameState.p1Letter && !wordGameState.p2Letter)
                  ? 'border-[var(--primary-color)] shadow-lg shadow-[var(--glow-shadow)] scale-102'
                  : ''
              }`}>
                <div className="relative mx-auto w-12 h-12 rounded-full overflow-hidden mb-1.5 border border-white/10">
                  <img src="1000242624.jpg" alt="Immu" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                  <div className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-slate-950 ${immuOnline ? 'bg-green-500 animate-ping' : 'bg-stone-600'}`} />
                  <div className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-slate-950 ${immuOnline ? 'bg-green-500' : 'bg-stone-600'}`} />
                </div>
                <span className="text-[10px] font-black text-white tracking-widest uppercase">IMMU</span>
                <span className="block text-2xl font-black text-[var(--accent-color)] mt-0.5">
                  {activeGame === 'movie' ? gameState.score1 : activeGame === 'word' ? wordGameState.score1 : (cardsGameState.scores?.['immu'] || 0)}
                </span>
              </div>

              <div className="text-center font-black text-stone-500 tracking-widest uppercase text-xs">
                CLASH Arena
              </div>

              <div className={`p-3 bg-[var(--card-bg)] rounded-2xl border border-[var(--border-color)] text-center transition-all ${
                (activeGame === 'movie' && gameState.turn === 'sappii') || (activeGame === 'word' && wordGameState.p2Letter && !wordGameState.p1Letter)
                  ? 'border-[var(--primary-color)] shadow-lg shadow-[var(--glow-shadow)] scale-102'
                  : ''
              }`}>
                <div className="relative mx-auto w-12 h-12 rounded-full overflow-hidden mb-1.5 border border-white/10">
                  <img src="1000242625.jpg" alt="Sappii" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                  <div className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-slate-950 ${sappiiOnline ? 'bg-green-500 animate-ping' : 'bg-stone-600'}`} />
                  <div className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-slate-950 ${sappiiOnline ? 'bg-green-500' : 'bg-stone-600'}`} />
                </div>
                <span className="text-[10px] font-black text-white tracking-widest uppercase">SAPPII</span>
                <span className="block text-2xl font-black text-[var(--primary-color)] mt-0.5">
                  {activeGame === 'movie' ? gameState.score2 : activeGame === 'word' ? wordGameState.score2 : (cardsGameState.scores?.['sappii'] || 0)}
                </span>
              </div>
            </div>

            {/* Active game controller panel mapping */}
            {activeGame === 'movie' && (
              <MovieGame
                gameState={gameState}
                myName={myName}
                partnerName={partnerName}
                onUpdateState={handleUpdateMovieState}
                onPushSystemMessage={handlePushSystemMessage}
              />
            )}

            {activeGame === 'word' && (
              <WordGame
                gameState={wordGameState}
                myName={myName}
                partnerName={partnerName}
                onUpdateState={handleUpdateWordState}
                onPushSystemMessage={handlePushSystemMessage}
              />
            )}

            {activeGame === 'cards' && (
              <SpadesGame
                cardsGameState={cardsGameState}
                myName={myName}
                onPushSystemMessage={handlePushSystemMessage}
                onOpenResetModal={() => setShowResetModal(true)}
              />
            )}

            {/* Live Chat section widget */}
            <ChatSection
              myName={myName}
              partnerName={partnerName}
              activeGame={activeGame}
              gameState={gameState}
              wordGameState={wordGameState}
            />

            {/* Scores state reset buttons container */}
            <div className="text-center py-2 shrink-0 select-none">
              <button
                onClick={() => setShowResetModal(true)}
                className="px-5 py-2.5 bg-white/5 border border-white/10 hover:border-red-500 hover:text-red-400 hover:bg-red-500/5 text-stone-400 rounded-full font-black text-[10px] tracking-widest uppercase transition-all hover:scale-105 duration-200 cursor-pointer flex items-center justify-center gap-1.5 mx-auto"
              >
                <X className="w-3.5 h-3.5" />
                RESET ARENA STATE
              </button>
            </div>

          </div>
        )}

      </div>

      {/* Triggering dynamic Arena Resets Modals if active */}
      {showResetModal && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm flex justify-center items-center z-50 p-4 select-none">
          <div className="bg-[var(--card-bg)] border border-[var(--border-color)] p-6 rounded-2xl w-full max-w-sm text-center shadow-2xl relative space-y-4 animate-scaleUp">
            <h3 className="text-lg font-black tracking-wide text-white uppercase">
              CONFIRM STAGE RESET?
            </h3>
            <p className="text-xs text-stone-400 uppercase tracking-widest leading-relaxed">
              Resets score stats & chat records globally on real-time database. All clients will reflect this initialization.
            </p>
            <div className="flex gap-2 pt-2">
              <button
                onClick={handleConfirmReset}
                className="w-full py-3 bg-gradient-to-r from-red-500 to-rose-600 text-white font-extrabold text-xs tracking-wider rounded-xl hover:brightness-110 shadow-lg shadow-red-500/10 uppercase cursor-pointer"
              >
                CONFIRM RESET
              </button>
              <button
                onClick={() => setShowResetModal(false)}
                className="w-full py-3 bg-white/5 text-stone-400 font-extrabold text-xs tracking-wider rounded-xl border border-white/10 hover:border-white/20 uppercase cursor-pointer"
              >
                CANCEL
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
