export interface MovieGameState {
  turn: string;
  status: 'set' | 'guessing';
  score1: number;
  score2: number;
  movieEng: string;
  movieTamil: string;
  hint: string;
}

export interface WordGameState {
  status: 'letter_phase' | 'race_phase';
  p1Letter: string;
  p2Letter: string;
  startLetter: string;
  endLetter: string;
  score1: number;
  score2: number;
  usedWords: Record<string, string>;
}

export interface Card {
  suit: 'S' | 'H' | 'D' | 'C';
  rank: number; // 2-14 (14 for Ace)
}

export interface CardsGameState {
  status: 'setup' | 'playing' | 'finished';
  playerCount: number;
  playerNames: string[];
  turn: string;
  ledSuit: string;
  table: Record<string, Card>;
  hands: Record<string, Card[]>;
  scores: Record<string, number>;
}

export interface ChatMessage {
  sender: string;
  text: string;
  timestamp: number;
  id?: string;
}

export interface UserPresence {
  online: boolean;
  lastSeen: number;
}

export interface MovieItem {
  eng: string;
  tamil: string;
  hero?: string;
}
