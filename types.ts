export interface TranscriptEntry {
  role: 'user' | 'model';
  text: string;
  timestamp: number;
  mood?: Mood;
}

export enum AppState {
  IDLE = 'IDLE',
  SLEEP = 'SLEEP',
  STANDBY = 'STANDBY',
  CONNECTING = 'CONNECTING',
  LISTENING = 'LISTENING',
  SPEAKING = 'SPEAKING',
  RECONNECTING = 'RECONNECTING',
  ERROR = 'ERROR'
}

export enum Mood {
  NEUTRAL = 'NEUTRAL',
  HAPPY = 'HAPPY',
  SAD = 'SAD',
  SURPRISED = 'SURPRISED',
  THINKING = 'THINKING',
  ANGRY = 'ANGRY',
  EXCITED = 'EXCITED',
  CONFUSED = 'CONFUSED'
}
