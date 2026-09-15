const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const USERS = ['immu', 'sappii'];

function otherOf(u) {
  return u === 'immu' ? 'sappii' : 'immu';
}

/* ------------------------------------------------------------
   In-memory shared state. Two people, no database needed —
   if the process restarts, the session simply resets.
------------------------------------------------------------ */
const state = {
  presence: {
    immu: { online: false },
    sappii: { online: false }
  },
  lounge: {
    url: null,
    type: null,
    playing: false,
    currentTime: 0,
    updatedBy: null,
    updatedAt: null
  },
  chat: [],
  reels: [],
  games: {
    movie: { status: 'idle' },
    wordrace: { status: 'idle' },
    cards: { board: [], matched: [], flipped: [], turn: null },
    code: { status: 'idle' }
  }
};

let wordraceTimeout = null;

const CARD_EMOJIS = ['🎬', '🎮', '🎧', '🍕', '🌙', '⭐', '🔥', '💜'];

function shuffledDeck() {
  const deck = [...CARD_EMOJIS, ...CARD_EMOJIS];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// Strip the secret from the code-guessing round before it's ever sent
// to a client, unless the round has been won (then it's fair to reveal).
function publicCodeView(c) {
  if (!c) return c;
  if (c.status === 'won') return c;
  const { secret, ...rest } = c;
  return rest;
}

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  socket.on('join', (user) => {
    if (!USERS.includes(user)) return;
    socket.data.user = user;
    state.presence[user] = { online: true };
    io.emit('presence:update', state.presence);

    // Send a full snapshot to the newly joined client only.
    socket.emit('state:init', {
      presence: state.presence,
      lounge: state.lounge,
      chat: state.chat,
      reels: state.reels,
      games: {
        movie: state.games.movie,
        wordrace: state.games.wordrace,
        cards: state.games.cards,
        code: publicCodeView(state.games.code)
      },
      you: user
    });
  });

  socket.on('disconnect', () => {
    const user = socket.data.user;
    if (!user) return;
    state.presence[user] = { online: false };
    io.emit('presence:update', state.presence);
  });

  /* ---------------- Lounge ---------------- */
  socket.on('lounge:load', (payload) => {
    const user = socket.data.user;
    if (!user || !payload || !payload.url) return;
    state.lounge = {
      url: payload.url,
      type: payload.type,
      playing: true,
      currentTime: 0,
      updatedBy: user,
      updatedAt: Date.now()
    };
    io.emit('lounge:update', state.lounge);
  });

  socket.on('lounge:action', (partial) => {
    const user = socket.data.user;
    if (!user || !state.lounge.url) return;
    state.lounge = Object.assign({}, state.lounge, partial, {
      updatedBy: user,
      updatedAt: Date.now()
    });
    io.emit('lounge:update', state.lounge);
  });

  /* ---------------- Chat ---------------- */
  socket.on('chat:send', (text) => {
    const user = socket.data.user;
    if (!user || !text || !String(text).trim()) return;
    const msg = { user, text: String(text).trim().slice(0, 1000), ts: Date.now() };
    state.chat.push(msg);
    if (state.chat.length > 500) state.chat.shift();
    io.emit('chat:new', msg);
  });

  /* ---------------- Reels ---------------- */
  socket.on('reels:add', (payload) => {
    const user = socket.data.user;
    if (!user || !payload || !payload.url) return;
    const item = {
      id: Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      url: payload.url,
      caption: (payload.caption || '').slice(0, 200),
      addedBy: user,
      ts: Date.now()
    };
    state.reels.push(item);
    io.emit('reels:update', state.reels);
  });

  /* ---------------- Movie Clues ---------------- */
  socket.on('movie:set', (payload) => {
    const user = socket.data.user;
    if (!user || !payload || !payload.answer || !payload.clues) return;
    state.games.movie = {
      setter: user,
      answer: String(payload.answer).toLowerCase().trim(),
      clues: String(payload.clues).slice(0, 100),
      status: 'active',
      guesses: []
    };
    io.emit('movie:update', state.games.movie);
  });

  socket.on('movie:guess', (text) => {
    const user = socket.data.user;
    const g = state.games.movie;
    if (!user || !g || g.status !== 'active' || !text) return;
    const correct = String(text).toLowerCase().trim() === g.answer;
    g.guesses.push({ by: user, text: String(text).slice(0, 100), correct, ts: Date.now() });
    if (correct) {
      g.status = 'won';
      g.winner = user;
    }
    io.emit('movie:update', g);
  });

  /* ---------------- Word Race ---------------- */
  socket.on('wordrace:start', () => {
    const letters = 'ABCDEFGHIJKLMNOPRSTW';
    const letter = letters[Math.floor(Math.random() * letters.length)];
    state.games.wordrace = {
      status: 'active',
      letter,
      endsAt: Date.now() + 60000,
      words: []
    };
    io.emit('wordrace:update', state.games.wordrace);

    if (wordraceTimeout) clearTimeout(wordraceTimeout);
    wordraceTimeout = setTimeout(() => {
      if (state.games.wordrace.status === 'active') {
        state.games.wordrace.status = 'done';
        io.emit('wordrace:update', state.games.wordrace);
      }
    }, 60000);
  });

  socket.on('wordrace:submit', (word) => {
    const user = socket.data.user;
    const g = state.games.wordrace;
    if (!user || !g || g.status !== 'active' || !word) return;
    const w = String(word).trim();
    if (!w) return;
    if (w[0].toUpperCase() !== g.letter.toUpperCase()) return;
    if (g.words.some((x) => x.text.toLowerCase() === w.toLowerCase())) return;
    g.words.push({ by: user, text: w.slice(0, 40), ts: Date.now() });
    io.emit('wordrace:update', g);
  });

  /* ---------------- Match Cards ---------------- */
  socket.on('cards:new', () => {
    const user = socket.data.user;
    state.games.cards = {
      board: shuffledDeck(),
      matched: [],
      flipped: [],
      turn: user || USERS[0]
    };
    io.emit('cards:update', state.games.cards);
  });

  socket.on('cards:flip', (index) => {
    const user = socket.data.user;
    const g = state.games.cards;
    if (!user || !g || !g.board.length) return;
    if (g.turn !== user) return;
    if (g.matched.includes(index) || g.flipped.includes(index)) return;
    if (g.flipped.length >= 2) return;

    g.flipped.push(index);
    io.emit('cards:update', g);

    if (g.flipped.length === 2) {
      const [a, b] = g.flipped;
      const isMatch = g.board[a] === g.board[b];
      setTimeout(() => {
        if (isMatch) g.matched.push(a, b);
        g.turn = isMatch ? user : otherOf(user);
        g.flipped = [];
        io.emit('cards:update', g);
      }, 900);
    }
  });

  /* ---------------- Guess the Code ---------------- */
  socket.on('code:setSecret', (secret) => {
    const user = socket.data.user;
    if (!user || !Array.isArray(secret) || secret.length !== 4) return;
    state.games.code = {
      setter: user,
      secret: secret.map((n) => Number(n) || 0),
      status: 'active',
      guesses: []
    };
    io.emit('code:update', publicCodeView(state.games.code));
  });

  socket.on('code:guess', (seq) => {
    const user = socket.data.user;
    const g = state.games.code;
    if (!user || !g || g.status !== 'active' || !Array.isArray(seq) || seq.length !== 4) return;
    const guess = seq.map((n) => Number(n) || 0);
    const secretCopy = [...g.secret];
    const guessCopy = [...guess];
    let exact = 0;
    let present = 0;
    for (let i = 0; i < 4; i++) {
      if (guessCopy[i] === secretCopy[i]) {
        exact++;
        secretCopy[i] = null;
        guessCopy[i] = undefined;
      }
    }
    for (let i = 0; i < 4; i++) {
      if (guessCopy[i] === undefined) continue;
      const idx = secretCopy.indexOf(guessCopy[i]);
      if (idx !== -1) {
        present++;
        secretCopy[idx] = null;
      }
    }
    g.guesses.push({ by: user, seq: guess, exact, present, ts: Date.now() });
    if (exact === 4) {
      g.status = 'won';
      g.winner = user;
    }
    io.emit('code:update', publicCodeView(g));
  });
});

server.listen(PORT, () => {
  console.log(`IMMU'S CLASH ARENA server running on port ${PORT}`);
});
