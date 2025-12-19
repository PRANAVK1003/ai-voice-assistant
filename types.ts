
export interface TranscriptionEntry {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: Date;
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface AudioVisualizerProps {
  isListening: boolean;
  audioStream: MediaStream | null;
}
