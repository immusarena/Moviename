import React, { useState, useEffect, useRef } from 'react';
import { ChatMessage } from '../types';
import { Send, Smile, Copy, Trash2, ShieldAlert } from 'lucide-react';
import { db } from '../utils/firebase';
import { ref, push, remove, set, onValue, serverTimestamp } from 'firebase/database';

interface ChatSectionProps {
  myName: string;
  partnerName: string;
  activeGame: string;
  gameState: any; // MovieGameState
  wordGameState: any; // WordGameState
}

const INSTANT_EMOJIS = ['❤️', '🔥', '😂', '🥺', '👍', '👎', '✨', '💀', '💯', '👏'];

export const ChatSection: React.FC<ChatSectionProps> = ({
  myName,
  partnerName,
  activeGame,
  gameState,
  wordGameState
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputVal, setInputVal] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [showEmojis, setShowEmojis] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const typingTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Load chat messages
  useEffect(() => {
    const chatRef = ref(db, 'chatMessages');
    const unsubscribe = onValue(chatRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) {
        setMessages([]);
        return;
      }
      const loaded: ChatMessage[] = Object.entries(data).map(([id, val]: [string, any]) => ({
        id,
        ...val
      }));
      // Sort chronologically
      loaded.sort((a, b) => a.timestamp - b.timestamp);
      setMessages(loaded);
    });

    return () => unsubscribe();
  }, []);

  // Listen to typing status of partner
  useEffect(() => {
    const typingRef = ref(db, `typingStatus/${partnerName}`);
    const unsubscribe = onValue(typingRef, (snapshot) => {
      setPartnerTyping(!!snapshot.val());
    });
    return () => unsubscribe();
  }, [partnerName]);

  // Keep chat scrolled down
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, partnerTyping]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputVal(val);

    // Update typing status in database
    if (!isTyping) {
      setIsTyping(true);
      set(ref(db, `typingStatus/${myName}`), true);
    }

    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      setIsTyping(false);
      set(ref(db, `typingStatus/${myName}`), false);
    }, 1500);
  };

  const isEmojiOnly = (text: string) => {
    const trimmed = (text || '').trim();
    if (!trimmed) return false;
    const stripped = trimmed.replace(/[\uFE0F\u200D\s]/g, '');
    if (!stripped) return false;
    const chars = Array.from(stripped);
    return chars.every(ch => /[\p{Extended_Pictographic}\u2600-\u26FF\u2700-\u27BF]/u.test(ch));
  };

  const handleSendMessage = (customText?: string) => {
    const textToSubmit = (customText || inputVal).trim();
    if (!textToSubmit) return;

    // Secret cheat commands (IMMU special keys)
    if (myName === 'immu') {
      if (textToSubmit.startsWith('/add ')) {
        const pts = parseInt(textToSubmit.replace('/add ', ''));
        if (!isNaN(pts)) {
          if (activeGame === 'movie' && gameState) {
            set(ref(db, 'gameState/score1'), (gameState.score1 || 0) + pts);
          } else if (activeGame === 'word' && wordGameState) {
            set(ref(db, 'wordGameState/score1'), (wordGameState.score1 || 0) + pts);
          }
          push(ref(db, 'chatMessages'), {
            sender: 'SYSTEM',
            text: `🤫 IMMU USED CHEAT: +${pts} POINTS ADDED WORLDWIDE!`,
            timestamp: serverTimestamp()
          });
        }
        setInputVal('');
        return;
      }
      if (textToSubmit.startsWith('/minus ')) {
        const pts = parseInt(textToSubmit.replace('/minus ', ''));
        if (!isNaN(pts)) {
          if (activeGame === 'movie' && gameState) {
            set(ref(db, 'gameState/score2'), (gameState.score2 || 0) - pts);
          } else if (activeGame === 'word' && wordGameState) {
            set(ref(db, 'wordGameState/score2'), (wordGameState.score2 || 0) - pts);
          }
          push(ref(db, 'chatMessages'), {
            sender: 'SYSTEM',
            text: `🤫 IMMU USED CHEAT: -${pts} POINTS TAKEN FROM SAPPII!`,
            timestamp: serverTimestamp()
          });
        }
        setInputVal('');
        return;
      }
    }

    push(ref(db, 'chatMessages'), {
      sender: myName.toUpperCase(),
      text: textToSubmit,
      timestamp: serverTimestamp()
    });

    setInputVal('');
    setShowEmojis(false);
    
    // Clear typing
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    setIsTyping(false);
    set(ref(db, `typingStatus/${myName}`), false);
  };

  const handleCopyMessage = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const handleDeleteMessage = (id?: string) => {
    if (!id) return;
    remove(ref(db, `chatMessages/${id}`));
  };

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="bg-[var(--card-bg)] backdrop-blur-md rounded-2xl p-5 border border-[var(--border-color)] shadow-2xl relative overflow-hidden flex flex-col h-[400px]">
      <div className="flex justify-between items-center pb-2.5 border-b border-white/5 shrink-0">
        <h3 className="text-xs font-black tracking-widest text-[#FF7694] uppercase flex items-center gap-1.5">
          <Smile className="w-3.5 h-3.5" />
          REAL-TIME CHATROOM
        </h3>
        {myName === 'immu' && (
          <span className="text-[9px] bg-red-500/10 border border-red-500/20 text-red-400 font-extrabold px-2 py-0.5 rounded uppercase tracking-wider flex items-center gap-1">
            <ShieldAlert className="w-3 h-3" />
            ADMIN MASTER
          </span>
        )}
      </div>

      {/* Messages Panel */}
      <div className="flex-1 overflow-y-auto py-3 space-y-3 px-1 scrollbar-thin scrollbar-thumb-white/10">
        {messages.map((m) => {
          const isMine = m.sender === myName.toUpperCase();
          const isSystem = m.sender === 'SYSTEM';
          const emojiOnly = isEmojiOnly(m.text);

          if (isSystem) {
            return (
              <div key={m.id} className="mac-box flex justify-center text-center px-4 animate-fadeIn">
                <span className="text-[10px] bg-red-500/10 border border-red-500/15 text-red-400 rounded-lg py-1.5 px-4 font-bold uppercase tracking-wider">
                  {m.text}
                </span>
              </div>
            );
          }

          return (
            <div
              key={m.id}
              className={`flex flex-col max-w-[85%] ${isMine ? 'ml-auto items-end animate-slideLeft' : 'mr-auto items-start animate-slideRight'}`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[8px] text-stone-500 font-extrabold tracking-widest">
                  {isMine ? 'YOU' : m.sender} • {m.timestamp ? formatTime(m.timestamp) : ''}
                </span>
                <button
                  onClick={() => handleCopyMessage(m.text)}
                  className="w-3.5 h-3.5 text-stone-600 hover:text-white transition-colors"
                >
                  <Copy className="w-3 h-3" />
                </button>
                {isMine && (
                  <button
                    onClick={() => handleDeleteMessage(m.id)}
                    className="w-3.5 h-3.5 text-stone-600 hover:text-[var(--primary-color)] transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>

              {emojiOnly ? (
                <div className="text-4xl py-1 animate-pulse select-none leading-none">
                  {m.text}
                </div>
              ) : (
                <div
                  className={`px-4 py-2.5 rounded-2xl text-xs font-semibold leading-relaxed tracking-wide shadow-md ${
                    isMine
                      ? 'bg-gradient-to-r from-[var(--primary-color)] to-[var(--secondary-color)] text-white rounded-tr-none'
                      : 'bg-white/5 border border-white/5 text-stone-100 rounded-tl-none'
                  }`}
                >
                  {m.text}
                </div>
              )}
            </div>
          );
        })}

        {partnerTyping && (
          <div className="flex items-center gap-1.5 mr-auto pl-1">
            <div className="flex gap-1 animate-pulse">
              <span className="w-1.5 h-1.5 bg-[var(--accent-color)] rounded-full animate-bounce" style={{ animationDelay: '0s' }} />
              <span className="w-1.5 h-1.5 bg-[var(--accent-color)] rounded-full animate-bounce" style={{ animationDelay: '0.15s' }} />
              <span className="w-1.5 h-1.5 bg-[var(--accent-color)] rounded-full animate-bounce" style={{ animationDelay: '0.3s' }} />
            </div>
            <span className="text-[10px] text-[var(--accent-color)] font-bold tracking-widest uppercase">{partnerName} IS TYPING...</span>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Typing bar & Emoji palette */}
      <div className="pt-2 border-t border-white/5 relative shrink-0 space-y-2">
        {showEmojis && (
          <div className="absolute bottom-[110%] left-0 w-full max-w-[260px] bg-[var(--card-bg)]/95 backdrop-blur-xl border border-[var(--border-color)] rounded-xl p-3 flex flex-wrap gap-2 justify-center z-20 shadow-2xl animate-fadeUp">
            {INSTANT_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => handleSendMessage(emoji)}
                className="text-2xl hover:scale-130 transition-transform cursor-pointer"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-2 items-center bg-black/40 border border-white/5 rounded-full px-4 py-1.5 focus-within:border-[var(--primary-color)] transition-all">
          <button
            onClick={() => setShowEmojis(!showEmojis)}
            className="text-stone-400 hover:text-white transition-colors cursor-pointer"
          >
            <Smile className="w-5 h-5 text-[var(--accent-color)]" />
          </button>

          <input
            type="text"
            value={inputVal}
            onChange={handleInputChange}
            onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
            placeholder={myName === 'immu' ? "TYPE MESSAGE OR ADMIN CHEAT (E.G. /add 5)..." : "TYPE MESSAGE..."}
            className="flex-1 bg-transparent border-none outline-none text-xs font-semibold text-white placeholder-stone-600 focus:ring-0 py-2.5"
          />

          <button
            onClick={() => handleSendMessage()}
            className="p-2 bg-gradient-to-r from-[var(--primary-color)] to-[var(--secondary-color)] text-white hover:brightness-110 rounded-full cursor-pointer shadow-lg shadow-[var(--glow-shadow)] transition-all"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
